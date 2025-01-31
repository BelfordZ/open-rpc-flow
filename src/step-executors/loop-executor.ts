import { Step, StepExecutionContext } from '../types';
import { StepExecutor, StepExecutionResult, StepType, LoopStep } from './types';
import { Logger } from '../util/logger';

export type ExecuteStep = (
  step: Step,
  extraContext?: Record<string, any>,
) => Promise<StepExecutionResult>;

export class LoopStepExecutor implements StepExecutor {
  private logger: Logger;

  constructor(
    private executeStep: ExecuteStep,
    logger: Logger,
    private eventEmitter?: EventEmitter,
    private eventOptions: Record<string, boolean> = {},
  ) {
    this.logger = logger.createNested('LoopStepExecutor');
  }

  canExecute(step: Step): step is LoopStep {
    return 'loop' in step;
  }

  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new Error('Invalid step type for LoopStepExecutor');
    }

    const loopStep = step as LoopStep;

    if (!loopStep.loop.step && !loopStep.loop.steps) {
      throw new Error('Loop must have either step or steps defined');
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
        throw new Error(
          `Loop "over" value must resolve to an array. ${JSON.stringify(
            {
              over: loopStep.loop.over,
              resolvedValue: collection,
              contextKeys: Object.keys(extraContext),
            },
            null,
            2,
          )}`,
        );
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
            iteration: [...iterationHistory], // copy of iterationHistory so that it get changed by later iterations
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

        if (this.eventEmitter && this.eventOptions.loopIterationStarted) {
          this.eventEmitter.emit('loopIterationStarted', {
            loopName: step.name,
            iterationIndex: iterationCount - 1,
            context: iterationContext,
          });
        }

        if (loopStep.loop.step) {
          const result = await this.executeStep(loopStep.loop.step, iterationContext);
          results.push(result);
          executedCount++;
        } else if (loopStep.loop.steps) {
          const stepResults = [];
          for (const stepToExecute of loopStep.loop.steps) {
            const result = await this.executeStep(stepToExecute, iterationContext);
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

        if (this.eventEmitter && this.eventOptions.loopIterationCompleted) {
          this.eventEmitter.emit('loopIterationCompleted', {
            loopName: step.name,
            iterationIndex: iterationCount - 1,
            result: results[results.length - 1].result,
            metadata: results[results.length - 1].metadata,
          });
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

      throw new Error(errorMessage);
    }
  }
}
