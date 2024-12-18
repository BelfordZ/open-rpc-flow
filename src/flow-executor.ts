import { ReferenceResolver } from './reference-resolver';
import { ExpressionEvaluator } from './expression-evaluator';
import { TransformExecutor } from './transform-executor';
import { DependencyResolver } from './dependency-resolver';
import { Flow, Step, JsonRpcRequest } from './types';
import {
  StepExecutor,
  StepExecutionContext,
  StepExecutionResult,
  RequestStepExecutor,
  LoopStepExecutor,
  ConditionStepExecutor,
  TransformStepExecutor
} from './step-executors';

/**
 * Main executor for JSON-RPC flows
 */
export class FlowExecutor {
  private context: Record<string, any>;
  private stepResults: Map<string, any>;
  private executionContext: StepExecutionContext;
  private stepExecutors: StepExecutor[];
  private dependencyResolver: DependencyResolver;

  constructor(
    private flow: Flow,
    private jsonRpcHandler: (request: JsonRpcRequest) => Promise<any>
  ) {
    this.context = flow.context || {};
    this.stepResults = new Map();
    this.dependencyResolver = new DependencyResolver(flow);

    // Initialize shared execution context
    const referenceResolver = new ReferenceResolver(this.stepResults, this.context);
    const expressionEvaluator = new ExpressionEvaluator(referenceResolver, this.context);
    const transformExecutor = new TransformExecutor(expressionEvaluator, referenceResolver, this.context);

    this.executionContext = {
      referenceResolver,
      expressionEvaluator,
      transformExecutor,
      stepResults: this.stepResults,
      context: this.context
    };

    // Initialize step executors in order of specificity
    this.stepExecutors = [
      new RequestStepExecutor(jsonRpcHandler),
      new LoopStepExecutor(this.executeStep.bind(this)),
      new ConditionStepExecutor(this.executeStep.bind(this)),
      new TransformStepExecutor(transformExecutor)
    ];
  }

  /**
   * Execute the flow and return all step results
   */
  async execute(): Promise<Map<string, any>> {
    // Get steps in dependency order
    const orderedSteps = this.dependencyResolver.getExecutionOrder();
    console.log('Executing steps in order:', orderedSteps.map(s => s.name));

    for (const step of orderedSteps) {
      const result = await this.executeStep(step);
      this.stepResults.set(step.name, result.result);
    }
    return this.stepResults;
  }

  /**
   * Execute a single step using the appropriate executor
   */
  private async executeStep(
    step: Step,
    extraContext: Record<string, any> = {}
  ): Promise<StepExecutionResult> {
    try {
      console.log('Executing step:', {
        stepName: step.name,
        stepType: Object.keys(step).find(k => k !== 'name'),
        availableExecutors: this.stepExecutors.map(e => e.constructor.name)
      });

      const executor = this.findExecutor(step);
      if (!executor) {
        throw new Error(`No executor found for step ${step.name}`);
      }

      console.log('Selected executor:', {
        stepName: step.name,
        executor: executor.constructor.name
      });

      return await executor.execute(step, this.executionContext, extraContext);
    } catch (error: any) {
      throw new Error(
        `Failed to execute step ${step.name}: ${error.message || String(error)}`
      );
    }
  }

  /**
   * Find the appropriate executor for a step
   */
  private findExecutor(step: Step): StepExecutor | undefined {
    // Try each executor in order of registration (most specific first)
    for (const executor of this.stepExecutors) {
      const canExecute = executor.canExecute(step);
      console.log('Checking executor:', {
        executor: executor.constructor.name,
        canExecute
      });
      if (canExecute) {
        return executor;
      }
    }
    return undefined;
  }
} 