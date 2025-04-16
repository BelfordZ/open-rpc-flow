import { Step, StepExecutionContext, JsonRpcHandler } from '../types';
import { StepExecutor, StepExecutionResult, JsonRpcRequestError, StepType } from './types';
import { Logger } from '../util/logger';
import { RequestStep } from './types';
import { RetryPolicy, RetryableOperation } from '../errors/recovery';
import { ExecutionError, TimeoutError } from '../errors/base';
import { EnhancedTimeoutError } from '../errors/timeout-error';
import { ErrorCode } from '../errors/codes';

export class RequestStepExecutor implements StepExecutor {
  private requestId: number = 0;
  private logger: Logger;

  constructor(
    private jsonRpcHandler: JsonRpcHandler,
    logger: Logger,
    private retryPolicy: RetryPolicy | null = null,
  ) {
    this.logger = logger.createNested('RequestStepExecutor');
  }

  private getNextRequestId(): number {
    if (this.requestId >= Number.MAX_SAFE_INTEGER) {
      this.requestId = 0;
    }
    this.requestId += 1;
    return this.requestId;
  }

  canExecute(step: Step): step is RequestStep {
    return 'request' in step;
  }

  /**
   * Get the effective timeout value for a step
   * @param step The request step to get timeout for
   * @param context The execution context with flow-level timeouts
   * @returns Timeout in milliseconds or undefined if no timeout is set
   */
  private getStepTimeout(step: RequestStep, context: StepExecutionContext): number | undefined {
    // Check step-level timeout in policies (highest priority)
    if (step.policies?.timeout?.timeout !== undefined) {
      return step.policies.timeout.timeout;
    }

    // Check deprecated step-level timeout
    if (step.timeout !== undefined) {
      return step.timeout;
    }

    // Check for flow-level step policies (applies to all steps)
    if (context.flow?.policies?.step?.timeout?.timeout !== undefined) {
      return context.flow.policies.step.timeout.timeout;
    }

    // Check for request type timeout in flow timeouts
    if (context.flow?.timeouts?.request !== undefined) {
      return context.flow.timeouts.request;
    }

    // Check for global timeout in policies
    if (context.flow?.policies?.global?.timeout?.timeout !== undefined) {
      return context.flow.policies.global.timeout.timeout;
    }

    // Fall back to global timeout
    if (context.flow?.timeouts?.global !== undefined) {
      return context.flow.timeouts.global;
    }

    // No timeout configured
    return undefined;
  }

