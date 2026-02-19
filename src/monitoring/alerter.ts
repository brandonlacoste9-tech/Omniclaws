/**
 * Omniclaws Watchdog - 24/7 system health monitoring
 * Triggers Discord alerts for failures, compliance risks, circuit breaker
 */

import type { D1Database } from "@cloudflare/workers-types";
import { checkCircuitBreaker } from "../utils/failover";
import type { Env } from "../types";

const FAILED_TASK_RATE_THRESHOLD = 0.05;
const REVENUE_DROUGHT_MINUTES = 15;
const HUMAN_REVIEW_QUEUE_THRESHOLD = 100;
const CLOUDFLARE_DASHBOARD = "https://dash.cloudflare.com";

export type AlertLevel = "warning" | "critical" | "recovery";

export interface HealthCheckResult {
  healthy: boolean;
  alerts: Array<{ level: AlertLevel; message: string; metric?: string }>;
}

/**
 * Check system health and return alerts if thresholds exceeded.
 */
export async function checkSystemHealth(
  db: D1Database,
  env: Env
): Promise<HealthCheckResult> {
  const alerts: Array<{ level: AlertLevel; message: string; metric?: string }> = [];

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const fifteenMinAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  const [taskStats, revenueRow, humanReviewCount, circuitState] = await Promise.all([
    db.prepare(
      `SELECT
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
       FROM tasks WHERE created_at >= ?`
    ).bind(tenMinAgo).first<{ completed: number; failed: number }>(),
    db.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) as total FROM usage_ledger
       WHERE status = 'processed' AND processed_at >= ?`
    ).bind(fifteenMinAgo).first<{ total: number }>(),
    db.prepare(
      `SELECT COUNT(*) as cnt FROM human_review_queue WHERE resolution IS NULL`
    ).first<{ cnt: number }>(),
    checkCircuitBreaker(db),
  ]);

  const completed = taskStats?.completed ?? 0;
  const failed = taskStats?.failed ?? 0;
  const total = completed + failed;
  const failureRate = total > 0 ? failed / total : 0;

  if (total >= 10 && failureRate > FAILED_TASK_RATE_THRESHOLD) {
    alerts.push({
      level: "critical",
      message: `Task failure rate ${(failureRate * 100).toFixed(1)}% in last 10 minutes (${failed}/${total} failed). Check circuit breaker and failed_tasks queue.`,
      metric: `failure_rate=${failureRate}`,
    });
  }

  const hour = new Date().getHours();
  const isBusinessHours = hour >= 9 && hour <= 17;
  const revenueCents = revenueRow?.total ?? 0;
  if (isBusinessHours && revenueCents === 0 && total > 0) {
    alerts.push({
      level: "warning",
      message: `Revenue $0 for >15 minutes during business hours. ${total} tasks in window. Check billing integration.`,
      metric: "revenue_drought",
    });
  }

  const pendingReviews = humanReviewCount?.cnt ?? 0;
  if (pendingReviews > HUMAN_REVIEW_QUEUE_THRESHOLD) {
    alerts.push({
      level: "critical",
      message: `Human review queue at ${pendingReviews} items (EU AI Act compliance risk). Threshold: ${HUMAN_REVIEW_QUEUE_THRESHOLD}. Scale review capacity.`,
      metric: `human_review_queue=${pendingReviews}`,
    });
  }

  if (circuitState.open) {
    alerts.push({
      level: "critical",
      message: `Circuit breaker OPEN. Service returning 503. Error rate exceeded 10% in last 5 min. Check ${CLOUDFLARE_DASHBOARD} Workers logs.`,
      metric: "circuit_breaker_open",
    });
  }

  return {
    healthy: alerts.length === 0,
    alerts,
  };
}

/**
 * Send alert to Discord webhook with embed.
 */
export async function sendAlert(
  level: AlertLevel,
  message: string,
  env: Env,
  metadata?: Record<string, unknown>
): Promise<boolean> {
  const webhookUrl = env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log(`[alerter] Alert (no webhook): ${level} - ${message}`);
    return false;
  }

  const color = level === "critical" ? 0xff0000 : level === "warning" ? 0xffaa00 : 0x00ff00;
  const envLabel = env.ENVIRONMENT ?? "production";

  const embed = {
    title: `Omniclaws ${level.toUpperCase()}`,
    description: message,
    color,
    fields: [
      { name: "Environment", value: envLabel, inline: true },
      { name: "Timestamp", value: new Date().toISOString(), inline: true },
      { name: "Dashboard", value: `${CLOUDFLARE_DASHBOARD}`, inline: false },
      ...(metadata ? Object.entries(metadata).map(([k, v]) => ({ name: k, value: String(v), inline: true })) : []),
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      console.error(`[alerter] Discord webhook failed: ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[alerter] Discord send failed:", err);
    return false;
  }
}

/**
 * Run health check and send alerts for any issues.
 */
export async function runHealthCheckAndAlert(db: D1Database, env: Env): Promise<void> {
  const result = await checkSystemHealth(db, env);

  for (const alert of result.alerts) {
    await sendAlert(alert.level, alert.message, env, { metric: alert.metric });
    await db.prepare(
      `INSERT INTO system_alerts (id, level, message) VALUES (?, ?, ?)`
    ).bind(crypto.randomUUID(), alert.level, alert.message).run();
  }
}
