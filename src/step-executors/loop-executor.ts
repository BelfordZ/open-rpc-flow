import { Step, StepExecutionContext, ExecutionContextData } from '../types';
import { StepExecutor, StepExecutionResult, StepType, LoopStep } from './types';
import { Logger } from '../util/logger';
import { ValidationError, LoopStepExecutionError } from '../errors/base';
import { getDataType } from '../util/type-utils';
import { canRunLoopInParallel } from './loop-parallel-safety';

export type ExecuteStep = (
  step: Step,
  extraContext?: ExecutionContextData,
  signal?: AbortSignal,
) => Promise<StepExecutionResult>;

/** A single iteration, precomputed before execution starts. */
interface IterationPlan {
  index: number;
  item: unknown;
  descriptor: {
    index: number;
    count: number;
    total: number;
    maxIterations: number;
    isFirst: boolean;
    isLast: boolean;
    value: unknown;
  };
}

type IterationOutcome =
  | { index: number; skipped: true; result?: undefined }
  | { index: number; skipped: false; result: StepExecutionResult };

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

    const loopStep: LoopStep = step;

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

      this.logger.debug('Input type check', {
        stepName: step.name,
        expected: 'array',
        actual: getDataType(collection),
      });

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

      const maxIterations = loopStep.loop.maxIterations || collection.length;
      const planned = this.planIterations(collection, maxIterations);

      const decision = canRunLoopInParallel(loopStep);
      this.logger.debug('Loop parallelism decision', {
        stepName: step.name,
        parallel: decision.parallel,
        reason: decision.reason,
        iterations: planned.length,
      });

      if (decision.parallel) {
        return await this.executeParallel(
          step,
          loopStep,
          context,
          extraContext,
          signal,
          collection,
          maxIterations,
          planned,
        );
      }
      return await this.executeSequential(
        step,
        loopStep,
        context,
        extraContext,
        signal,
        collection,
        maxIterations,
      );
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

  /**
   * Precomputes one plan entry per iteration (up to maxIterations). Planning
   * up front means parallel iterations share no mutable bookkeeping.
   */
  private planIterations(collection: unknown[], maxIterations: number): IterationPlan[] {
    const planned: IterationPlan[] = [];
    const total = Math.min(maxIterations, collection.length);
    for (let index = 0; index < total; index++) {
      const count = index + 1;
      planned.push({
        index,
        item: collection[index],
        descriptor: {
          index,
          count,
          total: collection.length,
          maxIterations,
          isFirst: count === 1,
          isLast: count === maxIterations || count === collection.length,
          value: collection[index],
        },
      });
    }
    return planned;
  }

  /**
   * The original sequential iteration behavior, preserved exactly: iterations
   * run one at a time, each observing the history of previous iterations.
   */
  private async executeSequential(
    step: Step,
    loopStep: LoopStep,
    context: StepExecutionContext,
    extraContext: ExecutionContextData,
    signal: AbortSignal | undefined,
    collection: unknown[],
    maxIterations: number,
  ): Promise<StepExecutionResult> {
    const results: StepExecutionResult[] = [];
    let iterationCount = 0;
    let executedCount = 0;
    let skippedCount = 0;

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

      const result = await this.executeIterationBody(loopStep, iterationContext, signal);
      results.push(result);
      executedCount++;
    }

    // Calculate total skipped count (condition skips + remaining items)
    const remainingItems = collection.length - iterationCount;
    const totalSkipped = skippedCount + remainingItems;

    this.logger.debug('Loop execution completed', {
      stepName: step.name,
      parallel: false,
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
        parallel: false,
      },
    };
  }

  /**
   * Runs all iterations concurrently. Each iteration gets its own context
   * object, so iterations cannot clobber each other's variables; results are
   * reassembled in iteration order regardless of completion order.
   *
   * Error behavior mirrors the sequential loop: the first failure rejects the
   * whole loop (wrapped as a LoopStepExecutionError by the caller).
   * Already-started iterations are not cancelled — they share the caller's
   * AbortSignal — and Promise.all observes every task, so late rejections
   * from stragglers are never unhandled.
   */
  private async executeParallel(
    step: Step,
    loopStep: LoopStep,
    context: StepExecutionContext,
    extraContext: ExecutionContextData,
    signal: AbortSignal | undefined,
    collection: unknown[],
    maxIterations: number,
    planned: IterationPlan[],
  ): Promise<StepExecutionResult> {
    const metadata = {
      maxIterations,
      variable: loopStep.loop.as,
      parallel: true,
    };

    if (signal?.aborted) {
      this.logger.warn('Loop aborted by signal', { stepName: step.name });
      return {
        type: StepType.Loop,
        result: {
          value: [],
          iterationCount: 0,
          skippedCount: collection.length,
        },
        metadata,
      };
    }

    // `metadata.iteration` carries the planned prefix for each iteration, the
    // same shape as the sequential loop: iteration N sees the descriptors of
    // iterations 1..N. The descriptors are precomputed plans (not results),
    // so the prefix is deterministic. Parallel-safe bodies never read it
    // (see canRunLoopInParallel).
    const totalForProgress = Math.min(maxIterations, collection.length);
    for (const entry of planned) {
      this.progressCallback?.(step, entry.descriptor.count, totalForProgress);
    }

    const tasks: Promise<IterationOutcome>[] = planned.map(
      async (entry): Promise<IterationOutcome> => {
        const iterationContext: ExecutionContextData = {
          ...extraContext,
          [loopStep.loop.as]: entry.item,
          metadata: {
            iteration: planned
              .slice(0, entry.index + 1)
              .map((plannedEntry) => plannedEntry.descriptor),
            current: entry.descriptor,
          },
        };

        this.logger.debug('Creating iteration context', {
          iterationCount: entry.descriptor.count,
          currentItem: entry.item,
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
              iteration: entry.descriptor.count,
            });
            return { index: entry.index, skipped: true };
          }
        }

        this.logger.debug('Executing loop iteration', {
          stepName: step.name,
          iteration: entry.descriptor.count,
        });

        const result = await this.executeIterationBody(loopStep, iterationContext, signal);
        return { index: entry.index, skipped: false, result };
      },
    );

    const outcomes = await Promise.all(tasks);

    const results: StepExecutionResult[] = [];
    let skippedCount = 0;
    // Promise.all preserves task order, so outcomes are already in iteration
    // order regardless of completion order.
    for (const outcome of outcomes) {
      if (outcome.skipped) {
        skippedCount++;
      } else {
        results.push(outcome.result);
      }
    }

    // Calculate total skipped count (condition skips + remaining items)
    const remainingItems = collection.length - planned.length;
    const totalSkipped = skippedCount + remainingItems;

    this.logger.debug('Loop execution completed', {
      stepName: step.name,
      parallel: true,
      totalIterations: planned.length,
      executedCount: results.length,
      skippedCount: totalSkipped,
      resultsCount: results.length,
    });

    return {
      type: StepType.Loop,
      result: {
        value: results,
        iterationCount: planned.length,
        skippedCount: totalSkipped,
      },
      metadata,
    };
  }

  /**
   * Runs the body of a single iteration: either the single `loop.step`, or
   * the `loop.steps` sequence, which stays sequential within an iteration
   * because steps in one iteration may depend on each other.
   */
  private async executeIterationBody(
    loopStep: LoopStep,
    iterationContext: ExecutionContextData,
    signal?: AbortSignal,
  ): Promise<StepExecutionResult> {
    if (loopStep.loop.step) {
      return this.executeStep(loopStep.loop.step, iterationContext, signal);
    }

    // execute() validates that either `step` or `steps` is defined.
    const innerSteps = loopStep.loop.steps as Step[];
    const stepResults: StepExecutionResult[] = [];
    for (const stepToExecute of innerSteps) {
      const result = await this.executeStep(stepToExecute, iterationContext, signal);
      stepResults.push(result);
    }
    return {
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
    };
  }
}
