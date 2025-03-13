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
import { ValidationError } from './errors';
import { FlowError } from './errors';
import { StepExecutionError } from './errors';

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
    
    // Validate flow structure
    this.validateFlow(flow);
    
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
   * Validates the flow structure and throws ValidationError if requirements are not met
   */
  private validateFlow(flow: Flow): void {
    // Check if name is present
    if (!flow.name) {
      throw new ValidationError('Missing required field: name', { field: 'name' });
    }

    // Check if steps is present and is an array
    if (!flow.steps) {
      throw new ValidationError('Missing required field: steps', { field: 'steps' });
    }

    if (!Array.isArray(flow.steps)) {
      throw new ValidationError('Steps must be an array', { field: 'steps', type: typeof flow.steps });
    }

    // Check if steps array is not empty
    if (flow.steps.length === 0) {
      throw new ValidationError('Flow must have at least one step', { field: 'steps' });
    }

    // Check if description is present
    if (!flow.description) {
      throw new ValidationError('Missing required field: description', { field: 'description' });
    }

    // Validate each step has a name
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      if (!step.name) {
        throw new ValidationError(`Step at index ${i} is missing required field: name`, { 
          stepIndex: i,
          field: 'name'
        });
      }
    }
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

      // Check if the step or any nested step resulted in a stop
      const shouldStop = this.checkForStopResult(result);

      if (shouldStop) {
        this.logger.log('Workflow stopped by step:', step.name);
        break;
      }
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
        throw new ValidationError(`No executor found for step ${step.name}`, {
          stepName: step.name,
          stepType: Object.keys(step).find((k) => k !== 'name'),
          availableExecutors: this.stepExecutors.map((e) => e.constructor.name)
        });
      }

      this.logger.debug('Selected executor:', {
        stepName: step.name,
        executor: executor.constructor.name,
      });

      const result = await executor.execute(step, this.executionContext, extraContext);
      return result;
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      this.logger.error(`Step execution failed: ${step.name}`, { error: errorMessage });
      
      // If it's already one of our FlowError types, just rethrow it
      if (error instanceof FlowError) {
        throw error;
      }
      
      // Otherwise, wrap it in a StepExecutionError with the step context
      throw new StepExecutionError(`Failed to execute step ${step.name}: ${errorMessage}`, {
        stepName: step.name,
        originalError: errorMessage
      });
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
