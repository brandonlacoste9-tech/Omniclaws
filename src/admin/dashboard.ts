/**
 * Omniclaws Admin Command Center
 * Dashboard metrics, realtime stream, deep health check
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { Env } from "../types";

export interface DashboardMetrics {
  revenue: {
    last24h: number;
    last7d: number;
    last30d: number;
    byStream: { openclaw: number; qemplois: number; zyeute: number; whale: number };
  };
  tasks: {
    completed: number;
    failed: number;
    pending: number;
    successRate: number;
  };
  freemium: {
    freeTasks24h: number;
    freeLimit: number;
    creditPurchases24h: number;
    revenueFromCredits24h: number;
    totalCreditsInCirculation: number;
  };
  compliance: {
    euHighRiskDecisions: number;
    humanReviewsPending: number;
    gdprRequests: number;
  };
  billing: {
    stripeConnected: boolean;
    paddleConnected: boolean;
    failedCharges: number;
  };
  whaleAlerts24h: number;
}

/**
 * Aggregate dashboard metrics from D1 tables.
 */
export async function getDashboardMetrics(
  db: D1Database,
  env: Env
): Promise<DashboardMetrics> {
  const now = new Date();
  const ts24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const ts7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const ts30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const FREE_TIER_LIMIT = 50;

  const [usage24h, usage7d, usage30d, tasksStats, humanReviewPending, humanReviewTotal, failedCharges, gdprCount, freeTasks24h, creditPurchases24h, totalCreditsInCirculation, whaleAlerts24h] =
    await Promise.all([
      db.prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) as total FROM usage_ledger
         WHERE status = 'processed' AND processed_at >= ?`
      ).bind(ts24h).first<{ total: number }>(),
      db.prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) as total FROM usage_ledger
         WHERE status = 'processed' AND processed_at >= ?`
      ).bind(ts7d).first<{ total: number }>(),
      db.prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) as total FROM usage_ledger
         WHERE status = 'processed' AND processed_at >= ?`
      ).bind(ts30d).first<{ total: number }>(),
      db.prepare(
        `SELECT
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
         FROM tasks WHERE created_at >= ?`
      ).bind(ts24h).first<{ completed: number; failed: number; pending: number }>(),
      db.prepare(
        `SELECT COUNT(*) as cnt FROM human_review_queue WHERE resolution IS NULL`
      ).first<{ cnt: number }>(),
      db.prepare(
        `SELECT COUNT(*) as cnt FROM human_review_queue`
      ).first<{ cnt: number }>(),
      db.prepare(
        `SELECT COUNT(*) as cnt FROM billing_transactions
         WHERE status = 'failed' AND created_at >= ?`
      ).bind(ts24h).first<{ cnt: number }>(),
      db.prepare(
        `SELECT COUNT(*) as cnt FROM tasks WHERE status = 'gdpr_deleted'`
      ).first<{ cnt: number }>(),
      db.prepare(
        `SELECT COUNT(*) as cnt FROM tasks WHERE price_tier = 'free' AND created_at >= ?`
      ).bind(ts24h).first<{ cnt: number }>(),
      db.prepare(
        `SELECT COUNT(*) as cnt, COALESCE(SUM(amount_cents), 0) as total FROM credit_purchases WHERE created_at >= ?`
      ).bind(ts24h).first<{ cnt: number; total: number }>(),
      db.prepare(
        `SELECT COALESCE(SUM(credit_balance), 0) as total FROM user_credits`
      ).first<{ total: number }>(),
      db.prepare(
        `SELECT COUNT(*) as cnt FROM whale_alerts WHERE detected_at >= ?`
      ).bind(ts24h).first<{ cnt: number }>(),
    ]);

  const byStream = await db.prepare(
    `SELECT t.service, COALESCE(SUM(u.amount_cents), 0) as total
     FROM usage_ledger u
     LEFT JOIN tasks t ON u.task_id = t.id
     WHERE u.status = 'processed' AND u.processed_at >= ?
     GROUP BY t.service`
  ).bind(ts24h).all<{ service: string | null; total: number }>();

  const [zyeute24h, zyeute7d, zyeute30d] = await Promise.all([
    db.prepare(
      `SELECT COALESCE(SUM(commission_cents), 0) as total FROM content_jobs
       WHERE status = 'published' AND published_at >= ?`
    ).bind(ts24h).first<{ total: number }>(),
    db.prepare(
      `SELECT COALESCE(SUM(commission_cents), 0) as total FROM content_jobs
       WHERE status = 'published' AND published_at >= ?`
    ).bind(ts7d).first<{ total: number }>(),
    db.prepare(
      `SELECT COALESCE(SUM(commission_cents), 0) as total FROM content_jobs
       WHERE status = 'published' AND published_at >= ?`
    ).bind(ts30d).first<{ total: number }>(),
  ]);

  const streamMap: Record<string, number> = {
    openclaw: 0,
    qemplois: 0,
    zyeute: (zyeute24h?.total ?? 0) / 100,
    whale: 0,
  };
  for (const row of byStream.results ?? []) {
    const key = row.service === "openclaw" ? "openclaw"
      : row.service === "q-emplois" ? "qemplois"
      : row.service === "whale" ? "whale"
      : "other";
    if (key !== "other") {
      streamMap[key] = (streamMap[key] ?? 0) + ((row.total ?? 0) / 100);
    }
  }

  const freeUsed = freeTasks24h?.cnt ?? 0;
  const creditPurchasesCount = creditPurchases24h?.cnt ?? 0;
  const revenueFromCredits24h = (creditPurchases24h?.total ?? 0) / 100;
  const totalCredits = totalCreditsInCirculation?.total ?? 0;

  const completed = tasksStats?.completed ?? 0;
  const failed = tasksStats?.failed ?? 0;
  const pending = tasksStats?.pending ?? 0;
  const total = completed + failed;
  const successRate = total > 0 ? (completed / total) * 100 : 100;

  const revenue24h = (usage24h?.total ?? 0) / 100 + (zyeute24h?.total ?? 0) / 100;
  const revenue7d = (usage7d?.total ?? 0) / 100 + (zyeute7d?.total ?? 0) / 100;
  const revenue30d = (usage30d?.total ?? 0) / 100 + (zyeute30d?.total ?? 0) / 100;

  return {
    revenue: {
      last24h: revenue24h,
      last7d: revenue7d,
      last30d: revenue30d,
      byStream: {
        openclaw: streamMap.openclaw,
        qemplois: streamMap.qemplois,
        zyeute: streamMap.zyeute,
        whale: streamMap.whale,
      },
    },
    tasks: {
      completed,
      failed,
      pending,
      successRate,
    },
    freemium: {
      freeTasks24h: freeUsed,
      freeLimit: FREE_TIER_LIMIT,
      creditPurchases24h: creditPurchasesCount,
      revenueFromCredits24h,
      totalCreditsInCirculation: totalCredits,
    },
    compliance: {
      euHighRiskDecisions: humanReviewTotal?.cnt ?? 0,
      humanReviewsPending: humanReviewPending?.cnt ?? 0,
      gdprRequests: gdprCount?.cnt ?? 0,
    },
    billing: {
      stripeConnected: !!env.STRIPE_SECRET_KEY,
      paddleConnected: !!env.PADDLE_API_KEY,
      failedCharges: failedCharges?.cnt ?? 0,
    },
    whaleAlerts24h: whaleAlerts24h?.cnt ?? 0,
  };
}

/**
 * Realtime stream: current minute's task count and revenue.
 */
export async function getRealtimeStream(db: D1Database): Promise<{
  minuteTasks: number;
  minuteRevenueCents: number;
  timestamp: string;
}> {
  const now = new Date();
  const minuteStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).toISOString();

  const [taskRow, revenueRow] = await Promise.all([
    db.prepare(
      `SELECT COUNT(*) as cnt FROM tasks WHERE created_at >= ?`
    ).bind(minuteStart).first<{ cnt: number }>(),
    db.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) as total FROM usage_ledger
       WHERE status = 'processed' AND processed_at >= ?`
    ).bind(minuteStart).first<{ total: number }>(),
  ]);

  return {
    minuteTasks: taskRow?.cnt ?? 0,
    minuteRevenueCents: revenueRow?.total ?? 0,
    timestamp: now.toISOString(),
  };
}

