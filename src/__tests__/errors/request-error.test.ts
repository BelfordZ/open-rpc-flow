import { RequestError } from '../../errors';
import { RequestStepExecutor } from '../../step-executors/request-executor';
import { Step, StepExecutionContext } from '../../types';
import { defaultLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';
import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';

describe('RequestError scenarios', () => {
  let requestExecutor: RequestStepExecutor;
  let context: StepExecutionContext;
  const mockJsonRpcHandler = jest.fn();
  
  beforeEach(() => {
    mockJsonRpcHandler.mockReset();
    requestExecutor = new RequestStepExecutor(mockJsonRpcHandler, defaultLogger);
    
    const stepResults = new Map();
    const contextObj = {};
    const referenceResolver = new ReferenceResolver(stepResults, contextObj, defaultLogger);
    const expressionEvaluator = new SafeExpressionEvaluator(defaultLogger, referenceResolver);
    
    context = {
      referenceResolver,
      expressionEvaluator,
      stepResults,
      context: contextObj,
      logger: defaultLogger
    };
  });

  it('should throw RequestError for invalid step type', async () => {
    const invalidStep: Step = {
      name: 'invalidStep',
      transform: { // Not a request step
        input: '{}',
        operations: []
      }
    } as any;
    
    await expect(requestExecutor.execute(invalidStep, context)).rejects.toThrow(RequestError);
    await expect(requestExecutor.execute(invalidStep, context)).rejects.toThrow(/Invalid step type/);
  });

  it('should throw RequestError for invalid method name', async () => {
    const stepWithInvalidMethod: Step = {
      name: 'invalidMethodStep',
      request: {
        method: '', // Empty method name
        params: {}
      }
    };
    
    await expect(requestExecutor.execute(stepWithInvalidMethod, context)).rejects.toThrow(RequestError);
    await expect(requestExecutor.execute(stepWithInvalidMethod, context)).rejects.toThrow(/Invalid method name/);
  });

  it('should throw RequestError for invalid params', async () => {
    const stepWithInvalidParams: Step = {
      name: 'invalidParamsStep',
      request: {
        method: 'test',
        params: 'not an object' as any // String instead of object
      }
    };
    
    await expect(requestExecutor.execute(stepWithInvalidParams, context)).rejects.toThrow(RequestError);
    await expect(requestExecutor.execute(stepWithInvalidParams, context)).rejects.toThrow(/Invalid params/);
  });

  it('should throw RequestError for failed requests', async () => {
    const validStep: Step = {
      name: 'validStep',
      request: {
        method: 'test',
        params: {}
      }
    };
    
    // Mock the JSON-RPC handler to throw an error
    mockJsonRpcHandler.mockRejectedValue(new Error('Network failure'));
    
    await expect(requestExecutor.execute(validStep, context)).rejects.toThrow(RequestError);
    await expect(requestExecutor.execute(validStep, context)).rejects.toThrow(/Failed to execute request step/);
  });
}); 