import { Step, StepExecutionContext, ExecutionContextData } from '../types';
import { StepExecutor, StepExecutionResult, StepType } from './types';
import { Logger } from '../util/logger';
import { getDataType } from '../util/type-utils';
import { ValidationError } from '../errors/base';

export interface StopStep extends Step {
  stop: {
    endWorkflow?: boolean;
  };
}

export class StopStepExecutor implements StepExecutor {
  private logger: Logger;
  private globalAbortController?: AbortController;

  constructor(logger: Logger, globalAbortController?: AbortController) {
    this.logger = logger.createNested('StopStepExecutor');
    this.globalAbortController = globalAbortController;
  }

  canExecute(step: Step): step is StopStep {
    return 'stop' in step;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(
    step: Step,
    context: StepExecutionContext, // eslint-disable-line @typescript-eslint/no-unused-vars
    extraContext?: ExecutionContextData, // eslint-disable-line @typescript-eslint/no-unused-vars
    signal?: AbortSignal, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new ValidationError('Invalid step type for StopStepExecutor', { step });
    }

    const stopStep = step as StopStep;
    const endWorkflow = stopStep.stop.endWorkflow ?? false;

    this.logger.debug('Stop step input type', {
      stepName: step.name,
      expected: 'boolean',
      actual: getDataType(stopStep.stop.endWorkflow),
    });

    this.logger.debug('Executing stop step', {
      stepName: step.name,
      endWorkflow,
    });

    // Perform cleanup and termination logic here
    if (endWorkflow) {
      this.logger.info('Terminating entire workflow', { stepName: step.name });
      if (this.globalAbortController && !this.globalAbortController.signal.aborted) {
        this.globalAbortController.abort('Stopped by stop step');
      }
    } else {
      this.logger.info('Terminating current branch', { stepName: step.name });
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
