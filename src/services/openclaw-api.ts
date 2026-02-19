/**
 * OpenClaw API: Generic task execution engine
 * Orchestrates AI tasks with self-healing retry logic
 */

import { retryWithBackoff, DEFAULT_RETRY_CONFIG } from '../utils/failover';
import { logTaskExecution } from '../compliance/audit-logger';

export interface Task {
  id: string;
  userId: string;
  serviceType: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retryCount: number;
  result?: Record<string, unknown>;
  error?: string;
}

export interface OpenClawEnv {
  DB: D1Database;
  AUDIT_LOGS: R2Bucket;
}

/**
 * Creates a new task in the queue
 */
export async function createTask(
  env: OpenClawEnv,
  userId: string,
  serviceType: string,
  payload: Record<string, unknown>,
  request?: Request
): Promise<Task> {
  const taskId = crypto.randomUUID();
  const now = Date.now();
  
  const task: Task = {
    id: taskId,
    userId,
    serviceType,
    payload,
    status: 'pending',
    retryCount: 0,
  };
  
  // Store in database
  await env.DB.prepare(`
    INSERT INTO tasks (id, user_id, service_type, payload, status, retry_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    taskId,
    userId,
    serviceType,
    JSON.stringify(payload),
    'pending',
    0,
    now,
    now
  ).run();
  
  // Log task creation
  await logTaskExecution(env, taskId, userId, serviceType, 'created', payload, request);
  
  return task;
}

/**
 * Executes a task with retry logic
 */
export async function executeTask(
  env: OpenClawEnv,
  taskId: string,
  executor: (payload: Record<string, unknown>) => Promise<Record<string, unknown>>,
  request?: Request
): Promise<Task> {
  // Get task from database
  const taskRow = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
  
  if (!taskRow) {
    throw new Error('Task not found');
  }
  
  const task: Task = {
    id: taskRow.id as string,
    userId: taskRow.user_id as string,
    serviceType: taskRow.service_type as string,
    payload: JSON.parse(taskRow.payload as string),
    status: taskRow.status as Task['status'],
    retryCount: taskRow.retry_count as number,
  };
  
  // Update status to processing
  await env.DB.prepare(`
    UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?
  `).bind('processing', Date.now(), taskId).run();
  
  await logTaskExecution(env, taskId, task.userId, task.serviceType, 'started', {}, request);
  
  try {
    // Execute with retry logic
    const result = await retryWithBackoff(
      () => executor(task.payload),
      DEFAULT_RETRY_CONFIG,
      async (attempt, error) => {
        // Update retry count
        await env.DB.prepare(`
          UPDATE tasks SET retry_count = ?, last_error = ?, updated_at = ? WHERE id = ?
        `).bind(attempt, error.message, Date.now(), taskId).run();
      }
    );
    
    // Mark as completed
    task.status = 'completed';
    task.result = result;
    
    await env.DB.prepare(`
      UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?
    `).bind('completed', Date.now(), Date.now(), taskId).run();
    
    await logTaskExecution(env, taskId, task.userId, task.serviceType, 'completed', result, request);
    
  } catch (error) {
    // Max retries exceeded, mark as failed
    const errorMessage = error instanceof Error ? error.message : String(error);
    task.status = 'failed';
    task.error = errorMessage;
    
    await env.DB.prepare(`
      UPDATE tasks SET status = ?, last_error = ?, updated_at = ? WHERE id = ?
    `).bind('failed', errorMessage, Date.now(), taskId).run();
    
    // Add to failed tasks queue for cron reprocessing
    await env.DB.prepare(`
      INSERT INTO failed_tasks (id, task_id, user_id, service_type, payload, error_message, retry_count, failed_at, next_retry_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      taskId,
      task.userId,
      task.serviceType,
      JSON.stringify(task.payload),
      errorMessage,
      task.retryCount,
      Date.now(),
      Date.now() + (5 * 60 * 1000) // Retry in 5 minutes
    ).run();
    
    await logTaskExecution(env, taskId, task.userId, task.serviceType, 'failed', { error: errorMessage }, request);
  }
  
  return task;
}

/**
 * Gets task status
 */
