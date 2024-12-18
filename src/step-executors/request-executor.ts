import { JsonRpcRequest } from '../types';
import { 
  StepExecutor, 
  StepExecutionContext, 
  StepExecutionResult, 
  RequestStep, 
  isRequestStep,
  StepType
} from './types';

/**
 * JSON-RPC 2.0 error object
 */
export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

/**
 * Custom error class for JSON-RPC errors
 */
export class JsonRpcRequestError extends Error {
  constructor(public error: JsonRpcError) {
    super(error.message);
    this.name = 'JsonRpcRequestError';
  }
}

/**
 * Request step execution result metadata
 */
export interface RequestStepMetadata {
  method: string;
  requestId: number;
  timestamp: string;
}

/**
 * Executor for JSON-RPC request steps with improved typing and error handling
 */
export class RequestStepExecutor<T = any> implements StepExecutor<RequestStep, T> {
  private requestId: number = 1;
  private readonly MAX_REQUEST_ID = Number.MAX_SAFE_INTEGER;

  constructor(
    private jsonRpcHandler: (request: JsonRpcRequest) => Promise<T>
  ) {}

  canExecute = isRequestStep;

  private getNextRequestId(): number {
    const currentId = this.requestId;
    this.requestId = (this.requestId % this.MAX_REQUEST_ID) + 1;
    return currentId;
  }

  private validateMethod(method: string): void {
    if (typeof method !== 'string' || method.trim().length === 0) {
      throw new Error('Invalid method name: must be a non-empty string');
    }
  }

  private validateParams(params: any): void {
    if (params !== undefined && 
        params !== null && 
        typeof params !== 'object') {
      throw new Error('Invalid params: must be an object, array, or null');
    }
  }

  async execute(
    step: RequestStep, 
    context: StepExecutionContext,
    extraContext: Record<string, any> = {}
  ): Promise<StepExecutionResult<T> & { metadata: RequestStepMetadata }> {
    const { referenceResolver } = context;
    
    try {
      // Validate request components
      this.validateMethod(step.request.method);
      this.validateParams(step.request.params);

      // Resolve references in parameters
      const resolvedParams = referenceResolver.resolveReferences(
        step.request.params, 
        extraContext
      );

      // Prepare request
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        method: step.request.method,
        params: resolvedParams,
        id: this.getNextRequestId()
      };

      console.log('Executing request:', {
        stepName: step.name,
        request,
        extraContext
      });

      // Execute request
      const result = await this.jsonRpcHandler(request);

      // Handle potential error response
      if (result && typeof result === 'object' && 'error' in result) {
        const error = result.error as JsonRpcError;
        throw new JsonRpcRequestError(error);
      }

      console.log('Request completed successfully:', {
        stepName: step.name,
        result
      });

      return {
        result: result as T,
        type: StepType.Request,
        metadata: {
          method: step.request.method,
          requestId: request.id,
          timestamp: new Date().toISOString()
        }
      };
    } catch (error: unknown) {
      console.error('Request execution failed:', {
        stepName: step.name,
        error
      });

      if (error instanceof JsonRpcRequestError) {
        throw error;
      }

      if (error instanceof Error) {
        throw new Error(
          `Failed to execute request step "${step.name}": ${error.message}`
        );
      }

      throw new Error(
        `Failed to execute request step "${step.name}": Unknown error`
      );
    }
  }
} 