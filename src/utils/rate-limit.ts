/**
 * IP-based rate limiting for abuse prevention.
 * Uses D1 to track requests per IP per minute.
 */

import type { D1Database } from "@cloudflare/workers-types";

const WINDOW_MINUTES = 1;
const MAX_REQUESTS_PER_WINDOW = 30;

/**
 * Check and increment rate limit. Returns true if allowed, false if exceeded.
 */
export async function checkRateLimit(
  ip: string,
  endpoint: string,
  db: D1Database
): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
  const now = new Date();
  const windowStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    now.getMinutes()
  ).toISOString().slice(0, 16);

  await db
    .prepare(
      `INSERT INTO rate_limit (ip, endpoint, window_start, request_count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(ip, endpoint, window_start) DO UPDATE SET request_count = request_count + 1`
    )
    .bind(ip, endpoint, windowStart)
    .run();

  const row = await db
    .prepare(
      `SELECT request_count FROM rate_limit WHERE ip = ? AND endpoint = ? AND window_start = ?`
    )
    .bind(ip, endpoint, windowStart)
    .first<{ request_count: number }>();

  const count = row?.request_count ?? 1;

  if (count > MAX_REQUESTS_PER_WINDOW) {
    const nextWindow = new Date(now.getTime() + 60 * 1000);
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((nextWindow.getTime() - now.getTime()) / 1000),
    };
  }

  return {
    allowed: true,
    remaining: Math.max(0, MAX_REQUESTS_PER_WINDOW - count),
  };
}

/**
 * Prune old rate limit rows (call from cron to avoid table bloat).
 */
export async function pruneRateLimitTable(db: D1Database): Promise<number> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 16);
  const result = await db
    .prepare(`DELETE FROM rate_limit WHERE window_start < ?`)
    .bind(cutoff)
    .run();
  return result.meta.changes ?? 0;
}