export async function getTask(env: OpenClawEnv, taskId: string): Promise<Task | null> {
  const taskRow = await env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(taskId).first();
  
  if (!taskRow) {
    return null;
  }
  
  const task: Task = {
    id: taskRow.id as string,
    userId: taskRow.user_id as string,
    serviceType: taskRow.service_type as string,
    payload: JSON.parse(taskRow.payload as string),
    status: taskRow.status as Task['status'],
    retryCount: taskRow.retry_count as number,
  };
  
  if (taskRow.last_error) {
    task.error = taskRow.last_error as string;
  }
  
  return task;
}

/**
 * Reprocesses failed tasks (called by cron trigger)
 */
export async function reprocessFailedTasks(env: OpenClawEnv): Promise<number> {
  const now = Date.now();
  
  // Get failed tasks ready for retry
  const failedTasks = await env.DB.prepare(`
    SELECT * FROM failed_tasks WHERE next_retry_at <= ?
  `).bind(now).all();
  
  let reprocessedCount = 0;
  
  for (const row of failedTasks.results) {
    try {
      const taskId = row.task_id as string;
      
      // Reset task status to pending
      await env.DB.prepare(`
        UPDATE tasks SET status = ?, retry_count = 0, updated_at = ? WHERE id = ?
      `).bind('pending', now, taskId).run();
      
      // Remove from failed tasks queue
      await env.DB.prepare('DELETE FROM failed_tasks WHERE id = ?').bind(row.id).run();
      
      reprocessedCount++;
    } catch (error) {
      console.error('Error reprocessing task:', error);
    }
  }
  
  return reprocessedCount;
}
/**
 * OpenClaw task engine with tiered pricing
 * Basic $0.50 / Pro $1.00 / Complex $2.00
 */

import { reserveFunds, confirmCharge, releaseReservation } from "../billing/usage-meter";
import {
  checkDailyLimit,
  incrementFreeTasksUsed,
  deductCredits,
  getCreditBalance,
} from "../billing/credit-wallet";
import { trackReferral } from "../referrals/referral-system";
import { getBackoffDelay } from "../utils/failover";
import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../types";

const DEFAULT_TIER_BASIC = 50;
const DEFAULT_TIER_STANDARD = 100;
const DEFAULT_TIER_COMPLEX = 200;
const MAX_RETRIES = 3;
const BACKOFF_DELAYS = [100, 200, 400]; // ms

/**
 * Rough token estimate: ~4 chars per token.
 */
