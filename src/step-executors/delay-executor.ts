import { Step, StepExecutionContext } from '../types';
import { DelayStep, StepExecutor, StepExecutionResult, StepType } from './types';
import { Logger } from '../util/logger';
import { ValidationError } from '../errors/base';

type ExecuteStep = (
  step: Step,
  extraContext?: Record<string, any>,
  signal?: AbortSignal,
) => Promise<StepExecutionResult>;

export class DelayStepExecutor implements StepExecutor {
  private logger: Logger;

  constructor(
    private executeStep: ExecuteStep,
    logger: Logger,
  ) {
    this.logger = logger.createNested('DelayStepExecutor');
  }

  canExecute(step: Step): step is DelayStep {
    return 'delay' in step;
  }

  async execute(
    step: Step,
    _context: StepExecutionContext,
    extraContext: Record<string, any> = {},
    signal?: AbortSignal,
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new ValidationError('Invalid step type for DelayStepExecutor', { step });
    }

    const delayStep: DelayStep = step;
    const { duration, step: nestedStep } = delayStep.delay;

    if (typeof duration !== 'number' || Number.isNaN(duration)) {
      throw new ValidationError('Delay duration must be a number', {
        stepName: step.name,
      });
    }

    if (duration < 0) {
      throw new ValidationError('Delay duration must be non-negative', {
        stepName: step.name,
      });
    }
    if (!nestedStep) {
      throw new ValidationError('Delay step must include a nested step', {
        stepName: step.name,
      });
    }

    this.logger.debug('Starting delay', { stepName: step.name, duration });

    await new Promise<void>((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | undefined;
      let onAbort = () => {};
      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      };
      onAbort = () => {
        const abortError = new Error('Delay aborted');
        abortError.name = 'AbortError';
        cleanup();
        reject(abortError);
      };

      timeoutId = setTimeout(() => {
        cleanup();
        resolve();
      }, duration);
      if (signal) {
        if (signal.aborted) {
          return onAbort();
        }
        signal.addEventListener('abort', onAbort);
      }
    });

    this.logger.debug('Executing nested step after delay', {
      stepName: step.name,
      nestedStepName: nestedStep.name,
    });

    const nestedContext = {
      ...extraContext,
      _nestedStep: true,
      _parentStep: step.name,
    };

    const result = await this.executeStep(nestedStep, nestedContext, signal);

    return {
      type: StepType.Delay,
      result,
      metadata: {
        stepName: step.name,
        duration,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
