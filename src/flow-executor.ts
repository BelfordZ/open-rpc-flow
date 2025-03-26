import { ReferenceResolver } from './reference-resolver';
import { SafeExpressionEvaluator } from './expression-evaluator/safe-evaluator';
import { DependencyResolver } from './dependency-resolver';
import { Flow, Step, JsonRpcRequest, StepExecutionContext } from './types';
import {
  StepExecutor,
  StepExecutionResult,
  RequestStepExecutor,
  LoopStepExecutor,
  ConditionStepExecutor,
  TransformStepExecutor,
  StopStepExecutor,
  StepType,
} from './step-executors';
import { Logger, defaultLogger } from './util/logger';
import { FlowExecutorEvents, FlowEventOptions } from './util/flow-executor-events';

/**
 * Options for the FlowExecutor
 */
export interface FlowExecutorOptions {
  /** Logger instance to use */
  logger?: Logger;
  /** Event emitter options */
  eventOptions?: Partial<FlowEventOptions>;
}

/**
 * Main executor for JSON-RPC flows
 */
export class FlowExecutor {
  public dependencyResolver: DependencyResolver;
  public referenceResolver: ReferenceResolver;
  public expressionEvaluator: SafeExpressionEvaluator;
  public events: FlowExecutorEvents;

  private context: Record<string, any>;
  private stepResults: Map<string, any>;
  private executionContext: StepExecutionContext;
  private stepExecutors: StepExecutor[];
  private logger: Logger;

  constructor(
    private flow: Flow,
    private jsonRpcHandler: (request: JsonRpcRequest) => Promise<any>,
    loggerOrOptions?: Logger | FlowExecutorOptions,
  ) {
    // Handle both new options object and legacy logger parameter
    let options: FlowExecutorOptions | undefined;

    if (loggerOrOptions instanceof Object && !(loggerOrOptions as Logger).log) {
      // It's an options object
      options = loggerOrOptions as FlowExecutorOptions;
      this.logger = options?.logger || defaultLogger;
    } else {
      // It's a logger instance (or undefined)
      this.logger = (loggerOrOptions as Logger) || defaultLogger;
      options = { logger: this.logger };
    }

    this.context = flow.context || {};
    this.stepResults = new Map();

    // Initialize the event emitter
    this.events = new FlowExecutorEvents(options?.eventOptions);

    // Initialize shared execution context
    this.referenceResolver = new ReferenceResolver(this.stepResults, this.context, this.logger);
    this.expressionEvaluator = new SafeExpressionEvaluator(this.logger, this.referenceResolver);
    this.dependencyResolver = new DependencyResolver(
      this.flow,
      this.expressionEvaluator,
      this.logger,
    );

    this.executionContext = {
      referenceResolver: this.referenceResolver,
      expressionEvaluator: this.expressionEvaluator,
      stepResults: this.stepResults,
      context: this.context,
      logger: this.logger,
    };

    // Initialize step executors in order of specificity
    this.stepExecutors = [
      new RequestStepExecutor(this.jsonRpcHandler, this.logger),
      new LoopStepExecutor(this.executeStep.bind(this), this.logger),
      new ConditionStepExecutor(this.executeStep.bind(this), this.logger),
      new TransformStepExecutor(
        this.expressionEvaluator,
        this.referenceResolver,
        this.context,
        this.logger,
      ),
      new StopStepExecutor(this.logger),
    ];
  }

  /**
   * Update event emitter options
   */
  updateEventOptions(options: Partial<FlowEventOptions>): void {
    this.events.updateOptions(options);
  }

  /**
   * Execute the flow and return all step results
   */
  async execute(): Promise<Map<string, any>> {
    const startTime = Date.now();

    try {
      // Get steps in dependency order
      const orderedSteps = this.dependencyResolver.getExecutionOrder();
      const orderedStepNames = orderedSteps.map((s) => s.name);

      this.events.emitDependencyResolved(orderedStepNames);
      this.events.emitFlowStart(this.flow.name, orderedStepNames);

      this.logger.log('Executing steps in order:', orderedStepNames);

      for (const step of orderedSteps) {
        const stepStartTime = Date.now();

        try {
          this.events.emitStepStart(step, this.executionContext);

          const result = await this.executeStep(step);
          this.stepResults.set(step.name, result);

          this.events.emitStepComplete(step, result, stepStartTime);

          // Check if the step or any nested step resulted in a stop
          const shouldStop = this.checkForStopResult(result);

          if (shouldStop) {
            this.logger.log('Workflow stopped by step:', step.name);
            this.events.emitStepSkip(step, 'Workflow stopped by previous step');
            break;
          }
        } catch (error: any) {
          this.events.emitStepError(step, error, stepStartTime);
          throw error; // Re-throw to be caught by the outer try/catch
        }
      }

      this.events.emitFlowComplete(this.flow.name, this.stepResults, startTime);
      return this.stepResults;
    } catch (error: any) {
      this.events.emitFlowError(this.flow.name, error, startTime);
      throw error;
    }
  }

  /**
   * Execute a single step using the appropriate executor
   */
  private async executeStep(
    step: Step,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    const stepStartTime = Date.now();

    try {
      this.logger.debug('Executing step:', {
        stepName: step.name,
        stepType: Object.keys(step).find((k) => k !== 'name'),
        availableExecutors: this.stepExecutors.map((e) => e.constructor.name),
      });

      // Only emit step events for nested steps
      if (Object.keys(extraContext).length > 0) {
        this.events.emitStepStart(step, this.executionContext, extraContext);
      }

      const executor = this.findExecutor(step);
      if (!executor) {
        throw new Error(`No executor found for step ${step.name}`);
      }

      this.logger.debug('Selected executor:', {
        stepName: step.name,
        executor: executor.constructor.name,
      });

      const result = await executor.execute(step, this.executionContext, extraContext);

      // Only emit step complete for nested steps
      if (Object.keys(extraContext).length > 0) {
        this.events.emitStepComplete(step, result, stepStartTime);
      }

      return result;
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      this.logger.error(`Step execution failed: ${step.name}`, { error: errorMessage });

      // Only emit step error for nested steps
      if (Object.keys(extraContext).length > 0) {
        this.events.emitStepError(step, error, stepStartTime);
      }

      throw new Error(`Failed to execute step ${step.name}: ${errorMessage}`);
    }
  }

  /**
   * Find the appropriate executor for a step
   */
  private findExecutor(step: Step): StepExecutor | undefined {
    // Try each executor in order of registration (most specific first)
    for (const executor of this.stepExecutors) {
      const canExecute = executor.canExecute(step);
      this.logger.debug('Checking executor:', {
        executor: executor.constructor.name,
        canExecute,
      });
      if (canExecute) {
        return executor;
      }
    }
    return undefined;
  }

  /**
   * Check if a step result or any nested step result indicates a stop
   */
  private checkForStopResult(result: StepExecutionResult): boolean {
    // Direct stop result
    if (result.type === StepType.Stop && result.result.endWorkflow) {
      return true;
    }

    // Check nested results (e.g. in condition or loop steps)
    if (result.result?.type === StepType.Stop && result.result.result.endWorkflow) {
      return true;
    }

    return false;
  }
}