export function estimateTokens(text: string): number {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Get total character count from payload (prompt, context, etc.).
 */
function getPayloadCharCount(payload: Record<string, unknown>): number {
  let total = 0;
  for (const v of Object.values(payload)) {
    if (typeof v === "string") total += v.length;
    else if (typeof v === "object" && v !== null) total += getPayloadCharCount(v as Record<string, unknown>);
  }
  return total;
}

/**
 * Check if payload indicates multi-step (e.g. steps, instructions array).
 */
function isMultiStep(payload: Record<string, unknown>): boolean {
  const steps = payload.steps ?? payload.instructions ?? payload.tasks;
  if (Array.isArray(steps) && steps.length > 1) return true;
  return false;
}

export type PriceTier = "basic" | "standard" | "complex" | "free" | "pro";

const FREE_TIER_DAILY_LIMIT = 50;

export interface TaskPriceResult {
  priceCents: number;
  tier: PriceTier;
}

/**
 * Calculate task price based on complexity/token count.
 * - Basic (<500 chars): $0.50
 * - Standard (500-2000 chars): $1.00
 * - Complex (>2000 chars or multi-step): $2.00
 */
export function calculateTaskPrice(
  payload: Record<string, unknown>,
  env?: Env
): TaskPriceResult {
  const basic = parseInt(env?.TASK_PRICE_TIER_BASIC ?? String(DEFAULT_TIER_BASIC), 10);
  const standard = parseInt(env?.TASK_PRICE_TIER_STANDARD ?? String(DEFAULT_TIER_STANDARD), 10);
  const complex = parseInt(env?.TASK_PRICE_TIER_COMPLEX ?? String(DEFAULT_TIER_COMPLEX), 10);

  const charCount = getPayloadCharCount(payload ?? {});
  const multiStep = isMultiStep(payload ?? {});

  if (multiStep || charCount > 2000) {
    return { priceCents: complex, tier: "complex" };
  }
  if (charCount >= 500) {
    return { priceCents: standard, tier: "standard" };
  }
  return { priceCents: basic, tier: "basic" };
}

export interface FreeTierLimitResult {
  allowed: boolean;
  remaining?: number;
  used?: number;
  limit?: number;
  reason?: string;
}

/**
 * Check free tier limit: 100 tasks/day per user.
 */
export async function checkFreeTierLimit(
  userId: string,
  db: D1Database
): Promise<FreeTierLimitResult> {
  const ts24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const row = await db
    .prepare(
      `SELECT COUNT(*) as cnt FROM tasks
       WHERE tenant_id = ? AND price_tier = 'free' AND created_at >= ?`
    )
    .bind(userId, ts24h)
    .first<{ cnt: number }>();

  const used = row?.cnt ?? 0;

  if (used >= FREE_TIER_DAILY_LIMIT) {
    return {
      allowed: false,
      used,
      limit: FREE_TIER_DAILY_LIMIT,
      remaining: 0,
      reason: "Free tier limit reached. Upgrade to Pro for $1/task unlimited.",
    };
  }

  return {
    allowed: true,
    used,
    limit: FREE_TIER_DAILY_LIMIT,
    remaining: FREE_TIER_DAILY_LIMIT - used,
  };
}

export interface OpenClawExecuteParams {
  userId: string;
  taskType?: string;
  payload?: Record<string, unknown>;
  ref?: string;
}

export interface OpenClawExecuteResult {
  success: boolean;
  taskId?: string;
  cost?: number;
  costCredits?: number;
  tier?: PriceTier;
  remainingToday?: number;
  creditsRemaining?: number;
  error?: string;
}

export type TaskTier = "free" | "pro" | "ai";

/**
 * Determine task cost from payload: ai/priority = 1 credit, else free.
 */
export function getTaskCostFromPayload(payload: Record<string, unknown>): { credits: number; tier: TaskTier } {
  if (payload?.ai === true) return { credits: 1, tier: "ai" };
  if (payload?.priority === true) return { credits: 1, tier: "pro" };
  return { credits: 0, tier: "free" };
}

export interface OpenClawStatusResult {
  found: boolean;
  taskId?: string;
  status?: "pending" | "completed" | "failed";
  createdAt?: string;
  completedAt?: string;
}

/**
 * Execute task with reserve → execute → confirm/release flow.
 * Retries up to 3 times with 100ms, 200ms, 400ms delays.
 */
export async function handleOpenClawExecute(
  params: OpenClawExecuteParams,
  db: D1Database,
  env?: Env
): Promise<OpenClawExecuteResult> {
  const taskId = crypto.randomUUID();

  if (params.ref && params.userId) {
    await trackReferral(params.ref, params.userId, db);
  }

  try {
    await db
      .prepare(
        `INSERT INTO tasks (id, service, tenant_id, payload, status) VALUES (?, 'openclaw', ?, ?, 'pending')`
      )
      .bind(taskId, params.userId, JSON.stringify(params.payload ?? {}))
      .run();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let lastError: string | undefined;

  const { priceCents: taskPriceCents } = calculateTaskPrice(params.payload ?? {}, env);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const reserve = await reserveFunds(db, params.userId, taskId, taskPriceCents);

    if (!reserve.success) {
      lastError = reserve.error ?? "Reserve failed";
      if (reserve.error?.includes("Duplicate")) {
        await db.prepare(`UPDATE tasks SET status = 'failed' WHERE id = ?`).bind(taskId).run();
        return { success: false, taskId, error: lastError };
      }
      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_DELAYS[attempt] ?? getBackoffDelay(attempt));
      }
      continue;
    }

    const reservationId = reserve.reservationId!;
    const execResult = await executeTaskLogic(params);

    if (execResult.success) {
      const confirm = await confirmCharge(db, reservationId, env);
      if (!confirm.success) {
        await releaseReservation(db, reservationId);
        await db.prepare(`UPDATE tasks SET status = 'failed' WHERE id = ?`).bind(taskId).run();
        return { success: false, taskId, error: confirm.error };
      }

      await db
        .prepare(
          `UPDATE tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
        )
        .bind(taskId)
        .run();

      const { tier } = calculateTaskPrice(params.payload ?? {}, env);
      return {
        success: true,
        taskId,
        cost: taskPriceCents / 100,
        tier,
      };
    }

    await releaseReservation(db, reservationId);
    lastError = execResult.error;

    if (attempt < MAX_RETRIES) {
      await sleep(BACKOFF_DELAYS[attempt] ?? getBackoffDelay(attempt));
    }
  }

  await db.prepare(`UPDATE tasks SET status = 'failed' WHERE id = ?`).bind(taskId).run();

  return {
    success: false,
    taskId,
    error: lastError ?? "Max retries exceeded",
  };
}

/**
 * Execute FREE tier task. No payment, 100/day limit.
 */
export async function handleOpenClawFreeExecute(
  params: OpenClawExecuteParams,
  db: D1Database
): Promise<OpenClawExecuteResult> {
  const limitCheck = await checkFreeTierLimit(params.userId, db);
  if (!limitCheck.allowed) {
    return { success: false, error: limitCheck.reason };
  }

  const taskId = crypto.randomUUID();

  if (params.ref && params.userId) {
    await trackReferral(params.ref, params.userId, db);
  }

  try {
    await db
      .prepare(
        `INSERT INTO tasks (id, service, tenant_id, payload, status, price_tier, charged)
         VALUES (?, 'openclaw', ?, ?, 'pending', 'free', 0)`
      )
      .bind(taskId, params.userId, JSON.stringify(params.payload ?? {}))
      .run();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const execResult = await executeTaskLogic(params);
  if (!execResult.success) {
    await db.prepare(`UPDATE tasks SET status = 'failed' WHERE id = ?`).bind(taskId).run();
    return { success: false, taskId, error: execResult.error };
  }

  await db
    .prepare(
      `UPDATE tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
    )
    .bind(taskId)
    .run();

  const updatedLimit = await checkFreeTierLimit(params.userId, db);
  return {
    success: true,
    taskId,
    cost: 0,
    tier: "free",
    remainingToday: updatedLimit.remaining ?? 0,
  };
}

/**
 * Unified execute: free (50/day) or credit-paid (1 credit for ai/priority).
 */
export async function handleOpenClawExecuteUnified(
  params: OpenClawExecuteParams,
  db: D1Database
): Promise<OpenClawExecuteResult> {
  const { credits, tier } = getTaskCostFromPayload(params.payload ?? {});

  if (params.ref && params.userId) {
    await trackReferral(params.ref, params.userId, db);
  }

  const taskId = crypto.randomUUID();

  try {
    if (credits === 0) {
      const limit = await checkDailyLimit(params.userId, db);
      if (!limit.allowed) {
        return { success: false, error: limit.reason };
      }

      await db
        .prepare(
          `INSERT INTO tasks (id, service, tenant_id, payload, status, price_tier, cost_credits)
           VALUES (?, 'openclaw', ?, ?, 'pending', ?, 0)`
        )
        .bind(taskId, params.userId, JSON.stringify(params.payload ?? {}), tier)
        .run();
    } else {
      const deduct = await deductCredits(params.userId, credits, db);
      if (!deduct.success) {
        return { success: false, error: deduct.error };
      }

      await db
        .prepare(
          `INSERT INTO tasks (id, service, tenant_id, payload, status, price_tier, cost_credits)
           VALUES (?, 'openclaw', ?, ?, 'pending', ?, ?)`
        )
        .bind(taskId, params.userId, JSON.stringify(params.payload ?? {}), tier, credits)
        .run();
    }
  } catch (err) {
    if (credits > 0) {
      const { addCredits } = await import("../billing/credit-wallet");
      await addCredits(params.userId, credits, db);
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const execResult = await executeTaskLogic(params);
  if (!execResult.success) {
    await db.prepare(`UPDATE tasks SET status = 'failed' WHERE id = ?`).bind(taskId).run();
    if (credits > 0) {
      const { addCredits } = await import("../billing/credit-wallet");
      await addCredits(params.userId, credits, db);
    }
    return { success: false, taskId, error: execResult.error };
  }

  if (credits === 0) {
    await incrementFreeTasksUsed(params.userId, db);
  }

  await db
    .prepare(
      `UPDATE tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
    )
    .bind(taskId)
    .run();

  const balance = await getCreditBalance(params.userId, db);
  return {
    success: true,
    taskId,
    cost: credits > 0 ? credits : 0,
    costCredits: credits,
    tier: tier as PriceTier,
    remainingToday: balance.freeTasksRemaining,
    creditsRemaining: balance.creditBalance,
  };
}

/**
 * Execute PRO tier task. $1.00 charge, unlimited.
 */
export async function handleOpenClawProExecute(
  params: OpenClawExecuteParams,
  db: D1Database,
  env?: Env
): Promise<OpenClawExecuteResult> {
  const taskId = crypto.randomUUID();
  const PRO_PRICE_CENTS = 100;

  if (params.ref && params.userId) {
    await trackReferral(params.ref, params.userId, db);
  }

  try {
    await db
      .prepare(
        `INSERT INTO tasks (id, service, tenant_id, payload, status, price_tier, charged)
         VALUES (?, 'openclaw', ?, ?, 'pending', 'pro', 1)`
      )
      .bind(taskId, params.userId, JSON.stringify(params.payload ?? {}))
      .run();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let lastError: string | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const reserve = await reserveFunds(db, params.userId, taskId, PRO_PRICE_CENTS);
    if (!reserve.success) {
      lastError = reserve.error ?? "Reserve failed";
      if (reserve.error?.includes("Duplicate")) {
        await db.prepare(`UPDATE tasks SET status = 'failed' WHERE id = ?`).bind(taskId).run();
        return { success: false, taskId, error: lastError };
      }
      if (attempt < MAX_RETRIES) {
        await sleep(BACKOFF_DELAYS[attempt] ?? getBackoffDelay(attempt));
      }
      continue;
    }

    const execResult = await executeTaskLogic(params);
    if (execResult.success) {
      const confirm = await confirmCharge(db, reserve.reservationId!, env);
      if (!confirm.success) {
        await releaseReservation(db, reserve.reservationId!);
        await db.prepare(`UPDATE tasks SET status = 'failed' WHERE id = ?`).bind(taskId).run();
        return { success: false, taskId, error: confirm.error };
      }
      await db
        .prepare(
          `UPDATE tasks SET status = 'completed', completed_at = datetime('now') WHERE id = ?`
        )
        .bind(taskId)
        .run();
      return {
        success: true,
        taskId,
        cost: PRO_PRICE_CENTS / 100,
        tier: "pro",
      };
    }

    await releaseReservation(db, reserve.reservationId!);
    lastError = execResult.error;
    if (attempt < MAX_RETRIES) {
      await sleep(BACKOFF_DELAYS[attempt] ?? getBackoffDelay(attempt));
    }
  }

  await db.prepare(`UPDATE tasks SET status = 'failed' WHERE id = ?`).bind(taskId).run();
  return { success: false, taskId, error: lastError ?? "Max retries exceeded" };
}

/**
 * Simulate task execution (setTimeout). Replace with real logic.
 */
async function executeTaskLogic(params: OpenClawExecuteParams): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    setTimeout(() => {
      // Simulate: always succeed for now. Replace with actual task logic.
      resolve({ success: true });
    }, 10);
  });
}

/**
 * Query D1 for task status by taskId.
 */
export async function getOpenClawTaskStatus(
  taskId: string,
  db: D1Database
): Promise<OpenClawStatusResult> {
  try {
    const row = await db
      .prepare(
        `SELECT id, status, created_at, completed_at FROM tasks
         WHERE id = ? AND service = 'openclaw'`
      )
      .bind(taskId)
      .first<{ id: string; status: string; created_at: string; completed_at: string | null }>();

    if (!row) {
      return { found: false };
    }

    const status = row.status === "completed" ? "completed" : row.status === "failed" ? "failed" : "pending";

    return {
      found: true,
      taskId: row.id,
      status,
      createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    };
  } catch {
    return { found: false };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Legacy adapter for /api/task and reprocessFailedTasks.
 * Maps tenantId -> userId, uses handleOpenClawExecute.
 */
export async function executeOpenClawTask(
  task: { tenantId: string; payload: Record<string, unknown> },
  _apiKey: string,
  db?: D1Database
): Promise<{ success: boolean; data?: { taskId?: string; cost?: number }; error?: string }> {
  if (!db) {
    return { success: false, error: "DB not provided" };
  }
  const result = await handleOpenClawExecute(
    { userId: task.tenantId, payload: task.payload },
    db
  );
  return {
    success: result.success,
    data: result.success ? { taskId: result.taskId, cost: result.cost } : undefined,
    error: result.error,
  };
}
