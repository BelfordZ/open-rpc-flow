import { Step, StepExecutionContext, ExecutionContextData } from '../types';
import { StepExecutor, StepExecutionResult, StepType, ConditionStep } from './types';
import { Logger } from '../util/logger';
import { ValidationError, ExecutionError } from '../errors/base';
import { TimeoutError } from '../errors/timeout-error';
import { PolicyResolver } from '../util/policy-resolver';

class ConditionStepExecutionError extends ExecutionError<ExecutionContextData> {
  constructor(message: string, context: ExecutionContextData, cause?: Error) {
    super(message, { ...context, code: 'EXECUTION_ERROR' }, cause);
    this.name = 'ConditionStepExecutionError';
    Object.setPrototypeOf(this, ConditionStepExecutionError.prototype);
  }
}

export class ConditionStepExecutor implements StepExecutor {
  private logger: Logger;
  private policyResolver: PolicyResolver;

  constructor(
    private executeStep: (
      step: Step,
      extraContext?: ExecutionContextData,
      signal?: AbortSignal,
    ) => Promise<StepExecutionResult>,
    logger: Logger,
    policyResolver: PolicyResolver,
  ) {
    this.logger = logger.createNested('ConditionStepExecutor');
    this.policyResolver = policyResolver;
  }

  canExecute(step: Step): step is ConditionStep {
    return 'condition' in step;
  }

  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: ExecutionContextData = {},
    signal?: AbortSignal,
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new ValidationError('Invalid step type for ConditionStepExecutor', { step });
    }

    const conditionStep = step as ConditionStep;

    this.logger.debug('Evaluating condition', {
      stepName: step.name,
      condition: conditionStep.condition.if,
    });

    // Get the timeout for the condition step
    const timeout = this.policyResolver?.resolveTimeout?.(step, StepType.Condition) ?? 5000;

    // Create an AbortController for this condition step
    const abortController = new AbortController();
    // If a parent signal is provided, abort this controller if the parent aborts
    if (signal) {
      if (signal.aborted) abortController.abort();
      else signal.addEventListener('abort', () => abortController.abort());
    }

    // Promise for the condition logic
    const conditionPromise = (async () => {
      try {
        const conditionValue = context.expressionEvaluator.evaluate(
          conditionStep.condition.if,
          extraContext,
          step,
        );

        this.logger.debug('Condition evaluated', {
          stepName: step.name,
          result: conditionValue,
        });

        let value: StepExecutionResult | undefined;
        const nestedContext = {
          ...extraContext,
          _nestedStep: true,
          _parentStep: step.name,
        };

        const branch = conditionValue
          ? { name: 'then' as const, step: conditionStep.condition.then }
          : conditionStep.condition.else
            ? { name: 'else' as const, step: conditionStep.condition.else }
            : undefined;

        if (branch) {
          this.logger.debug(`Executing ${branch.name} branch`, { stepName: step.name });
          value = await this.executeStep(branch.step, nestedContext, abortController.signal);
        }

        const branchTaken = branch?.name ?? 'else';

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
          error: error.toString(),
        });
        throw new ConditionStepExecutionError(
          `Failed to execute condition step "${step.name}": ${error?.message || 'Unknown error'}`,
          { stepName: step.name, condition: conditionStep.condition, originalError: error },
          error,
        );
      }
    })();

    // Promise for the timeout
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        abortController.abort();
        reject(TimeoutError.forStep(step, StepType.Condition, timeout, timeout));
      }, timeout);
    });

    // Race the condition logic against the timeout
    try {
      return await Promise.race([conditionPromise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }
}
