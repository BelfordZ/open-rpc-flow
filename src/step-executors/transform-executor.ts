import { TransformExecutor } from '../transform-executor';
import {
  StepExecutor,
  StepExecutionContext,
  StepExecutionResult,
  TransformStep,
  isTransformStep,
  StepType
} from './types';

/**
 * Metadata about the transform operations
 */
export interface TransformMetadata {
  operationCount: number;
  operations: Array<{
    type: string;
    contextVariable?: string;
  }>;
  inputSource?: string;
}

/**
 * Executor for transform steps
 */
export class TransformStepExecutor implements StepExecutor<TransformStep> {
  constructor(private transformExecutor: TransformExecutor) {}

  canExecute = isTransformStep;

  async execute(
    step: TransformStep,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {}
  ): Promise<StepExecutionResult> {
    // Evaluate the input expression
    let input;
    if (step.transform.input) {
      input = context.expressionEvaluator.evaluateExpression(step.transform.input, extraContext);
    }

    const result = await this.transformExecutor.execute(step.transform.operations, input);

    return {
      result,
      type: StepType.Transform,
      metadata: {
        operations: step.transform.operations.map(op => op.type),
        inputSource: step.transform.input
      }
    };
  }
} 