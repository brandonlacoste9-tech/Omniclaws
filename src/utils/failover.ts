// Failover and resilience utilities: Circuit breakers, exponential backoff, retry logic
import type { CircuitBreakerState, RetryConfig } from '../types';

/**
 * Circuit breaker implementation to prevent cascading failures
 */
export class CircuitBreaker {
  private state: CircuitBreakerState;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(failureThreshold = 5, resetTimeoutMs = 60000) {
    this.state = {
      failures: 0,
      lastFailureTime: 0,
      state: 'closed'
    };
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit should be reset
    if (this.state.state === 'open') {
      const now = Date.now();
      if (now - this.state.lastFailureTime > this.resetTimeoutMs) {
        this.state.state = 'half-open';
        this.state.failures = 0;
      } else {
        throw new Error('Circuit breaker is OPEN - service temporarily unavailable');
      }
    }

    try {
      const result = await fn();
      // Success - reset circuit if in half-open state
      if (this.state.state === 'half-open') {
        this.state.state = 'closed';
        this.state.failures = 0;
      }
      return result;
    } catch (error) {
      this.state.failures++;
      this.state.lastFailureTime = Date.now();

      // Open circuit if threshold exceeded
      if (this.state.failures >= this.failureThreshold) {
        this.state.state = 'open';
      }

      throw error;
    }
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }

  reset(): void {
    this.state = {
      failures: 0,
      lastFailureTime: 0,
      state: 'closed'
    };
  }
}

/**
 * Exponential backoff retry logic with jitter
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    factor: 2
  }
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on last attempt
      if (attempt === config.maxRetries) {
        break;
      }

      // Calculate exponential backoff with jitter
      const baseDelay = Math.min(
        config.initialDelayMs * Math.pow(config.factor, attempt),
        config.maxDelayMs
      );
      const jitter = Math.random() * 0.3 * baseDelay; // ±30% jitter
      const delay = baseDelay + jitter;

      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Sleep utility for async delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Rate limiter using token bucket algorithm
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per second

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async acquire(tokens = 1): Promise<boolean> {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    return false;
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = timePassed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

/**
 * Queue for failed tasks to be reprocessed by cron
 */
export class FailedTaskQueue {
  private db: D1Database;

  constructor(db: D1Database) {
    this.db = db;
  }

  async enqueue(taskId: string, error: string): Promise<void> {
    await this.db
      .prepare(
        'UPDATE tasks SET status = ?, last_error = ?, retry_count = retry_count + 1 WHERE id = ?'
      )
      .bind('failed', error, taskId)
      .run();
  }

  async getFailedTasks(limit = 100): Promise<Array<{ id: string; retry_count: number }>> {
    const result = await this.db
      .prepare(
        'SELECT id, retry_count FROM tasks WHERE status = ? AND retry_count < 5 ORDER BY created_at ASC LIMIT ?'
      )
      .bind('failed', limit)
      .all();

    return result.results as Array<{ id: string; retry_count: number }>;
  }

  async markAsProcessing(taskId: string): Promise<void> {
    await this.db
      .prepare('UPDATE tasks SET status = ?, started_at = ? WHERE id = ?')
      .bind('processing', Date.now(), taskId)
      .run();
  }
}
