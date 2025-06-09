import { Step, StepExecutionContext } from '../types';
import { StepExecutor, StepExecutionResult, StepType } from './types';
import { Logger } from '../util/logger';
import { ValidationError } from '../errors/base';

export interface DelayStep extends Step {
  delay: {
    duration: number;
    step: Step;
  };
}

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

    const delayStep = step as DelayStep;
    const { duration, step: nestedStep } = delayStep.delay;

    if (duration < 0) {
      throw new ValidationError('Delay duration must be non-negative', {
        stepName: step.name,
      });
    }

    this.logger.debug('Starting delay', { stepName: step.name, duration });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, duration);
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timeout);
          return reject(new Error('Delay aborted'));
        }
        const onAbort = () => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', onAbort);
          reject(new Error('Delay aborted'));
        };
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