/**
 * Deep health check: D1, R2, Paddle, Stripe connectivity.
 */
export async function deepHealthCheck(
  db: D1Database,
  bucket: R2Bucket,
  env: Env
): Promise<{
  healthy: boolean;
  checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }>;
}> {
  const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

  const d1Start = Date.now();
  try {
    await db.prepare("SELECT 1").first();
    checks.d1 = { ok: true, latencyMs: Date.now() - d1Start };
  } catch (err) {
    checks.d1 = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const r2Start = Date.now();
  try {
    const key = `health-check-${Date.now()}.txt`;
    await bucket.put(key, "ok");
    await bucket.delete(key);
    checks.r2 = { ok: true, latencyMs: Date.now() - r2Start };
  } catch (err) {
    checks.r2 = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (env.PADDLE_API_KEY) {
    const paddleStart = Date.now();
    try {
      const res = await fetch("https://api.paddle.com/customers?per_page=1", {
        headers: { Authorization: `Bearer ${env.PADDLE_API_KEY}` },
      });
      checks.paddle = { ok: res.ok, latencyMs: Date.now() - paddleStart };
    } catch (err) {
      checks.paddle = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  } else {
    checks.paddle = { ok: false, error: "Not configured" };
  }

  if (env.STRIPE_SECRET_KEY) {
    const stripeStart = Date.now();
    try {
      const res = await fetch("https://api.stripe.com/v1/customers?limit=1", {
        headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
      });
      checks.stripe = { ok: res.ok, latencyMs: Date.now() - stripeStart };
    } catch (err) {
      checks.stripe = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  } else {
    checks.stripe = { ok: false, error: "Not configured" };
  }

  const healthy = Object.values(checks).every((c) => c.ok);

  return { healthy, checks };
}
