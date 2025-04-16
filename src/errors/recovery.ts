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
    /**
     * The strategy to use for the backoff.
     * @default "exponential"
     */
    strategy?: 'exponential' | 'linear';
  };
  retryableErrors: ErrorCode[];
  retryDelay?: number;
}

/**
 * Wrapper for operations that can be retried
 */
export class RetryableOperation<T> {
  private logger: Logger;

  constructor(
    private operation: () => Promise<T>,
    private policy: RetryPolicy,
    logger: Logger,
  ) {
    this.logger = logger.createNested('RetryableOperation');
  }

  /**
   * Execute the operation with retry logic
   */
  async execute(): Promise<T> {
    let attempt = 1;
    let lastError: unknown;

    const strategy = this.policy.backoff.strategy || 'exponential';
    
    this.logger.debug('Starting retryable operation', {
      maxAttempts: this.policy.maxAttempts,
      retryableErrors: this.policy.retryableErrors,
      backoffStrategy: strategy
    });

    while (attempt <= this.policy.maxAttempts) {
      try {
        this.logger.debug('Attempting operation', { attempt });
        const result = await this.operation();
        this.logger.debug('Operation succeeded', { attempt });
        return result;
      } catch (error: unknown) {
        // Preserve the original error object for retry checks
        lastError = error;

        // Add detailed debugging
        if (error instanceof FlowError) {
          this.logger.debug('Caught FlowError', {
            code: error.code,
            codeType: typeof error.code,
            message: error.message,
            name: error.name,
            context: error.context,
            isFlowError: error instanceof FlowError,
          });
        }

        this.logger.debug('Operation failed', {
          attempt,
          error: error instanceof Error ? error.message : String(error),
          errorType: error?.constructor?.name,
          errorCode: error instanceof FlowError ? error.code : (error && typeof error === 'object' && 'code' in error ? (error as any).code : 'unknown'),
          isRetryable: this.isRetryable(error),
        });

        if (!this.isRetryable(error)) {
          this.logger.debug('Error is not retryable, throwing', {
            attempt,
            error: error instanceof Error ? error.message : String(error),
            errorType: error?.constructor?.name,
          });
          throw toError(error);
        }

        if (attempt === this.policy.maxAttempts) {
          this.logger.debug('Max attempts exceeded', {
            attempt,
            maxAttempts: this.policy.maxAttempts,
            lastError: error instanceof Error ? error.message : String(error),
          });
          throw new ExecutionError(
            'Max retry attempts exceeded',
            {
              code: ErrorCode.MAX_RETRIES_EXCEEDED,
              attempts: attempt,
              lastError: error instanceof Error ? error.message : String(error),
              lastErrorType: error?.constructor?.name,
              lastErrorCode: error instanceof FlowError ? error.code : (error && typeof error === 'object' && 'code' in error ? (error as any).code : 'unknown'),
              policy: this.policy,
            },
            toError(error)
          );
        }

        attempt++;

        const delay = this.calculateDelay(attempt);
        this.logger.debug('Scheduling retry', {
          attempt,
          delay,
          error: error instanceof Error ? error.message : String(error),
          backoffStrategy: strategy
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    /* istanbul ignore next */
    throw new Error('unreachable code');
  }

  /**
   * Check if an error is retryable based on the policy
   */
  private isRetryable(error: unknown): boolean {
    this.logger.debug('[isRetryable] called', {
      errorType: error?.constructor?.name,
      errorMessage: error instanceof Error ? error.message : String(error),
      code: error && typeof error === 'object' && 'code' in error ? (error as any).code : undefined,
      errorObject: error
    });

    const errorDetails = {
      errorType: error?.constructor?.name,
      errorMessage: error instanceof Error ? error.message : String(error),
      retryableErrors: this.policy.retryableErrors,
    };

    // Duck-typed check: if error has a code property, compare it
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as any).code;
      const errorCodeStr = String(code);
      const isRetryable = this.policy.retryableErrors.some(
        (retryableError) => String(retryableError) === errorCodeStr,
      );
      this.logger.debug('Duck-typed retryable check result', {
        ...errorDetails,
        code,
        errorCodeAsString: errorCodeStr,
        retryableErrorsAsStrings: this.policy.retryableErrors.map((e) => String(e)),
        isRetryable,
      });
      return isRetryable;
    }

    // Check by constructor name instead of instanceof
    if (
      error &&
      typeof error === 'object' &&
      error.constructor &&
      (error.constructor.name === 'FlowError' ||
        error.constructor.name === 'ExecutionError' ||
        error.constructor.name === 'ValidationError' ||
        error.constructor.name === 'TimeoutError' ||
        error.constructor.name === 'StateError')
    ) {
      // We know it's a FlowError-like object, so access properties accordingly
      const flowError = error as any;
      const errorCode = flowError.code;

      this.logger.debug('Checking if error is retryable', {
        ...errorDetails,
        errorCode,
        errorCodeType: typeof errorCode,
      });

      // Convert both sides to strings before comparing
      const errorCodeStr = String(errorCode);

      // Compare each retryable error with the error code using string comparison
      const isRetryable = this.policy.retryableErrors.some(
        (retryableError) => String(retryableError) === errorCodeStr,
      );

      this.logger.debug('Retryable check result', {
        errorCode,
        errorCodeAsString: errorCodeStr,
        retryableErrorsAsStrings: this.policy.retryableErrors.map((e) => String(e)),
        isRetryable,
        errorType: error.constructor.name,
      });

      return isRetryable;
    }

    this.logger.debug('Error is not retryable', errorDetails);
    return false;
  }

  /**
   * Calculate delay for the next retry attempt
   */
  private calculateDelay(attempt: number): number {
    let delay: number;
    const strategy = this.policy.backoff.strategy || 'exponential';

    if (strategy === 'linear') {
      // Linear backoff: initial + (multiplier * (attempt - 1))
      delay = this.policy.backoff.initial + (this.policy.backoff.multiplier * (attempt - 1));
    } else {
      // Default exponential backoff: initial * (multiplier ^ (attempt - 1))
      delay = this.policy.backoff.initial * Math.pow(this.policy.backoff.multiplier, attempt - 1);
    }

    return Math.min(delay, this.policy.backoff.maxDelay);
  }
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'object' && error !== null) {
    try {
      return new Error(JSON.stringify(error));
    } catch {
      return new Error('[object Object]');
    }
  }
  return new Error(String(error));
}
