import { Step, StepExecutionContext } from '../types';
import { StepExecutor, StepExecutionResult, StepType, ConditionStep } from './types';
import { Logger } from '../util/logger';

export class ConditionStepExecutor implements StepExecutor {
  private logger: Logger;

  constructor(
    private executeStep: (
      step: Step,
      extraContext?: Record<string, any>,
    ) => Promise<StepExecutionResult>,
    logger: Logger,
    private eventEmitter?: EventEmitter,
    private eventOptions: Record<string, boolean> = {},
  ) {
    this.logger = logger.createNested('ConditionStepExecutor');
  }

  canExecute(step: Step): step is ConditionStep {
    return 'condition' in step;
  }

  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new Error('Invalid step type for ConditionStepExecutor');
    }

    const conditionStep = step as ConditionStep;

    this.logger.debug('Evaluating condition', {
      stepName: step.name,
      condition: conditionStep.condition.if,
    });

    try {
      const conditionValue = context.expressionEvaluator.evaluate(
        conditionStep.condition.if,
        extraContext,
      );

      this.logger.debug('Condition evaluated', {
        stepName: step.name,
        result: conditionValue,
      });

      if (this.eventEmitter && this.eventOptions.conditionEvaluated) {
        this.eventEmitter.emit('conditionEvaluated', {
          condition: conditionStep.condition.if,
          result: conditionValue,
          context: extraContext,
        });
      }

      let value: StepExecutionResult | undefined;
      let branchTaken: 'then' | 'else' | undefined;

      if (conditionValue) {
        this.logger.debug('Executing then branch', { stepName: step.name });
        value = await this.executeStep(conditionStep.condition.then, extraContext);
        branchTaken = 'then';
      } else if (conditionStep.condition.else) {
        this.logger.debug('Executing else branch', { stepName: step.name });
        value = await this.executeStep(conditionStep.condition.else, extraContext);
        branchTaken = 'else';
      } else {
        branchTaken = 'else';
      }

      this.logger.debug('Condition execution completed', {
        stepName: step.name,
        branchTaken,
        conditionValue,
      });

      return {
        type: StepType.Condition,
        result: value,
        metadata: {
          branchTaken,
          conditionValue,
          condition: conditionStep.condition.if,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      this.logger.error('Condition execution failed', {
        stepName: step.name,
        error: error.message || String(error),
      });
      throw error;
    }
  }
}
