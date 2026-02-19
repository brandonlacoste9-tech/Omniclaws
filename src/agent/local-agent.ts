/**
 * Local Agent mode: distributed mesh for zero-cost AI execution
 * Agents poll for tasks, execute locally (Ollama), return results
 */

import type { D1Database } from "@cloudflare/workers-types";
import { confirmCharge, reserveFunds } from "../billing/usage-meter";
import type { Env } from "../types";

const CLAIM_TIMEOUT_MINUTES = 5;
const TASK_PRICE_CENTS = 50;

export interface AgentPollResult {
  success: boolean;
  tasks?: Array<{
    id: string;
    service: string;
    tenant_id: string;
    payload: Record<string, unknown>;
    created_at: string;
  }>;
  error?: string;
}

export interface AgentCompleteResult {
  success: boolean;
  earnings?: number;
  error?: string;
}

export interface AgentRegisterResult {
  success: boolean;
  secret?: string;
  error?: string;
}

/**
 * Validate agent credentials.
 */
async function validateAgent(
  db: D1Database,
  agentId: string,
  secret: string
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 FROM agents WHERE id = ? AND secret = ?`)
    .bind(agentId, secret)
    .first();
  return !!row;
}

/**
 * Poll for pending tasks assigned to this agent.
 * Claims tasks (marks as claimed) so other agents don't take them.
 * Unclaims tasks that have been claimed > 5 min without completion.
 */
export async function agentPoll(
  db: D1Database,
  agentId: string,
  secret: string
): Promise<AgentPollResult> {
  const valid = await validateAgent(db, agentId, secret);
  if (!valid) {
    return { success: false, error: "Invalid agent credentials" };
  }

  await db
    .prepare(
      `UPDATE agents SET last_poll_at = datetime('now') WHERE id = ?`
    )
    .bind(agentId)
    .run();

  const timeoutCutoff = new Date(Date.now() - CLAIM_TIMEOUT_MINUTES * 60 * 1000).toISOString();

  await db
    .prepare(
      `UPDATE tasks SET status = 'pending', claimed_at = NULL
       WHERE assigned_agent = ? AND status = 'claimed' AND claimed_at < ?`
    )
    .bind(agentId, timeoutCutoff)
    .run();

  const rows = await db
    .prepare(
      `SELECT id, service, tenant_id, payload, created_at FROM tasks
       WHERE assigned_agent = ? AND status = 'pending'
       ORDER BY created_at
       LIMIT 10`
    )
    .bind(agentId)
    .all<{ id: string; service: string; tenant_id: string; payload: string; created_at: string }>();

  const tasks = (rows.results ?? []).map((r) => ({
    id: r.id,
    service: r.service,
    tenant_id: r.tenant_id,
    payload: (() => {
      try {
        return JSON.parse(r.payload ?? "{}") as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    })(),
    created_at: r.created_at,
  }));

  for (const t of tasks) {
    await db
      .prepare(
        `UPDATE tasks SET status = 'claimed', claimed_at = datetime('now')
         WHERE id = ? AND status = 'pending' AND assigned_agent = ?`
      )
      .bind(t.id, agentId)
      .run();
  }

  return { success: true, tasks };
}

/**
 * Complete a task. Validates agent, updates task, confirms charge.
 */
export async function agentComplete(
  db: D1Database,
  env: Env,
  agentId: string,
  secret: string,
  taskId: string,
  result: unknown
): Promise<AgentCompleteResult> {
  const valid = await validateAgent(db, agentId, secret);
  if (!valid) {
    return { success: false, error: "Invalid agent credentials" };
  }

  const task = await db
    .prepare(
      `SELECT id, tenant_id, assigned_agent, status FROM tasks
       WHERE id = ? AND assigned_agent = ?`
    )
    .bind(taskId, agentId)
    .first<{ id: string; tenant_id: string; assigned_agent: string; status: string }>();

  if (!task) {
    return { success: false, error: "Task not found or not assigned to this agent" };
  }

  if (task.status === "completed") {
    return { success: true, earnings: TASK_PRICE_CENTS };
  }

  if (task.status !== "claimed" && task.status !== "pending") {
    return { success: false, error: `Task status is ${task.status}, cannot complete` };
  }

  const ledgerRow = await db
    .prepare(
      `SELECT reservation_id FROM usage_ledger
       WHERE task_id = ? AND status = 'reserved'`
    )
    .bind(taskId)
    .first<{ reservation_id: string }>();

  if (!ledgerRow) {
    const confirmedRow = await db
      .prepare(
        `SELECT reservation_id FROM usage_ledger
         WHERE task_id = ? AND status = 'confirmed'`
      )
      .bind(taskId)
      .first<{ reservation_id: string }>();

    if (confirmedRow) {
      await db
        .prepare(
          `UPDATE tasks SET status = 'completed', completed_at = datetime('now')
           WHERE id = ?`
        )
        .bind(taskId)
        .run();
      return { success: true, earnings: TASK_PRICE_CENTS };
    }
    return { success: false, error: "No reservation found for task" };
  }

  const confirm = await confirmCharge(db, ledgerRow.reservation_id, env);
  if (!confirm.success) {
    return { success: false, error: confirm.error ?? "Failed to confirm charge" };
  }

  await db
    .prepare(
      `UPDATE tasks SET status = 'completed', completed_at = datetime('now')
       WHERE id = ?`
    )
    .bind(taskId)
    .run();

  return { success: true, earnings: TASK_PRICE_CENTS };
}

/**
 * Register a new local agent.
 */
export async function agentRegister(
  db: D1Database,
  agentId: string,
  name: string,
  capabilities: string[]
): Promise<AgentRegisterResult> {
  const secret = `agent-${crypto.randomUUID().replace(/-/g, "")}`;

  try {
    await db
      .prepare(
        `INSERT INTO agents (id, name, secret, capabilities, status)
         VALUES (?, ?, ?, ?, 'active')`
      )
      .bind(agentId, name, secret, JSON.stringify(capabilities))
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE") || msg.includes("SQLITE_CONSTRAINT")) {
      return { success: false, error: "Agent ID already registered" };
    }
    return { success: false, error: msg };
  }

  return { success: true, secret };
}

/**
 * Submit a task for a local agent. Creates task, assigns agent, reserves funds.
 */
export async function agentSubmitTask(
  db: D1Database,
  env: Env,
  userId: string,
  agentId: string,
  prompt: string
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  const agentExists = await db
    .prepare(`SELECT 1 FROM agents WHERE id = ?`)
    .bind(agentId)
    .first();

  if (!agentExists) {
    return { success: false, error: "Agent not found" };
  }

  const taskId = crypto.randomUUID();
  const taskPriceCents = parseInt(env.TASK_PRICE_CENTS ?? String(TASK_PRICE_CENTS), 10);

  const reserve = await reserveFunds(db, userId, taskId, taskPriceCents);
  if (!reserve.success) {
    return { success: false, error: reserve.error ?? "Reserve failed" };
  }

  await db
    .prepare(
      `INSERT INTO tasks (id, service, tenant_id, payload, status, assigned_agent)
       VALUES (?, 'ollama-agent', ?, ?, 'pending', ?)`
    )
    .bind(taskId, userId, JSON.stringify({ prompt }), agentId)
    .run();

  return { success: true, taskId };
}
