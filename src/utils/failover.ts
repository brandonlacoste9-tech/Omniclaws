/**
 * Failover and Retry Logic with Circuit Breakers
 * Implements exponential backoff and self-healing mechanisms
 */

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Circuit breaker states
 */
export enum CircuitState {
  CLOSED = 'closed', // Normal operation
  OPEN = 'open',     // Too many failures, rejecting requests
  HALF_OPEN = 'half_open', // Testing if service recovered
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTimeMs: number;
  successThreshold: number;
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeMs: 60000, // 1 minute
  successThreshold: 2,
};

/**
 * Circuit breaker implementation
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptTime = 0;
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG) {
    this.config = config;
  }

  canAttempt(): boolean {
    if (this.state === CircuitState.CLOSED) {
      return true;
    }
    
    if (this.state === CircuitState.OPEN) {
      if (Date.now() >= this.nextAttemptTime) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        return true;
      }
      return false;
    }
    
    // HALF_OPEN state
    return true;
  }

  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
      }
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount = 0;
    }
  }

  recordFailure(): void {
    this.failureCount++;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.recoveryTimeMs;
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.recoveryTimeMs;
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

/**
 * Calculates exponential backoff delay
 */
export function calculateBackoff(
  attemptNumber: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const delay = Math.min(
    config.initialDelayMs * Math.pow(config.backoffMultiplier, attemptNumber),
    config.maxDelayMs
  );
  
  // Add jitter to prevent thundering herd
  const jitter = Math.random() * 0.1 * delay;
  return Math.floor(delay + jitter);
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  circuitBreaker?: CircuitBreaker
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    // Check circuit breaker
    if (circuitBreaker && !circuitBreaker.canAttempt()) {
      throw new Error('Circuit breaker is OPEN, request rejected');
    }
    
    try {
      const result = await fn();
      
      if (circuitBreaker) {
        circuitBreaker.recordSuccess();
      }
      
      return result;
    } catch (error) {
      lastError = error as Error;
      
      if (circuitBreaker) {
        circuitBreaker.recordFailure();
      }
      
      // Don't retry if it's the last attempt
      if (attempt === config.maxRetries) {
        break;
      }
      
      // Calculate and wait for backoff
      const delayMs = calculateBackoff(attempt, config);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw lastError || new Error('Retry failed with unknown error');
}

/**
 * Calculates next retry time for failed tasks
 */
export function getNextRetryTime(retryCount: number): number {
  const delayMs = calculateBackoff(retryCount);
  return Date.now() + delayMs;
}

/**
 * Checks if a task should be retried based on error type
 */
export function shouldRetry(error: Error): boolean {
  const message = error.message.toLowerCase();
  
  // Don't retry validation errors or client errors
  if (message.includes('validation') || 
      message.includes('invalid') ||
      message.includes('unauthorized') ||
      message.includes('forbidden')) {
    return false;
  }
  
  // Retry network errors, timeouts, and server errors
  return true;
}
