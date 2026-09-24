import { Step, StepExecutionContext, ExecutionContextData } from '../types';
import {
  StepExecutor,
  StepExecutionResult,
  StepType,
  ConditionStep,
  SwitchCondition,
  isSwitchCondition,
} from './types';
import { Logger } from '../util/logger';
import { getDataType } from '../util/type-utils';
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

    const conditionStep: ConditionStep = step;
    const condition = conditionStep.condition;

    this.logger.debug('Evaluating condition', {
      stepName: step.name,
      condition,
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
        if (isSwitchCondition(condition)) {
          if ('if' in condition) {
            throw new ValidationError(
              `Condition step "${step.name}" cannot define both "if" and "switch"; they are mutually exclusive.`,
              { stepName: step.name },
            );
          }
          return await this.executeSwitch(step, condition, context, extraContext, abortController);
        }

        const conditionValue = context.expressionEvaluator.evaluate(
          condition.if,
          extraContext,
          step,
        );

        this.logger.debug('Input type check', {
          stepName: step.name,
          expected: 'boolean',
          actual: getDataType(conditionValue),
        });

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
          ? { name: 'then' as const, step: condition.then }
          : condition.else
            ? { name: 'else' as const, step: condition.else }
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
            condition: condition.if,
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

  /**
   * Evaluates a switch condition and executes the matching case.
   *
   * The switch expression is evaluated like `if` is. Case keys are strings;
   * a non-string value matches the key equal to its `String()` coercion
   * (mirroring JavaScript property-access semantics). When no case matches,
   * the optional `default` runs; with neither, the step is skipped exactly
   * like an if/then without else.
   */
  private async executeSwitch(
    step: ConditionStep,
    condition: SwitchCondition,
    context: StepExecutionContext,
    extraContext: ExecutionContextData,
    abortController: AbortController,
  ): Promise<StepExecutionResult> {
    const switchValue = context.expressionEvaluator.evaluate(condition.switch, extraContext, step);

    this.logger.debug('Switch evaluated', {
      stepName: step.name,
      switchValue,
    });

    const nestedContext = {
      ...extraContext,
      _nestedStep: true,
      _parentStep: step.name,
    };

    const cases = condition.cases ?? {};
    const key = typeof switchValue === 'string' ? switchValue : String(switchValue);
    const hasCase = Object.prototype.hasOwnProperty.call(cases, key);
    const matched = hasCase ? cases[key] : condition.default;

    let value: StepExecutionResult | StepExecutionResult[] | undefined;
    let branchTaken: string;
    if (matched !== undefined) {
      branchTaken = hasCase ? key : 'default';
      const caseSteps = Array.isArray(matched) ? matched : [matched];
      this.logger.debug(`Executing switch case "${branchTaken}"`, { stepName: step.name });
      const results: StepExecutionResult[] = [];
      for (const caseStep of caseSteps) {
        results.push(await this.executeStep(caseStep, nestedContext, abortController.signal));
      }
      value = Array.isArray(matched) ? results : results[0];
    } else {
      branchTaken = 'none';
      this.logger.debug('No switch case matched; skipping', { stepName: step.name });
    }

    this.logger.debug('Switch execution completed', {
      stepName: step.name,
      branchTaken,
      switchValue,
    });

    return {
      type: StepType.Condition,
      result: value,
      metadata: {
        branchTaken,
        conditionValue: switchValue,
        condition: condition.switch,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
