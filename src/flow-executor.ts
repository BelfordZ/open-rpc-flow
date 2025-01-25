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
} from './step-executors';
import { Logger, defaultLogger } from './util/logger';

/**
 * Main executor for JSON-RPC flows
 */
export class FlowExecutor {
  private context: Record<string, any>;
  private stepResults: Map<string, any>;
  private executionContext: StepExecutionContext;
  private stepExecutors: StepExecutor[];
  private dependencyResolver: DependencyResolver;
  private logger: Logger;

  constructor(
    private flow: Flow,
    private jsonRpcHandler: (request: JsonRpcRequest) => Promise<any>,
    logger?: Logger,
  ) {
    this.logger = logger || defaultLogger;
    this.context = flow.context || {};
    this.stepResults = new Map();
    this.dependencyResolver = new DependencyResolver(this.flow, this.logger);

    // Initialize shared execution context
    const referenceResolver = new ReferenceResolver(this.stepResults, this.context, this.logger);
    const expressionEvaluator = new SafeExpressionEvaluator(this.logger, referenceResolver);

    this.executionContext = {
      referenceResolver,
      expressionEvaluator,
      stepResults: this.stepResults,
      context: this.context,
      logger: this.logger,
    };

    // Initialize step executors in order of specificity
    this.stepExecutors = [
      new RequestStepExecutor(jsonRpcHandler, this.logger),
      new LoopStepExecutor(this.executeStep.bind(this), this.logger),
      new ConditionStepExecutor(this.executeStep.bind(this), this.logger),
      new TransformStepExecutor(expressionEvaluator, referenceResolver, this.context, this.logger),
    ];
  }

  /**
   * Execute the flow and return all step results
   */
  async execute(): Promise<Map<string, any>> {
    // Get steps in dependency order
    const orderedSteps = this.dependencyResolver.getExecutionOrder();
    this.logger.log(
      'Executing steps in order:',
      orderedSteps.map((s) => s.name),
    );

    for (const step of orderedSteps) {
      const result = await this.executeStep(step);
      this.stepResults.set(step.name, result);
    }
    return this.stepResults;
  }

  /**
   * Execute a single step using the appropriate executor
   */
  private async executeStep(
    step: Step,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    try {
      this.logger.debug('Executing step:', {
        stepName: step.name,
        stepType: Object.keys(step).find((k) => k !== 'name'),
        availableExecutors: this.stepExecutors.map((e) => e.constructor.name),
      });

      const executor = this.findExecutor(step);
      if (!executor) {
        throw new Error(`No executor found for step ${step.name}`);
      }

      this.logger.debug('Selected executor:', {
        stepName: step.name,
        executor: executor.constructor.name,
      });

      return await executor.execute(step, this.executionContext, extraContext);
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      this.logger.error(`Step execution failed: ${step.name}`, { error: errorMessage });
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
}
