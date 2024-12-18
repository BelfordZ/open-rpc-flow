import { Step } from '../types';
import {
  StepExecutor,
  StepExecutionContext,
  StepExecutionResult,
  LoopStep,
  isLoopStep,
  StepType,
  LoopStepResult,
  LoopResult,
  LoopResultBase
} from './types';

/**
 * Executor for loop steps with improved typing
 */
export class LoopStepExecutor<T = any> implements StepExecutor<LoopStep, LoopResult<T>> {
  constructor(
    private executeStep: (step: Step, extraContext?: Record<string, any>) => Promise<StepExecutionResult<T> | LoopStepResult<T>>
  ) {}

  canExecute = isLoopStep;

  async execute(
    step: LoopStep,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {}
  ): Promise<LoopStepResult<T>> {
    const { expressionEvaluator, stepResults } = context;

    console.log('Executing loop step:', {
      stepName: step.name,
      loopConfig: step.loop,
      extraContext,
      currentStepResults: Object.fromEntries(stepResults)
    });

    const items = expressionEvaluator.evaluateExpression(step.loop.over, extraContext);
    console.log('Loop items evaluation:', {
      expression: step.loop.over,
      items
    });

    if (!Array.isArray(items)) {
      throw new Error(`Loop over expression must evaluate to an array, got ${typeof items}`);
    }

    const results: T[] = [];
    let skippedCount = 0;
    let processedCount = 0;
    const maxIterations = step.loop.maxIterations ?? items.length;

    for (let i = 0; i < items.length && processedCount < maxIterations; i++) {
      const item = items[i];
      const iterationContext = {
        ...extraContext,
        [step.loop.as]: item,
        $index: i
      };

      console.log('Starting iteration:', {
        index: i,
        item,
        iterationContext
      });

      if (step.loop.condition) {
        const conditionMet = expressionEvaluator.evaluateCondition(step.loop.condition, iterationContext);
        console.log('Loop condition evaluation:', {
          condition: step.loop.condition,
          result: conditionMet,
          context: iterationContext
        });

        if (!conditionMet) {
          console.log('Skipping iteration due to condition:', {
            index: i,
            item
          });
          skippedCount++;
          processedCount++;
          continue;
        }
      }

      const iterationResult = await this.executeStep(
        step.loop.step,
        iterationContext
      );

      if (isLoopResult(iterationResult)) {
        results.push(iterationResult.result as T);
      } else {
        results.push(iterationResult.result);
      }
      processedCount++;

      console.log('Iteration complete:', {
        index: i,
        result: iterationResult
      });
    }

    const result: LoopStepResult<T> = {
      result: {
        value: results,
        iterationCount: processedCount,
        skippedCount
      },
      type: StepType.Loop,
      metadata: {
        totalIterations: processedCount,
        completedIterations: results.length,
        skippedIterations: skippedCount
      }
    };

    console.log('Loop step complete:', {
      stepName: step.name,
      result
    });

    return result;
  }
}

/**
 * Type guard for loop results
 */
export function isLoopResult<T>(result: StepExecutionResult<any>): result is LoopStepResult<T> {
  return result.type === StepType.Loop && 
         'value' in result.result &&
         'iterationCount' in result.result &&
         'skippedCount' in result.result;
} 