import { Step, StepExecutionContext, ExecutionContextData } from '../types';
import { StepExecutor, StepExecutionResult, StepType, LoopStep } from './types';
import { Logger } from '../util/logger';
import { ValidationError, LoopStepExecutionError } from '../errors/base';

export type ExecuteStep = (
  step: Step,
  extraContext?: ExecutionContextData,
  signal?: AbortSignal,
) => Promise<StepExecutionResult>;

export class LoopStepExecutor implements StepExecutor {
  private logger: Logger;

  constructor(
    private executeStep: ExecuteStep,
    logger: Logger,
    private progressCallback?: (step: Step, iteration: number, totalIterations: number) => void,
  ) {
    this.logger = logger.createNested('LoopStepExecutor');
  }

  canExecute(step: Step): step is LoopStep {
    return 'loop' in step;
  }

  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: ExecutionContextData = {},
    signal?: AbortSignal,
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new Error('Invalid step type for LoopStepExecutor');
    }

    const loopStep = step as LoopStep;

    if (!loopStep.loop.step && !loopStep.loop.steps) {
      throw new ValidationError('Loop must have either step or steps defined', {
        stepName: step.name,
      });
    }

    this.logger.debug('Starting loop execution', {
      stepName: step.name,
      iterationVariable: loopStep.loop.as,
      maxIterations: loopStep.loop.maxIterations,
    });

    try {
      // Resolve the collection to iterate over using expressionEvaluator
      const collection = context.expressionEvaluator.evaluate(loopStep.loop.over, extraContext);

      if (!Array.isArray(collection)) {
        throw new ValidationError(`Loop "over" value must resolve to an array`, {
          stepName: step.name,
          over: loopStep.loop.over,
          resolvedValue: collection,
          contextKeys: Object.keys(extraContext),
        });
      }

      this.logger.debug('Resolved loop collection', {
        stepName: step.name,
        collectionLength: collection.length,
      });

      const results: StepExecutionResult[] = [];
      let iterationCount = 0;
      let executedCount = 0;
      let skippedCount = 0;
      const maxIterations = loopStep.loop.maxIterations || collection.length;

      // Add this line to maintain iteration history
      const iterationHistory: any[] = [];

      for (const item of collection) {
        if (signal?.aborted) {
          this.logger.warn('Loop aborted by signal', { stepName: step.name });
          break;
        }
        // Check if we've reached maxIterations
        if (iterationCount >= maxIterations) {
          this.logger.debug('Reached maximum iterations', {
            stepName: step.name,
            maxIterations,
          });
          break;
        }

        // Increment iteration count before any processing
        iterationCount++;

        this.progressCallback?.(step, iterationCount, Math.min(maxIterations, collection.length));

        // Create iteration context with array of iterations
        const currentIteration = {
          index: iterationCount - 1, // Keep 0-based index for compatibility
          count: iterationCount,
          total: collection.length,
          maxIterations,
          isFirst: iterationCount === 1,
          isLast: iterationCount === maxIterations || iterationCount === collection.length,
          value: item,
        };

        // Add current iteration to history
        iterationHistory.push(currentIteration);

        const iterationContext = {
          ...extraContext,
          [loopStep.loop.as]: item,
          metadata: {
            iteration: [...iterationHistory], // copy of iterationHistory so that it isn't changed by later iterations
            current: currentIteration,
          },
        };

        this.logger.debug('Creating iteration context', {
          iterationCount,
          currentItem: item,
          iterationHistoryLength: iterationHistory.length,
          context: iterationContext,
        });

        // Check condition if present
        if (loopStep.loop.condition) {
          const conditionMet = context.expressionEvaluator.evaluate(
            loopStep.loop.condition,
            iterationContext,
            step,
          );

          if (!conditionMet) {
            this.logger.debug('Loop condition not met, skipping iteration', {
              stepName: step.name,
              iteration: iterationCount,
            });
            skippedCount++;
            continue;
          }
        }

        this.logger.debug('Executing loop iteration', {
          stepName: step.name,
          iteration: iterationCount,
        });

        if (loopStep.loop.step) {
          const result = await this.executeStep(loopStep.loop.step, iterationContext, signal);
          results.push(result);
          executedCount++;
        } else if (loopStep.loop.steps) {
          const stepResults = [];
          for (const stepToExecute of loopStep.loop.steps) {
            const result = await this.executeStep(stepToExecute, iterationContext, signal);
            stepResults.push(result);
          }
          results.push({
            type: StepType.Loop,
            result: {
              value: stepResults,
              iterationCount: 1,
              skippedCount: 0,
            },
            metadata: {
              maxIterations: 1,
              variable: loopStep.loop.as,
            },
          });
          executedCount++;
        }
      }

      // Calculate total skipped count (condition skips + remaining items)
      const remainingItems = collection.length - iterationCount;
      const totalSkipped = skippedCount + remainingItems;

      this.logger.debug('Loop execution completed', {
        stepName: step.name,
        totalIterations: iterationCount,
        executedCount,
        skippedCount: totalSkipped,
        resultsCount: results.length,
      });

      return {
        type: StepType.Loop,
        result: {
          value: results,
          iterationCount,
          skippedCount: totalSkipped,
        },
        metadata: {
          maxIterations,
          variable: loopStep.loop.as,
        },
      };
    } catch (error: any) {
      const errorMessage = `Failed to execute loop step "${step.name}": ${error?.message || 'Unknown error'}`;

      this.logger.error('Loop execution failed', {
        stepName: step.name,
        error: errorMessage,
      });

      throw new LoopStepExecutionError(
        errorMessage,
        {
          stepName: step.name,
          loop: loopStep.loop,
          originalError: error,
        },
        error,
      );
    }
  }
}
