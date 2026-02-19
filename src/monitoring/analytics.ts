/**
 * Revenue optimization analytics
 * Event tracking for ML, top customers, churn risk
 */

import type { D1Database } from "@cloudflare/workers-types";

export type AnalyticsEventType =
  | "task_start"
  | "task_complete"
  | "charge_success"
  | "charge_fail";

/**
 * Track event for later ML optimization.
 */
export async function trackEvent(
  db: D1Database,
  event: AnalyticsEventType,
  metadata: Record<string, unknown>,
  userId?: string,
  taskId?: string,
  region?: string
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO analytics_events (id, event_type, user_id, task_id, metadata_json, region)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        event,
        userId ?? null,
        taskId ?? null,
        JSON.stringify(metadata),
        region ?? null
      )
      .run();
  } catch (err) {
    console.error("[analytics] trackEvent failed:", err);
  }
}

/**
 * Batch insert events (D1 write optimization).
 */
export async function trackEventBatch(
  db: D1Database,
  events: Array<{
    event: AnalyticsEventType;
    metadata: Record<string, unknown>;
    userId?: string;
    taskId?: string;
    region?: string;
  }>
): Promise<void> {
  if (events.length === 0) return;

  try {
    const stmt = db.prepare(
      `INSERT INTO analytics_events (id, event_type, user_id, task_id, metadata_json, region)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    const batch = events.map((e) =>
      stmt.bind(
        crypto.randomUUID(),
        e.event,
        e.userId ?? null,
        e.taskId ?? null,
        JSON.stringify(e.metadata),
        e.region ?? null
      )
    );

    await db.batch(batch);
  } catch (err) {
    console.error("[analytics] trackEventBatch failed:", err);
  }
}

/**
 * Top revenue users for outreach.
 */
export async function getTopCustomers(
  db: D1Database,
  limit: number = 10
): Promise<Array<{ userId: string; revenueCents: number; taskCount: number }>> {
  const rows = await db.prepare(
    `SELECT user_id, SUM(amount_cents) as revenue_cents, COUNT(*) as task_count
     FROM usage_ledger WHERE status = 'processed'
     GROUP BY user_id ORDER BY revenue_cents DESC LIMIT ?`
  ).bind(limit).all<{ user_id: string; revenue_cents: number; task_count: number }>();

  return (rows.results ?? []).map((r) => ({
    userId: r.user_id,
    revenueCents: r.revenue_cents ?? 0,
    taskCount: r.task_count ?? 0,
  }));
}

/**
 * Users with failed charges or declining usage (churn risk).
 */
export async function getChurnRisk(
  db: D1Database
): Promise<Array<{
  userId: string;
  failedCharges: number;
  lastSuccessAt: string | null;
  riskScore: number;
}>> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const rows = await db.prepare(
    `SELECT
       user_id,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
       MAX(CASE WHEN status = 'succeeded' THEN created_at END) as last_success
     FROM billing_transactions
     WHERE created_at >= ?
     GROUP BY user_id
     HAVING failed_count > 0`
  ).bind(sevenDaysAgo).all<{ user_id: string; failed_count: number; last_success: string | null }>();

  return (rows.results ?? []).map((r) => {
    const failedCharges = r.failed_count ?? 0;
    const daysSinceSuccess = r.last_success
      ? (Date.now() - new Date(r.last_success).getTime()) / (24 * 60 * 60 * 1000)
      : 7;
    const riskScore = Math.min(100, failedCharges * 20 + daysSinceSuccess * 5);
    return {
      userId: r.user_id,
      failedCharges,
      lastSuccessAt: r.last_success,
      riskScore: Math.round(riskScore),
    };
  });
}
