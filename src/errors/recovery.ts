import { FlowError, ExecutionError } from './base';
import { ErrorCode } from './codes';
import { Logger } from '../util/logger';

/**
 * Configuration for retry policies
 */
export interface RetryPolicy {
  maxAttempts: number;
  backoff: {
    initial: number;
    multiplier: number;
    maxDelay: number;
  };
  retryableErrors: ErrorCode[];
  retryDelay?: number;
}

/**
 * Wrapper for operations that can be retried
 */
export class RetryableOperation<T> {
  constructor(
    private operation: () => Promise<T>,
    private policy: RetryPolicy,
    private logger: Logger,
  ) {}

  /**
   * Execute the operation with retry logic
   */
  async execute(): Promise<T> {
    let attempt = 1;
    let lastError: Error | undefined;

    this.logger.debug('Starting retryable operation', {
      maxAttempts: this.policy.maxAttempts,
      retryableErrors: this.policy.retryableErrors,
    });

    while (attempt <= this.policy.maxAttempts) {
      try {
        this.logger.debug('Attempting operation', { attempt });
        const result = await this.operation();
        this.logger.debug('Operation succeeded', { attempt });
        return result;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        this.logger.debug('Operation failed', {
          attempt,
          error: lastError.message,
          errorType: lastError.constructor.name,
          errorCode: lastError instanceof FlowError ? lastError.code : 'unknown',
          isRetryable: this.isRetryable(lastError),
        });

        if (!this.isRetryable(lastError)) {
          this.logger.debug('Error is not retryable, throwing', {
            attempt,
            error: lastError.message,
            errorType: lastError.constructor.name,
          });
          throw lastError;
        }

        if (attempt === this.policy.maxAttempts) {
          this.logger.debug('Max attempts exceeded', {
            attempt,
            maxAttempts: this.policy.maxAttempts,
            lastError: lastError.message,
          });
          throw new ExecutionError(
            'Max retry attempts exceeded',
            {
              code: ErrorCode.MAX_RETRIES_EXCEEDED,
              attempts: attempt,
              lastError: lastError.message,
              lastErrorType: lastError.constructor.name,
              lastErrorCode: lastError instanceof FlowError ? lastError.code : 'unknown',
              policy: this.policy,
            },
            lastError,
          );
        }

        attempt++;

        const delay = this.calculateDelay(attempt);
        this.logger.debug('Scheduling retry', {
          attempt,
          delay,
          error: lastError.message,
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    this.logger.debug('Unexpected end of retry loop', {
      attempt,
      maxAttempts: this.policy.maxAttempts,
      lastError: lastError?.message,
    });
    throw new ExecutionError(
      'Max retry attempts exceeded',
      {
        code: ErrorCode.MAX_RETRIES_EXCEEDED,
        attempts: attempt,
        lastError: lastError?.message || 'Unknown error',
        policy: this.policy,
      },
      lastError,
    );
  }

  /**
   * Check if an error is retryable based on the policy
   */
  private isRetryable(error: unknown): boolean {
    this.logger.debug('Checking if error is retryable', {
      errorType: error?.constructor?.name,
      errorMessage: error instanceof Error ? error.message : String(error),
      retryableErrors: this.policy.retryableErrors,
      errorCode:
        (error instanceof Error && 'context' in error && (error as any).context?.code) || 'unknown',
    });

    if (error instanceof Error && 'context' in error && (error as any).context?.code) {
      const errorCode = (error as any).context.code;
      const isRetryable = this.policy.retryableErrors.includes(errorCode);

      this.logger.debug('Retryable check result', {
        errorCode,
        isRetryable,
        errorType: error.constructor.name,
      });

      return isRetryable;
    }

    this.logger.debug('Error is not retryable', {
      errorType: error?.constructor?.name,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  /**
   * Calculate delay for the next retry attempt
   */
  private calculateDelay(attempt: number): number {
    const delay =
      this.policy.backoff.initial * Math.pow(this.policy.backoff.multiplier, attempt - 1);
    return Math.min(delay, this.policy.backoff.maxDelay);
  }
}
