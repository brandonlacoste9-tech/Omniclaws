/**
 * Failover utilities: Circuit breakers and retry logic with exponential backoff
 * Self-healing system that automatically retries failed operations
 */

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  exponentialBase: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  exponentialBase: 2,
};

/**
 * Calculates delay for exponential backoff
 */
export function calculateBackoff(attemptNumber: number, config: RetryConfig): number {
  const delay = config.baseDelayMs * Math.pow(config.exponentialBase, attemptNumber - 1);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Sleeps for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retries an async operation with exponential backoff
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  onRetry?: (attempt: number, error: Error) => void
): Promise<T> {
  let lastError: Error;
  
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < config.maxAttempts) {
        const delay = calculateBackoff(attempt, config);
        
        if (onRetry) {
          onRetry(attempt, lastError);
        }
        
        await sleep(delay);
      }
    }
  }
  
  throw lastError!;
}

/**
 * Circuit breaker state
 */
export enum CircuitState {
  CLOSED = 'CLOSED',      // Normal operation
  OPEN = 'OPEN',          // Failing, reject immediately
  HALF_OPEN = 'HALF_OPEN' // Testing if service recovered
}

export interface CircuitBreakerConfig {
  failureThreshold: number;     // Number of failures before opening
  successThreshold: number;      // Number of successes to close from half-open
  timeout: number;               // Time to wait before trying half-open (ms)
}

export const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 60000, // 1 minute
};

/**
 * Circuit breaker implementation
 */
export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptTime = 0;
  
  constructor(
    private readonly name: string,
    private readonly config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG
  ) {}
  
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        throw new Error(`Circuit breaker '${this.name}' is OPEN`);
      }
      // Try half-open
      this.state = CircuitState.HALF_OPEN;
    }
    
    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  private onSuccess(): void {
    this.failureCount = 0;
    
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
      }
    }
  }
  
  private onFailure(): void {
    this.failureCount++;
    this.successCount = 0;
    
    if (this.failureCount >= this.config.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.config.timeout;
    }
  }
  
  getState(): CircuitState {
    return this.state;
  }
  
  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttemptTime = 0;
  }
}

/**
 * Global circuit breakers for external services
 */
export const circuitBreakers = {
  paddle: new CircuitBreaker('paddle'),
  stripe: new CircuitBreaker('stripe'),
  openclawApi: new CircuitBreaker('openclaw-api'),
};
