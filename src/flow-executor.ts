import { ReferenceResolver } from './reference-resolver';
import { SafeExpressionEvaluator } from './expression-evaluator/safe-evaluator';
import { DependencyResolver } from './dependency-resolver';
import {
  Flow,
  Step,
  StepExecutionContext,
  JsonRpcHandler,
  ExecutionContextData,
  PolicyOverrides,
} from './types';
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
import { RetryPolicy } from './errors/recovery';
import { ErrorCode } from './errors/codes';
import { TimeoutError } from './errors/timeout-error';
import { ExecutionError } from './errors/base';
import { PolicyResolver } from './util/policy-resolver';

/**
 * Default retry policy
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  backoff: {
    initial: 100,
    multiplier: 2,
    maxDelay: 5000,
    strategy: 'exponential',
  },
  retryableErrors: [ErrorCode.NETWORK_ERROR, ErrorCode.TIMEOUT_ERROR, ErrorCode.OPERATION_TIMEOUT],
};

/**
 * Options for the FlowExecutor
 */
export interface FlowExecutorOptions {
  /** Logger instance to use */
  logger?: Logger;
  /** Event emitter options */
  eventOptions?: Partial<FlowEventOptions>;
  /** Retry policy for request steps */
  retryPolicy?: RetryPolicy;
}

/**
 * Main executor for JSON-RPC flows
 */
export class FlowExecutor {
  public dependencyResolver: DependencyResolver;
  public referenceResolver: ReferenceResolver;
  public expressionEvaluator: SafeExpressionEvaluator;
  public events: FlowExecutorEvents;

  private context: ExecutionContextData;
  private stepResults: Map<string, unknown>;
  private executionContext: StepExecutionContext;
  private stepExecutors: StepExecutor[];
  private logger: Logger;
  private retryPolicy: RetryPolicy | null;
  private policyResolver: PolicyResolver;
  private globalAbortController: AbortController;

  constructor(
    private flow: Flow,
    private jsonRpcHandler: JsonRpcHandler,
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

    // Initialize error handling options
    if (options?.retryPolicy) {
      this.retryPolicy = options.retryPolicy;
    } else if (flow.policies?.global?.retryPolicy) {
      this.retryPolicy = {
        maxAttempts: flow.policies.global.retryPolicy.maxAttempts ?? 1,
        backoff: {
          initial:
            flow.policies.global.retryPolicy.backoff?.initial ??
            DEFAULT_RETRY_POLICY.backoff.initial,
          multiplier:
            flow.policies.global.retryPolicy.backoff?.multiplier ??
            DEFAULT_RETRY_POLICY.backoff.multiplier,
          maxDelay:
            flow.policies.global.retryPolicy.backoff?.maxDelay ??
            DEFAULT_RETRY_POLICY.backoff.maxDelay,
          strategy: flow.policies.global.retryPolicy.backoff?.strategy ?? 'exponential',
        },
        retryableErrors: (flow.policies.global.retryPolicy.retryableErrors ??
          DEFAULT_RETRY_POLICY.retryableErrors) as ErrorCode[],
      };
    } else {
      this.retryPolicy = {
        ...DEFAULT_RETRY_POLICY,
        maxAttempts: 1,
      };
    }

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
      flow: this.flow,
    };

    // Initialize PolicyResolver for policy-based execution
    const policyOverrides: PolicyOverrides = {};
    if (options?.retryPolicy) {
      policyOverrides.retryPolicy = options.retryPolicy;
    }
    this.policyResolver = new PolicyResolver(this.flow, this.logger, policyOverrides);

    // Initialize global abort controller
    const globalAbortController = new AbortController();

    // Initialize step executors in order of specificity
    this.stepExecutors = [
      this.createRequestStepExecutor(),
      new LoopStepExecutor(this.executeStep.bind(this), this.logger),
      new ConditionStepExecutor(this.executeStep.bind(this), this.logger, this.policyResolver),
      new TransformStepExecutor(
        this.expressionEvaluator,
        this.referenceResolver,
        this.context,
        this.logger,
        this.policyResolver,
      ),
      new StopStepExecutor(this.logger, globalAbortController),
    ];
    this.globalAbortController = globalAbortController;
  }

  /**
   * Create a RequestStepExecutor with the current error handling configuration
   */
  private createRequestStepExecutor(): RequestStepExecutor {
    return new RequestStepExecutor(this.jsonRpcHandler, this.logger, this.policyResolver);
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
  async execute(options?: { signal?: AbortSignal }): Promise<Map<string, any>> {
    this.logger.log('Executing flow with options:', options);
    const startTime = Date.now();
    let globalTimeoutId: NodeJS.Timeout | undefined;
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
          // Check if we've been aborted before executing step
          if (this.globalAbortController.signal.aborted) {
            const reason = this.globalAbortController.signal.reason || 'Flow execution aborted';
            this.logger.debug('Skipping step due to abort', {
              stepName: step.name,
              reason: String(reason),
            });
            this.events.emitStepSkip(step, String(reason));
            throw new Error(String(reason));
          }

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
      // Enhance error with flow context if it's an abort due to timeout
      if (
        (this.globalAbortController.signal.aborted && error.message?.includes('timeout')) ||
        error.name === 'AbortError'
      ) {
        const duration = Date.now() - startTime;
        const flowTimeout = this.flow.policies?.global?.timeout?.timeout || 0;

        // Create a detailed timeout error for the flow
        const timeoutError = new TimeoutError(
          `Flow execution timed out after ${duration}ms. Configured timeout: ${flowTimeout}ms.`,
          flowTimeout,
          duration,
        );

        this.events.emitFlowError(this.flow.name, timeoutError, startTime);
        throw timeoutError;
      }

      this.events.emitFlowError(this.flow.name, error, startTime);
      throw error;
    } finally {
      // Clean up timeout if it was set
      if (globalTimeoutId) {
        clearTimeout(globalTimeoutId);
      }
    }
  }

  /**
   * Execute a single step using the appropriate executor
   */
  private async executeStep(
    step: Step,
    extraContext: ExecutionContextData = {},
    signal?: AbortSignal,
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

      const result = await executor.execute(step, this.executionContext, extraContext, signal);

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

      // Do not wrap custom errors
      if (error instanceof TimeoutError || error instanceof ExecutionError) {
        throw error;
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
