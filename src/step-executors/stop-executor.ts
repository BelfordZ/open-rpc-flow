import { Step } from '../types';
import { StepExecutor, StepExecutionResult, StepType } from './types';
import { Logger } from '../util/logger';
import { ValidationError } from '../errors/base';

export interface StopStep extends Step {
  stop: {
    endWorkflow?: boolean;
  };
}

export class StopStepExecutor implements StepExecutor {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.createNested('StopStepExecutor');
  }

  canExecute(step: Step): step is StopStep {
    return 'stop' in step;
  }

  async execute(
    step: Step,
    context: any,
    extraContext?: Record<string, any>,
    signal?: AbortSignal
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new ValidationError('Invalid step type for StopStepExecutor', { step });
    }

    const stopStep = step as StopStep;
    const endWorkflow = stopStep.stop.endWorkflow ?? false;

    this.logger.debug('Executing stop step', {
      stepName: step.name,
      endWorkflow,
    });

    // Perform cleanup and termination logic here
    if (endWorkflow) {
      this.logger.log('Terminating entire workflow', { stepName: step.name });
      // Add logic to terminate all running steps and end the workflow
    } else {
      this.logger.log('Terminating current branch', { stepName: step.name });
      // Add logic to terminate the current branch of the workflow
    }

    return {
      type: StepType.Stop,
      result: { endWorkflow },
      metadata: {
        stepName: step.name,
        endWorkflow,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
