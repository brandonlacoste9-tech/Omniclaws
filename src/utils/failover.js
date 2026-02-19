/**
 * Circuit breaker implementation to prevent cascading failures
 */
export class CircuitBreaker {
    constructor(failureThreshold = 5, resetTimeoutMs = 60000) {
        this.state = {
            failures: 0,
            lastFailureTime: 0,
            state: 'closed'
        };
        this.failureThreshold = failureThreshold;
        this.resetTimeoutMs = resetTimeoutMs;
    }
    async execute(fn) {
        // Check if circuit should be reset
        if (this.state.state === 'open') {
            const now = Date.now();
            if (now - this.state.lastFailureTime > this.resetTimeoutMs) {
                this.state.state = 'half-open';
                this.state.failures = 0;
            }
            else {
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
        }
        catch (error) {
            this.state.failures++;
            this.state.lastFailureTime = Date.now();
            // Open circuit if threshold exceeded
            if (this.state.failures >= this.failureThreshold) {
                this.state.state = 'open';
            }
            throw error;
        }
    }
    getState() {
        return { ...this.state };
    }
    reset() {
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
export async function retryWithBackoff(fn, config = {
    maxRetries: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    factor: 2
}) {
    let lastError;
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            // Don't retry on last attempt
            if (attempt === config.maxRetries) {
                break;
            }
            // Calculate exponential backoff with jitter
            const baseDelay = Math.min(config.initialDelayMs * Math.pow(config.factor, attempt), config.maxDelayMs);
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
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
/**
 * Rate limiter using token bucket algorithm
 */
export class RateLimiter {
    constructor(capacity, refillRate) {
        this.capacity = capacity;
        this.refillRate = refillRate;
        this.tokens = capacity;
        this.lastRefill = Date.now();
    }
    async acquire(tokens = 1) {
        this.refill();
        if (this.tokens >= tokens) {
            this.tokens -= tokens;
            return true;
        }
        return false;
    }
    refill() {
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
    constructor(db) {
        this.db = db;
    }
    async enqueue(taskId, error) {
        await this.db
            .prepare('UPDATE tasks SET status = ?, last_error = ?, retry_count = retry_count + 1 WHERE id = ?')
            .bind('failed', error, taskId)
            .run();
    }
    async getFailedTasks(limit = 100) {
        const result = await this.db
            .prepare('SELECT id, retry_count FROM tasks WHERE status = ? AND retry_count < 5 ORDER BY created_at ASC LIMIT ?')
            .bind('failed', limit)
            .all();
        return result.results;
    }
    async markAsProcessing(taskId) {
        await this.db
            .prepare('UPDATE tasks SET status = ?, started_at = ? WHERE id = ?')
            .bind('processing', Date.now(), taskId)
            .run();
    }
}
