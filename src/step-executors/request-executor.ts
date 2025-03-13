import { Step, StepExecutionContext, JsonRpcRequest } from '../types';
import { StepExecutor, StepExecutionResult, JsonRpcRequestError, StepType } from './types';
import { Logger } from '../util/logger';
import { RequestStep } from './types';
import { RequestError } from '../errors';

export class RequestStepExecutor implements StepExecutor {
  private requestId: number = 0;
  private logger: Logger;

  constructor(
    private jsonRpcHandler: (request: JsonRpcRequest) => Promise<any>,
    logger: Logger,
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

  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new RequestError('Invalid step type for RequestStepExecutor', {
        stepName: step.name,
        stepType: Object.keys(step).filter(key => key !== 'name').join(', ')
      });
    }

    const requestStep = step as RequestStep;
    const requestId = this.getNextRequestId();

    this.logger.debug('Executing request step', {
      stepName: step.name,
      method: requestStep.request.method,
      requestId,
    });

    try {
      // Validate method name
      if (typeof requestStep.request.method !== 'string' || !requestStep.request.method.trim()) {
        throw new RequestError('Invalid method name: must be a non-empty string', {
          stepName: step.name,
          method: requestStep.request.method
        });
      }

      // Validate params
      if (requestStep.request.params !== null && typeof requestStep.request.params !== 'object') {
        throw new RequestError('Invalid params: must be an object, array, or null', {
          stepName: step.name,
          paramsType: typeof requestStep.request.params
        });
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
      // not convinced I need any of this error
      const errorMessage =
        error instanceof JsonRpcRequestError
          ? error.message
          : `Failed to execute request step "${step.name}": ${error?.message || 'Unknown error'}`;

      this.logger.error('Request failed', {
        stepName: step.name,
        requestId,
        error: errorMessage,
      });

      if (error instanceof JsonRpcRequestError) {
        throw error;
      }
      throw new RequestError(errorMessage, {
        stepName: step.name,
        requestId,
        originalError: error?.message || 'Unknown error',
        method: requestStep.request.method
      });
    }
  }
}
