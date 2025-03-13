import { LoopError } from '../../errors';
import { LoopStepExecutor } from '../../step-executors/loop-executor';
import { Step, StepExecutionContext } from '../../types';
import { defaultLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';
import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { LoopStep } from '../../step-executors/types';

describe('LoopError scenarios', () => {
  let loopExecutor: LoopStepExecutor;
  let context: StepExecutionContext;
  const mockExecuteStep = jest.fn();
  
  beforeEach(() => {
    mockExecuteStep.mockReset();
    mockExecuteStep.mockResolvedValue({ result: 'success', type: 'request' });
    loopExecutor = new LoopStepExecutor(mockExecuteStep, defaultLogger);
    
    const stepResults = new Map();
    const contextObj = { nonArray: 'string value' };
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

  it('should throw LoopError for missing step/steps', async () => {
    const loopStepWithoutSteps: LoopStep = {
      name: 'loopWithoutSteps',
      loop: {
        over: '[]',
        as: 'item'
        // Missing both step and steps
      }
    };
    
    await expect(loopExecutor.execute(loopStepWithoutSteps, context)).rejects.toThrow(LoopError);
    await expect(loopExecutor.execute(loopStepWithoutSteps, context)).rejects.toThrow(/Loop must have either step or steps defined/);
  });

  it('should throw LoopError for non-array input', async () => {
    const loopStepWithNonArray: LoopStep = {
      name: 'loopWithNonArray',
      loop: {
        over: '${nonArray}', // This will evaluate to a string, not an array
        as: 'item',
        step: {
          name: 'innerStep',
          request: {
            method: 'test',
            params: {}
          }
        }
      }
    };
    
    await expect(loopExecutor.execute(loopStepWithNonArray, context)).rejects.toThrow(LoopError);
    await expect(loopExecutor.execute(loopStepWithNonArray, context)).rejects.toThrow(/Expected array for loop iteration/);
  });
}); 