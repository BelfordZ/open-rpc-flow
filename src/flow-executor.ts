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

/**
 * Main executor for JSON-RPC flows
 */
export class FlowExecutor {
  public dependencyResolver: DependencyResolver;
  public referenceResolver: ReferenceResolver;
  public expressionEvaluator: SafeExpressionEvaluator;

  private context: Record<string, any>;
  private stepResults: Map<string, any>;
  private executionContext: StepExecutionContext;
  private stepExecutors: StepExecutor[];
  private logger: Logger;

  constructor(
    private flow: Flow,
    private jsonRpcHandler: (request: JsonRpcRequest) => Promise<any>,
    logger?: Logger,
  ) {
    this.logger = logger || defaultLogger;
    this.context = flow.context || {};
    this.stepResults = new Map();

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
      new RequestStepExecutor(jsonRpcHandler, this.logger),
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
   * Execute the flow and return all step results
   */
  async execute(): Promise<Map<string, any>> {
    // Get steps in dependency order
    console.log('Getting execution order...');
    const orderedSteps = this.dependencyResolver.getExecutionOrder();
    console.log(
      'Got execution order:',
      orderedSteps.map((s) => s.name),
    );

    this.logger.log(
      'Executing steps in order:',
      orderedSteps.map((s) => s.name),
    );

    for (const step of orderedSteps) {
      console.log('Starting execution of step:', step.name);
      const result = await this.executeStep(step);
      console.log('Step execution completed:', step.name, 'type:', result.type);

      this.stepResults.set(step.name, result);
      console.log('Step results set for:', step.name);

      // Check if the step or any nested step resulted in a stop
      console.log('Checking for stop result in:', step.name);
      const shouldStop = this.checkForStopResult(result);
      console.log('Should stop?', shouldStop, 'for step:', step.name);

      if (shouldStop) {
        this.logger.log('Workflow stopped by step:', step.name);
        break;
      }
    }
    console.log('Flow execution completed, returning results');
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
      console.log('executeStep - Starting:', step.name);
      this.logger.debug('Executing step:', {
        stepName: step.name,
        stepType: Object.keys(step).find((k) => k !== 'name'),
        availableExecutors: this.stepExecutors.map((e) => e.constructor.name),
      });

      console.log('Finding executor for step:', step.name);
      const executor = this.findExecutor(step);
      if (!executor) {
        throw new Error(`No executor found for step ${step.name}`);
      }

      console.log('Found executor:', executor.constructor.name, 'for step:', step.name);
      this.logger.debug('Selected executor:', {
        stepName: step.name,
        executor: executor.constructor.name,
      });

      console.log('Executing step with executor:', step.name);
      const result = await executor.execute(step, this.executionContext, extraContext);
      console.log('Executor completed for step:', step.name, 'result type:', result.type);

      return result;
    } catch (error: any) {
      console.error('Step execution failed:', step.name, error);
      const errorMessage = error.message || String(error);
      this.logger.error(`Step execution failed: ${step.name}`, { error: errorMessage });
      throw new Error(`Failed to execute step ${step.name}: ${errorMessage}`);
    }
  }

  /**
   * Find the appropriate executor for a step
   */
  private findExecutor(step: Step): StepExecutor | undefined {
    console.log('findExecutor - Checking executors for step:', step.name);
    // Try each executor in order of registration (most specific first)
    for (const executor of this.stepExecutors) {
      console.log('Checking executor:', executor.constructor.name);
      const canExecute = executor.canExecute(step);
      this.logger.debug('Checking executor:', {
        executor: executor.constructor.name,
        canExecute,
      });
      if (canExecute) {
        console.log('Found matching executor:', executor.constructor.name);
        return executor;
      }
    }
    console.log('No executor found for step:', step.name);
    return undefined;
  }

  /**
   * Check if a step result or any nested step result indicates a stop
   */
  private checkForStopResult(result: StepExecutionResult): boolean {
    console.log('checkForStopResult - Checking result type:', result.type);
    console.log('Result:', JSON.stringify(result, null, 2));

    // Direct stop result
    if (result.type === StepType.Stop && result.result.endWorkflow) {
      console.log('Found direct stop result with endWorkflow');
      return true;
    }

    // Check nested results (e.g. in condition or loop steps)
    if (result.result?.type === StepType.Stop && result.result.result.endWorkflow) {
      console.log('Found nested stop result with endWorkflow');
      return true;
    }

    console.log('No stop result found');
    return false;
  }
}
