import { StateError } from './base';
import { Logger } from '../util/logger';

/**
 * Configuration for circuit breaker
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  recoveryTime: number;
  monitorWindow: number;
}

/**
 * Circuit breaker implementation to prevent cascading failures
 */
export class CircuitBreaker {
  private failures: number = 0;
  private lastFailure?: Date;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private config: CircuitBreakerConfig,
    private logger: Logger,
  ) {}

  /**
   * Execute an operation with circuit breaker protection
   */
  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.isOpen()) {
      throw new StateError('Circuit breaker is open', {
        state: this.state,
        failures: this.failures,
        lastFailure: this.lastFailure?.toISOString(),
      });
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Check if the circuit is open
   */
  private isOpen(): boolean {
    if (this.state === 'OPEN') {
      const now = new Date();
      if (
        this.lastFailure &&
        now.getTime() - this.lastFailure.getTime() > this.config.recoveryTime
      ) {
        this.state = 'HALF_OPEN';
        this.logger.debug('Circuit breaker transitioning to half-open', {
          failures: this.failures,
          lastFailure: this.lastFailure.toISOString(),
        });
        return false;
      }
      return true;
    }
    return false;
  }

  /**
   * Record a successful operation
   */
  private recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.failures = 0;
      this.lastFailure = undefined;
      this.logger.debug('Circuit breaker closed', {
        state: this.state,
        failures: this.failures,
      });
    }
  }

  /**
   * Record a failed operation
   */
  private recordFailure(): void {
    this.failures++;
    this.lastFailure = new Date();

    if (this.failures >= this.config.failureThreshold) {
      this.state = 'OPEN';
      this.logger.debug('Circuit breaker opened', {
        failures: this.failures,
        threshold: this.config.failureThreshold,
        lastFailure: this.lastFailure.toISOString(),
      });
    }
  }
}
