import { Step, StepExecutionContext, JsonRpcRequest } from '../types';
import { StepExecutor, StepExecutionResult, JsonRpcRequestError, StepType } from './types';
import { Logger } from '../util/logger';
import { RequestStep } from './types';
import { RetryPolicy, RetryableOperation } from '../errors/recovery';
import { CircuitBreaker, CircuitBreakerConfig } from '../errors/circuit-breaker';
import { ExecutionError } from '../errors/base';
import { ErrorCode } from '../errors/codes';

export class RequestStepExecutor implements StepExecutor {
  private requestId: number = 0;
  private logger: Logger;
  private circuitBreaker: CircuitBreaker | null = null;

  constructor(
    private jsonRpcHandler: (request: JsonRpcRequest) => Promise<any>,
    logger: Logger,
    private retryPolicy: RetryPolicy | null = null,
    private circuitBreakerConfig: CircuitBreakerConfig | null = null,
  ) {
    this.logger = logger.createNested('RequestStepExecutor');
    
    // Initialize circuit breaker if configured
    if (this.circuitBreakerConfig) {
      this.circuitBreaker = new CircuitBreaker(this.circuitBreakerConfig, this.logger);
    }
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

    this.logger.debug('Executing request step', {
      stepName: step.name,
      method: requestStep.request.method,
      requestId,
    });

    // Create a function that captures all the request logic
    const executeRequest = async () => {
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

        const result = await this.jsonRpcHandler({
          jsonrpc: '2.0',
          method: requestStep.request.method,
          params: resolvedParams,
          id: requestId,
        });

        this.logger.debug('Request completed successfully', {
          stepName: step.name,
          requestId,
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
      } catch (error: any) {
        // Wrap error as ExecutionError with NETWORK_ERROR code for retries
        if (!(error instanceof ExecutionError)) {
          const errorMessage = `Failed to execute request step "${step.name}": ${error?.message || 'Unknown error'}`;
          throw new ExecutionError(
            errorMessage,
            {
              code: ErrorCode.NETWORK_ERROR,
              stepName: step.name,
              requestId,
              originalError: error,
            },
            error
          );
        }
        throw error;
      }
    };

    try {
      let result: StepExecutionResult;

      // Apply circuit breaker if configured
      if (this.circuitBreaker) {
        this.logger.debug('Using circuit breaker for request', {
          stepName: step.name,
          requestId,
        });
        
        // Execute with circuit breaker
        result = await this.circuitBreaker.execute(async () => {
          // Apply retry policy if configured
          if (this.retryPolicy) {
            this.logger.debug('Using retry policy for request', {
              stepName: step.name,
              requestId,
              maxAttempts: this.retryPolicy.maxAttempts,
            });
            
            // Execute with retry
            const operation = new RetryableOperation(
              executeRequest,
              this.retryPolicy,
              this.logger
            );
            return await operation.execute();
          }
          
          // Execute without retry
          return await executeRequest();
        });
      } else if (this.retryPolicy) {
        // No circuit breaker, but use retry policy
        this.logger.debug('Using retry policy for request', {
          stepName: step.name,
          requestId,
          maxAttempts: this.retryPolicy.maxAttempts,
        });
        
        // Execute with retry
        const operation = new RetryableOperation(
          executeRequest,
          this.retryPolicy,
          this.logger
        );
        result = await operation.execute();
      } else {
        // No circuit breaker or retry policy, execute directly
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
      });

      if (error instanceof JsonRpcRequestError) {
        throw error;
      }
      
      throw error;
    }
  }
}
