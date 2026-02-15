import {
  Step,
  StepExecutionContext,
  JsonRpcHandler,
  JsonRpcHandlerOptions,
  ExecutionContextData,
} from '../types';
import { StepExecutor, StepExecutionResult, JsonRpcRequestError, StepType } from './types';
import { Logger } from '../util/logger';
import { getDataType } from '../util/type-utils';
import { RequestStep } from './types';
import { RetryPolicy, RetryableOperation } from '../errors/recovery';
import { ExecutionError, ValidationError } from '../errors/base';
import { TimeoutError } from '../errors/timeout-error';
import { ErrorCode } from '../errors/codes';
import { PolicyResolver } from '../util/policy-resolver';

export class RequestStepExecutor implements StepExecutor {
  private requestId: number = 0;
  private logger: Logger;
  private policyResolver: PolicyResolver;

  constructor(
    private jsonRpcHandler: JsonRpcHandler,
    logger: Logger,
    policyResolver: PolicyResolver,
  ) {
    this.logger = logger.createNested('RequestStepExecutor');
    this.policyResolver = policyResolver;
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
  private getStepTimeout(step: RequestStep, _context: StepExecutionContext): number {
    // Use PolicyResolver for timeout resolution
    return this.policyResolver.resolveTimeout(step, StepType.Request);
  }

  /**
   * Get the effective retry policy for a step
   * @param step The request step to get retry policy for
   * @returns RetryPolicy or null if retries are disabled
   */
  private getStepRetryPolicy(
    step: RequestStep,
    _context: StepExecutionContext,
  ): RetryPolicy | null {
    // Use PolicyResolver for retry policy resolution
    return this.policyResolver.resolveRetryPolicy(step, StepType.Request) ?? null;
  }

  async execute(
    step: Step,
    _context: StepExecutionContext,
    extraContext: ExecutionContextData = {},
    signal?: AbortSignal,
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new ValidationError('Invalid step type for RequestStepExecutor', { step });
    }

    const requestStep: RequestStep = step;
    const requestId = this.getNextRequestId();
    const stepRetryPolicy = this.getStepRetryPolicy(requestStep, _context);
    const timeout = this.getStepTimeout(requestStep, _context);

    this.logger.debug('Input type check', {
      stepName: step.name,
      expected: { method: 'string', params: 'object | array | null' },
      actual: {
        method: typeof requestStep.request.method,
        params: getDataType(requestStep.request.params),
      },
    });

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
      const TIMEOUT_SYMBOL = Symbol('timeout');
      let timedOut = false;
      let timeoutId: NodeJS.Timeout | undefined;
      let abortController: AbortController | undefined;
      if (timeout) {
        abortController = new AbortController();
      }
      if (abortController) {
        const linkAbortSignal = (source?: AbortSignal) => {
          if (!source) return;
          if (source.aborted) {
            abortController.abort(source.reason);
          } else {
            source.addEventListener('abort', () => abortController.abort(source.reason));
          }
        };
        linkAbortSignal(_context.signal);
        linkAbortSignal(signal);
      }

      // Set up timeout to abort the request
      let timeoutPromise: Promise<any> | undefined = undefined;
      if (timeout && abortController) {
        timeoutPromise = new Promise((resolve) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            abortController.abort();
            resolve(TIMEOUT_SYMBOL);
          }, timeout);
        });
      }

      try {
        // Validate method name
        if (typeof requestStep.request.method !== 'string' || !requestStep.request.method.trim()) {
          throw new ValidationError('Invalid method name: must be a non-empty string', {
            method: requestStep.request.method,
            stepName: step.name,
          });
        }

        // Validate params
        if (requestStep.request.params !== null && typeof requestStep.request.params !== 'object') {
          throw new ValidationError('Invalid params: must be an object, array, or null', {
            params: requestStep.request.params,
            stepName: step.name,
          });
        }

        // Resolve references in params
        const resolvedParams = _context.referenceResolver.resolveReferences(
          requestStep.request.params,
          extraContext,
        );

        this.logger.debug('Resolved request parameters', {
          stepName: step.name,
          params: resolvedParams,
          requestId,
        });

        // Create options object with AbortSignal if available
        const options: JsonRpcHandlerOptions = {};

        // Use either our timeout's abort signal or the one from context or the passed signal
        if (abortController?.signal) {
          options.signal = abortController.signal;
        } else if (_context.signal) {
          options.signal = _context.signal;
        } else if (signal) {
          options.signal = signal;
        }

        const handlerPromise = this.jsonRpcHandler(
          {
            jsonrpc: '2.0',
            method: requestStep.request.method,
            params: resolvedParams,
            id: requestId,
          },
          Object.keys(options).length > 0 ? options : undefined,
        );

        let raceResult;
        try {
          raceResult = timeoutPromise
            ? await Promise.race([handlerPromise, timeoutPromise])
            : await handlerPromise;
        } catch (error) {
          if (timedOut) {
            throw TimeoutError.forStep(step, StepType.Request, timeout || 0, timeout || 0);
          }
          throw error;
        }

        if (raceResult === TIMEOUT_SYMBOL) {
          throw TimeoutError.forStep(step, StepType.Request, timeout || 0, timeout || 0);
        }

        this.logger.debug('Request completed successfully', {
          stepName: step.name,
          requestId,
          result: raceResult,
        });

        if (raceResult && typeof raceResult === 'object' && 'error' in raceResult) {
          this.logger.warn('Request returned error response', {
            stepName: step.name,
            requestId,
            error: (raceResult as any).error,
          });
        }

        return {
          result: raceResult,
          type: StepType.Request,
          metadata: {
            hasError: raceResult && 'error' in raceResult,
            method: requestStep.request.method,
            requestId,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error) {
        // Handle different error types
        if (error instanceof Error) {
          // Handle AbortError for timeouts
          if (
            error.name === 'AbortError' ||
            (abortController?.signal.aborted && error.message?.includes('aborted'))
          ) {
            // Create a detailed timeout error
            const executionTime = timeout || 0; // We hit the timeout exactly
            const timeoutError = TimeoutError.forStep(
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
          isStepLevel: stepRetryPolicy !== null,
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
