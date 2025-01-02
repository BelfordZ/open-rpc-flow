import { Step, StepExecutionContext } from '../types';
import { StepExecutor, StepExecutionResult, StepType, TransformStep } from './types';
import { Logger } from '../util/logger';
import { TransformExecutor } from '../transform-executor';

export class TransformStepExecutor implements StepExecutor {
  constructor(
    private transformExecutor: TransformExecutor,
    private logger: Logger
  ) {}

  canExecute(step: Step): step is TransformStep {
    return 'transform' in step;
  }

  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new Error('Invalid step type for TransformStepExecutor');
    }

    const transformStep = step as TransformStep;
    
    this.logger.debug('Executing transform step', {
      stepName: step.name,
      operations: transformStep.transform.operations.map(op => op.type),
    });

    try {
      // Resolve input references
      const resolvedInput = context.referenceResolver.resolveReferences(
        transformStep.transform.input,
        extraContext,
      );

      this.logger.debug('Resolved transform input', {
        stepName: step.name,
        inputType: typeof resolvedInput,
        isArray: Array.isArray(resolvedInput),
      });

      const result = await this.transformExecutor.execute(
        transformStep.transform.operations,
        resolvedInput,
      );

      this.logger.debug('Transform completed successfully', {
        stepName: step.name,
        resultType: typeof result,
        isArray: Array.isArray(result),
      });

      return {
        result,
        type: StepType.Transform,
        metadata: {
          operations: transformStep.transform.operations.map(op => ({
            type: op.type,
            using: op.using,
            initial: 'initial' in op ? op.initial : undefined,
          })),
          inputType: Array.isArray(resolvedInput) ? 'array' : typeof resolvedInput,
          resultType: Array.isArray(result) ? 'array' : typeof result,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      this.logger.error('Transform failed', {
        stepName: step.name,
        error: error.message || String(error),
      });
      throw error;
    }
  }
}
