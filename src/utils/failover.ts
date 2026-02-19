/**
 * Self-healing: retry logic, circuit breaker with D1-backed error tracking
 * Circuit open when error rate > 10% in last 5 minutes, 503 for 60 seconds
 */

import type { D1Database } from "@cloudflare/workers-types";

const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 100;
const ERROR_RATE_THRESHOLD = 0.1;
const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const CIRCUIT_OPEN_MS = 60 * 1000; // 60 seconds

/**
 * Exponential backoff delays: 100ms, 200ms, 400ms
 */
export function getBackoffDelay(attempt: number): number {
  return BASE_DELAY_MS * Math.pow(2, attempt);
}

/**
 * Execute with retry and exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = DEFAULT_MAX_RETRIES
): Promise<{ success: true; data: T } | { success: false; error: Error }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const data = await fn();
      return { success: true, data };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delay = getBackoffDelay(attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  return {
    success: false,
    error: lastError ?? new Error("Unknown retry failure"),
  };
}

/**
 * Circuit breaker: if error rate > 10% in last 5 min, return 503 for 60 seconds.
 * Uses D1 for persistence (Workers are stateless).
 */
export async function checkCircuitBreaker(db: D1Database): Promise<{
  open: boolean;
  message?: string;
}> {
  const now = Date.now();
  const periodStart = now - WINDOW_MS;

  try {
    const state = await db
      .prepare(
        `SELECT period_start_ts, total_requests, error_count, circuit_open_until_ts
         FROM circuit_breaker_state WHERE id = 'default'`
      )
      .first<{
        period_start_ts: number;
        total_requests: number;
        error_count: number;
        circuit_open_until_ts: number;
      }>();

    if (state?.circuit_open_until_ts && now < state.circuit_open_until_ts) {
      return { open: true, message: "Service temporarily unavailable" };
    }

    if (state) {
      const periodStartDb = state.period_start_ts;
      const total = state.total_requests;
      const errors = state.error_count;

      if (periodStartDb < periodStart) {
        await db
          .prepare(
            `UPDATE circuit_breaker_state SET period_start_ts = ?, total_requests = 0, error_count = 0, circuit_open_until_ts = 0 WHERE id = 'default'`
          )
          .bind(now)
          .run();
        return { open: false };
      }

      if (total >= 10) {
        const rate = errors / total;
        if (rate > ERROR_RATE_THRESHOLD) {
          const openUntil = now + CIRCUIT_OPEN_MS;
          await db
            .prepare(
              `UPDATE circuit_breaker_state SET circuit_open_until_ts = ? WHERE id = 'default'`
            )
            .bind(openUntil)
            .run();
          return { open: true, message: "Service temporarily unavailable" };
        }
      }
    }

    return { open: false };
  } catch {
    return { open: false };
  }
}

/**
 * Record request outcome for circuit breaker. Call after each request.
 */
export async function recordCircuitBreakerOutcome(
  db: D1Database,
  isError: boolean
): Promise<void> {
  const now = Date.now();
  const periodStart = now - WINDOW_MS;

  try {
    const state = await db
      .prepare(
        `SELECT period_start_ts, total_requests, error_count FROM circuit_breaker_state WHERE id = 'default'`
      )
      .first<{ period_start_ts: number; total_requests: number; error_count: number }>();

    if (!state) {
      await db
        .prepare(
          `INSERT INTO circuit_breaker_state (id, period_start_ts, total_requests, error_count, circuit_open_until_ts)
         VALUES ('default', ?, 1, ?, 0)`
        )
        .bind(now, isError ? 1 : 0)
        .run();
      return;
    }

    if (state.period_start_ts < periodStart) {
      await db
        .prepare(
          `UPDATE circuit_breaker_state SET period_start_ts = ?, total_requests = 1, error_count = ? WHERE id = 'default'`
        )
        .bind(now, isError ? 1 : 0)
        .run();
      return;
    }

    await db
      .prepare(
        `UPDATE circuit_breaker_state SET total_requests = total_requests + 1, error_count = error_count + ? WHERE id = 'default'`
      )
      .bind(isError ? 1 : 0)
      .run();
  } catch {
    // Ignore - don't fail request for circuit breaker tracking
  }
}

/**
 * In-memory circuit breaker for single-isolate scenarios (legacy).
 */
export class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private readonly threshold: number;
  private readonly resetMs: number;

  constructor(threshold = 5, resetMs = 60000) {
    this.threshold = threshold;
    this.resetMs = resetMs;
  }

  isOpen(): boolean {
    if (this.failures < this.threshold) return false;
    if (Date.now() - this.lastFailure > this.resetMs) {
      this.failures = 0;
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
  }
}
