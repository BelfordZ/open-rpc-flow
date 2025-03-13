import { ConditionError } from '../../errors';
import { ConditionStepExecutor } from '../../step-executors/condition-executor';
import { Step, StepExecutionContext } from '../../types';
import { defaultLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';
import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ConditionStep } from '../../step-executors/types';

describe('ConditionError scenarios', () => {
  let conditionExecutor: ConditionStepExecutor;
  let context: StepExecutionContext;
  const mockExecuteStep = jest.fn();
  
  beforeEach(() => {
    mockExecuteStep.mockReset();
    mockExecuteStep.mockResolvedValue({ result: 'success', type: 'request' });
    conditionExecutor = new ConditionStepExecutor(mockExecuteStep, defaultLogger);
    
    const stepResults = new Map();
    const contextObj = { nonBoolean: 'string value' };
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

  it('should throw ConditionError for invalid step type', async () => {
    const invalidStep: Step = {
      name: 'invalidStep',
      request: { // Not a condition step
        method: 'test',
        params: {}
      }
    };
    
    await expect(conditionExecutor.execute(invalidStep, context)).rejects.toThrow(ConditionError);
    await expect(conditionExecutor.execute(invalidStep, context)).rejects.toThrow(/Invalid step type for ConditionStepExecutor/);
  });

  it('should throw ConditionError for non-boolean condition', async () => {
    const stepWithNonBooleanCondition: ConditionStep = {
      name: 'nonBooleanConditionStep',
      condition: {
        if: '${nonBoolean}', // This will evaluate to a string, not a boolean
        then: {
          name: 'thenStep',
          request: {
            method: 'test',
            params: {}
          }
        }
      }
    };
    
    await expect(conditionExecutor.execute(stepWithNonBooleanCondition, context)).rejects.toThrow(ConditionError);
    await expect(conditionExecutor.execute(stepWithNonBooleanCondition, context)).rejects.toThrow(/Condition must evaluate to boolean/);
  });
}); 