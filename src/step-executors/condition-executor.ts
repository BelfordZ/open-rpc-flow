import { Step } from '../types';
import {
  StepExecutor,
  StepExecutionContext,
  StepExecutionResult,
  ConditionStep,
  isConditionStep,
  StepType
} from './types';

/**
 * Result type for condition steps, including which branch was taken
 */
export interface ConditionResult<T = any> {
  value: T;
  branchTaken: 'then' | 'else';
  conditionValue: boolean;
}

/**
 * Executor for conditional branching steps
 */
export class ConditionStepExecutor implements StepExecutor<ConditionStep, ConditionResult> {
  constructor(
    private executeStep: (step: Step, extraContext?: Record<string, any>) => Promise<any>
  ) {}

  canExecute = isConditionStep;

  async execute(
    step: ConditionStep,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {}
  ): Promise<StepExecutionResult<ConditionResult>> {
    const { expressionEvaluator, stepResults } = context;

    console.log('Executing condition step:', {
      stepName: step.name,
      condition: step.condition.if,
      extraContext,
      currentStepResults: Object.fromEntries(stepResults)
    });

    const conditionMet = expressionEvaluator.evaluateCondition(step.condition.if, extraContext);
    console.log('Condition evaluation result:', {
      condition: step.condition.if,
      result: conditionMet
    });

    const branchTaken = conditionMet ? 'then' as const : 'else' as const;
    const branchStep = conditionMet ? step.condition.then : step.condition.else;

    console.log('Selected branch:', {
      branchTaken,
      step: branchStep?.name
    });

    let result;
    if (branchStep) {
      console.log('Executing conditional step:', {
        stepName: branchStep.name,
        type: Object.keys(branchStep).find(k => k !== 'name')
      });
      result = await this.executeStep(branchStep, extraContext);
      stepResults.set(branchStep.name, result);
      console.log('Conditional step result:', {
        stepName: branchStep.name,
        result
      });
    }

    const executionResult: StepExecutionResult<ConditionResult> = {
      result: {
        value: result,
        branchTaken,
        conditionValue: conditionMet
      },
      type: StepType.Condition,
      metadata: {
        condition: step.condition.if,
        branchTaken,
        stepName: branchStep?.name
      }
    };

    console.log('Condition step complete:', {
      stepName: step.name,
      result: executionResult
    });

    return executionResult;
  }
} 