  /**
   * Get the effective retry policy for a step
   * @param step The request step to get retry policy for
   * @returns RetryPolicy or null if retries are disabled
   */
  private getStepRetryPolicy(step: RequestStep, context: StepExecutionContext): RetryPolicy | null {
    // If retries are disabled globally, return null
    if (!this.retryPolicy) {
      return null;
    }

    // Check for step-level retry policy (new structure)
    if (step.policies?.retryPolicy) {
      const stepPolicy = step.policies.retryPolicy;

      // Convert to RetryPolicy format
      return {
        maxAttempts: stepPolicy.maxAttempts ?? this.retryPolicy.maxAttempts,
        backoff: {
          initial: stepPolicy.backoff?.initial ?? this.retryPolicy.backoff.initial,
          multiplier: stepPolicy.backoff?.multiplier ?? this.retryPolicy.backoff.multiplier,
          maxDelay: stepPolicy.backoff?.maxDelay ?? this.retryPolicy.backoff.maxDelay,
          strategy: stepPolicy.backoff?.strategy ?? this.retryPolicy.backoff.strategy,
        },
        retryableErrors:
          (stepPolicy.retryableErrors as ErrorCode[]) ?? this.retryPolicy.retryableErrors,
      };
    }

    // Check for deprecated step-level retry policy
    if (step.retryPolicy) {
      return step.retryPolicy;
    }

    // Check for flow-level step policy (applies to all steps)
    if (context.flow?.policies?.step?.retryPolicy) {
      const stepPolicy = context.flow.policies.step.retryPolicy;

      // Convert to RetryPolicy format
      return {
        maxAttempts: stepPolicy.maxAttempts ?? this.retryPolicy.maxAttempts,
        backoff: {
          initial: stepPolicy.backoff?.initial ?? this.retryPolicy.backoff.initial,
          multiplier: stepPolicy.backoff?.multiplier ?? this.retryPolicy.backoff.multiplier,
          maxDelay: stepPolicy.backoff?.maxDelay ?? this.retryPolicy.backoff.maxDelay,
          strategy: stepPolicy.backoff?.strategy ?? this.retryPolicy.backoff.strategy,
        },
        retryableErrors:
          (stepPolicy.retryableErrors as ErrorCode[]) ?? this.retryPolicy.retryableErrors,
      };
    }

    // Otherwise use the global retry policy
    return this.retryPolicy;
  }

  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new Error('Invalid step type for RequestStepExecutor');
    }

    const requestStep = step as RequestStep;
    const requestId = this.getNextRequestId();
    const stepRetryPolicy = this.getStepRetryPolicy(requestStep, context);
    const timeout = this.getStepTimeout(requestStep, context);

    this.logger.debug('Executing request step', {
      stepName: step.name,
      method: requestStep.request.method,
      requestId,
      hasTimeout: timeout !== undefined,
      timeout,
      hasRetryPolicy: stepRetryPolicy !== null,
      maxRetries: stepRetryPolicy?.maxAttempts,
    });

    // Create a function that captures all the request logic
    const executeRequest = async () => {
      // Create an AbortController for this request if we have a timeout
      let abortController: AbortController | undefined;
      let timeoutId: NodeJS.Timeout | undefined;

      if (timeout) {
        abortController = new AbortController();

        // Set up timeout to abort the request
        timeoutId = setTimeout(() => {
          this.logger.debug(`Step timeout exceeded`, {
            stepName: step.name,
            timeout,
          });

          abortController?.abort();
        }, timeout);
      }

      try {
        // Validate method name
        if (typeof requestStep.request.method !== 'string' || !requestStep.request.method.trim()) {
          throw new Error('Invalid method name: must be a non-empty string');
        }

        // Validate params
        if (requestStep.request.params !== null && typeof requestStep.request.params !== 'object') {
          throw new Error('Invalid params: must be an object, array, or null');
        }

        // Resolve references in params
        const resolvedParams = context.referenceResolver.resolveReferences(
          requestStep.request.params,
          extraContext,
        );

        this.logger.debug('Resolved request parameters', {
          stepName: step.name,
          params: resolvedParams,
          requestId,
        });

        // Create options object with AbortSignal if available
        const options: Record<string, any> = {};

        // Use either our timeout's abort signal or the one from context
        if (abortController?.signal) {
          options.signal = abortController.signal;
        } else if (context.signal) {
          options.signal = context.signal;
        }

        // Pass AbortSignal to JSON-RPC handler
        const result = await this.jsonRpcHandler(
          {
            jsonrpc: '2.0',
            method: requestStep.request.method,
            params: resolvedParams,
            id: requestId,
          },
          Object.keys(options).length > 0 ? options : undefined,
        );

        // If the request was aborted due to timeout, throw a timeout error
        if (abortController?.signal.aborted) {
          const executionTime = timeout || 0;
          const timeoutError = EnhancedTimeoutError.forStep(
            step,
            StepType.Request,
            timeout || 0,
            executionTime,
          );
          throw timeoutError;
        }

        this.logger.debug('Request completed successfully', {
          stepName: step.name,
          requestId,
          result,
        });

        return {
          result,
          type: StepType.Request,
          metadata: {
            hasError: result && 'error' in result,
            method: requestStep.request.method,
            requestId,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error: unknown) {
        // Handle different error types
        if (error instanceof Error) {
          // Handle AbortError for timeouts
          if (
            error.name === 'AbortError' ||
            (abortController?.signal.aborted && error.message?.includes('aborted'))
          ) {
            // Create a detailed timeout error
            const executionTime = timeout || 0; // We hit the timeout exactly
            const timeoutError = EnhancedTimeoutError.forStep(
              step,
              StepType.Request,
              timeout || 0,
              executionTime,
            );

            throw timeoutError;
          }

          // Special case: Pass through JsonRpcRequestError without wrapping
          if (error instanceof JsonRpcRequestError) {
            throw error;
          }
        }

        const err = error as any;
        // Wrap other errors as ExecutionError with NETWORK_ERROR code for retries
        const errorMessage = `Failed to execute request step "${step.name}": ${err?.message || 'Unknown error'}`;
        throw new ExecutionError(
          errorMessage,
          {
            code:
              err && typeof err === 'object' && 'code' in err && err.code
                ? err.code
                : ErrorCode.NETWORK_ERROR,
            stepName: step.name,
            requestId,
            originalError: err,
          },
          err,
        );
      } finally {
        // Clean up timeout if it was set
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    };

    try {
      let result: StepExecutionResult;

      // Apply retry policy if configured
      if (stepRetryPolicy) {
        this.logger.debug('Using retry policy for request', {
          stepName: step.name,
          requestId,
          maxAttempts: stepRetryPolicy.maxAttempts,
          retryableErrors: stepRetryPolicy.retryableErrors,
          isStepLevel: stepRetryPolicy !== this.retryPolicy,
        });

        // Execute with retry
        const operation = new RetryableOperation(executeRequest, stepRetryPolicy, this.logger);
        result = await operation.execute();
      } else {
        // No retry policy, execute directly
        result = await executeRequest();
      }

      return result;
    } catch (error: any) {
      const errorMessage = error.message || String(error);

      this.logger.error('Request failed', {
        stepName: step.name,
        requestId,
        error: errorMessage,
        errorCode: error.code || 'unknown',
        isTimeout: error instanceof TimeoutError,
      });

      // Pass JsonRpcRequestError through without modification
      if (error instanceof JsonRpcRequestError) {
        throw error;
      }

      throw error;
    }
  }
}
