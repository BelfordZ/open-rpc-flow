import { ReferenceResolver } from './reference-resolver';
import { SafeExpressionEvaluator } from './expression-evaluator/safe-evaluator';
import { DependencyResolver } from './dependency-resolver';
import { Flow, Step, JsonRpcRequest, StepExecutionContext, JsonRpcHandler } from './types';
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
import { EnhancedTimeoutError } from './errors/timeout-error';
import { TimeoutError, ExecutionError } from './errors/base';
import { TimeoutResolver } from './util/timeout-resolver';

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
  /** Whether to enable retries */
  enableRetries?: boolean;
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
  private retryPolicy: RetryPolicy | null;
  private enableRetries: boolean;
  private timeoutResolver: TimeoutResolver;

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
    this.enableRetries = options?.enableRetries ?? false;

    // Initialize retry policy if enabled
    if (this.enableRetries) {
      // Priority: options.retryPolicy > flow.policies.global > flow.retryPolicy > DEFAULT_RETRY_POLICY
      if (options?.retryPolicy) {
        this.retryPolicy = options.retryPolicy;
      } else if (flow.policies?.global?.retryPolicy) {
        // Convert flow.policies.global.retryPolicy to RetryPolicy format
        this.retryPolicy = {
          maxAttempts: flow.policies.global.retryPolicy.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
          backoff: {
            initial: flow.policies.global.retryPolicy.backoff?.initial ?? DEFAULT_RETRY_POLICY.backoff.initial,
            multiplier: flow.policies.global.retryPolicy.backoff?.multiplier ?? DEFAULT_RETRY_POLICY.backoff.multiplier,
            maxDelay: flow.policies.global.retryPolicy.backoff?.maxDelay ?? DEFAULT_RETRY_POLICY.backoff.maxDelay,
            strategy: flow.policies.global.retryPolicy.backoff?.strategy ?? 'exponential',
          },
          // Cast string[] to ErrorCode[] since we're sure they're valid error codes
          retryableErrors: (flow.policies.global.retryPolicy.retryableErrors ?? DEFAULT_RETRY_POLICY.retryableErrors) as ErrorCode[],
        };
      } else if (flow.retryPolicy) {
        // Deprecated but still supported for backward compatibility
        // Convert flow.retryPolicy to RetryPolicy format
        this.retryPolicy = {
          maxAttempts: flow.retryPolicy.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
          backoff: {
            initial: flow.retryPolicy.backoff?.initial ?? DEFAULT_RETRY_POLICY.backoff.initial,
            multiplier: flow.retryPolicy.backoff?.multiplier ?? DEFAULT_RETRY_POLICY.backoff.multiplier,
            maxDelay: flow.retryPolicy.backoff?.maxDelay ?? DEFAULT_RETRY_POLICY.backoff.maxDelay,
            strategy: 'exponential', // Default for backward compatibility
          },
          // Cast string[] to ErrorCode[] since we're sure they're valid error codes
          retryableErrors: (flow.retryPolicy.retryableErrors ?? DEFAULT_RETRY_POLICY.retryableErrors) as ErrorCode[],
        };
      } else {
        this.retryPolicy = DEFAULT_RETRY_POLICY;
      }
    } else {
      this.retryPolicy = null;
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

    // Initialize step executors in order of specificity
    this.stepExecutors = [
      this.createRequestStepExecutor(),
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

    // Initialize TimeoutResolver for resolving timeouts
    this.timeoutResolver = new TimeoutResolver(this.flow, undefined, this.logger);
  }

  /**
   * Create a RequestStepExecutor with the current error handling configuration
   */
  private createRequestStepExecutor(): RequestStepExecutor {
    return new RequestStepExecutor(
      this.jsonRpcHandler,
      this.logger,
      this.enableRetries ? this.retryPolicy : null,
    );
  }

  /**
   * Update event emitter options
   */
  updateEventOptions(options: Partial<FlowEventOptions>): void {
    this.events.updateOptions(options);
  }

  /**
   * Update error handling options
   */
  updateErrorHandlingOptions(options: {
    retryPolicy?: RetryPolicy;
    enableRetries?: boolean;
  }): void {
    // Update enable flags if provided
    if (options.enableRetries !== undefined) {
      this.enableRetries = options.enableRetries;
    }

    // Update retry policy if provided
    if (options.retryPolicy) {
      this.retryPolicy = options.retryPolicy;
    }

    // Replace the request step executor with updated options
    const requestExecutorIndex = this.stepExecutors.findIndex(
      (executor) => executor instanceof RequestStepExecutor,
    );

    if (requestExecutorIndex >= 0) {
      this.stepExecutors[requestExecutorIndex] = this.createRequestStepExecutor();
    }

    this.logger.debug('Updated error handling options', {
      enableRetries: this.enableRetries,
      retryPolicy: this.retryPolicy,
    });
  }

  /**
   * Execute the flow and return all step results
   */
  async execute(options?: { signal?: AbortSignal }): Promise<Map<string, any>> {
    const startTime = Date.now();
    let globalTimeoutId: NodeJS.Timeout | undefined;
    const globalAbortController = new AbortController();
    try {
      // Set up global timeout if configured in the flow
      // Use TimeoutResolver to get the global timeout
      const globalTimeout = this.timeoutResolver.resolveGlobalTimeout();
      
      // Combine external signal with our timeout signal if provided
      if (options?.signal) {
        // Forward abort from external signal to our controller
        options.signal.addEventListener('abort', () => {
          globalAbortController.abort(options.signal?.reason);
        });
      }
      
      // Add abort signal to execution context
      this.executionContext.signal = globalAbortController.signal;
      
      if (globalTimeout && globalTimeout > 0) {
        this.logger.debug('Setting global flow timeout', { timeout: globalTimeout });
        globalTimeoutId = setTimeout(() => {
          this.logger.debug('Global flow timeout reached', { timeout: globalTimeout });
          globalAbortController.abort(new Error('Global flow timeout reached'));
        }, globalTimeout);
      }
      
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
          if (globalAbortController.signal.aborted) {
            const reason = globalAbortController.signal.reason || 'Flow execution aborted';
            this.logger.debug('Skipping step due to abort', { 
              stepName: step.name,
              reason: String(reason)
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
      if (globalAbortController.signal.aborted && 
          error.message?.includes('timeout') || 
          error.name === 'AbortError') {
        const duration = Date.now() - startTime;
        const flowTimeout = this.flow.timeouts?.global || 0;
        
        // Create a detailed timeout error for the flow
        const timeoutError = new EnhancedTimeoutError(
          `Flow execution timed out after ${duration}ms. Configured timeout: ${flowTimeout}ms.`,
          flowTimeout,
          duration
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

      // Do not wrap custom errors
      if (
        error instanceof EnhancedTimeoutError ||
        error instanceof TimeoutError ||
        error instanceof ExecutionError
      ) {
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
