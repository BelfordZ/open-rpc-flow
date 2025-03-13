import { TransformError } from '../../errors';
import { TransformStepExecutor } from '../../step-executors/transform-executor';
import { Step, StepExecutionContext } from '../../types';
import { defaultLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';
import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { TransformStep } from '../../step-executors/types';

describe('TransformError scenarios', () => {
  let transformExecutor: TransformStepExecutor;
  let context: StepExecutionContext;
  
  beforeEach(() => {
    const stepResults = new Map();
    const contextObj = { data: [1, 2, 3] };
    const referenceResolver = new ReferenceResolver(stepResults, contextObj, defaultLogger);
    const expressionEvaluator = new SafeExpressionEvaluator(defaultLogger, referenceResolver);
    
    transformExecutor = new TransformStepExecutor(
      expressionEvaluator,
      referenceResolver,
      contextObj,
      defaultLogger
    );
    
    context = {
      referenceResolver,
      expressionEvaluator,
      stepResults,
      context: contextObj,
      logger: defaultLogger
    };
  });

  it('should throw TransformError for invalid step type', async () => {
    const invalidStep: Step = {
      name: 'invalidStep',
      request: { // Not a transform step
        method: 'test',
        params: {}
      }
    };
    
    await expect(transformExecutor.execute(invalidStep, context)).rejects.toThrow(TransformError);
    await expect(transformExecutor.execute(invalidStep, context)).rejects.toThrow(/Invalid step type for TransformStepExecutor/);
  });

  it('should throw TransformError for invalid operation type', async () => {
    const stepWithInvalidOperation: TransformStep = {
      name: 'invalidOperationStep',
      transform: {
        input: '${data}',
        operations: [
          { type: 'invalid' as any, using: 'item' } // Invalid operation type
        ]
      }
    };
    
    await expect(transformExecutor.execute(stepWithInvalidOperation, context)).rejects.toThrow(TransformError);
    await expect(transformExecutor.execute(stepWithInvalidOperation, context)).rejects.toThrow(/Unknown transform operation type/);
  });

  it('should throw TransformError for non-array input to array operations', async () => {
    const stepWithNonArrayInput: TransformStep = {
      name: 'nonArrayInputStep',
      transform: {
        input: '123', // Number, not an array
        operations: [
          { type: 'map', using: 'item * 2' } // Map requires an array
        ]
      }
    };
    
    await expect(transformExecutor.execute(stepWithNonArrayInput, context)).rejects.toThrow(TransformError);
    await expect(transformExecutor.execute(stepWithNonArrayInput, context)).rejects.toThrow(/requires an array input/);
  });
}); 