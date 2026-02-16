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
import { randomUUID } from 'crypto';
import { RetryPolicy } from './errors/recovery';
import { ErrorCode } from './errors/codes';
import { TimeoutError } from './errors/timeout-error';
import { ExecutionError, PauseError, StateError, ValidationError } from './errors/base';
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
  private stepStatus: Map<string, { status: 'success' | 'failed'; error?: Error }>;
  private lastFailedStepName: string | null;
  private executionContext!: StepExecutionContext;
  private stepExecutors!: StepExecutor[];
  private logger: Logger;
  private retryPolicy: RetryPolicy | null;
  private policyResolver: PolicyResolver;
  private globalAbortController!: AbortController;
  private stepCorrelationIds!: Map<string, string>;
  private correlationPrefix!: string;
  private isPaused: boolean;

  constructor(
    private flow: Flow,
    private jsonRpcHandler: JsonRpcHandler,
    loggerOrOptions?: Logger | FlowExecutorOptions,
  ) {
    // Handle both new options object and legacy logger parameter
    let options: FlowExecutorOptions | undefined;

    if (loggerOrOptions && typeof (loggerOrOptions as Logger).info === 'function') {
      // It's a logger instance
      this.logger = loggerOrOptions as Logger;
      options = { logger: this.logger };
    } else {
      // It's an options object (or undefined)
      options = loggerOrOptions as FlowExecutorOptions;
      this.logger = options?.logger || defaultLogger;
    }

    this.context = flow.context || {};
    this.stepResults = new Map();
    this.stepStatus = new Map();
    this.lastFailedStepName = null;
    this.isPaused = false;

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

    // Initialize PolicyResolver for policy-based execution
    const policyOverrides: PolicyOverrides = {};
    if (options?.retryPolicy) {
      policyOverrides.retryPolicy = options.retryPolicy;
    }
    this.policyResolver = new PolicyResolver(this.flow, this.logger, policyOverrides);

    // Initialize runtime state
    this.initializeRunState({ clearResults: false, clearStatus: false });
  }

  /**
   * Create a RequestStepExecutor with the current error handling configuration
   */
  private createRequestStepExecutor(): RequestStepExecutor {
    return new RequestStepExecutor(
      this.jsonRpcHandler,
      this.logger,
      this.policyResolver,
      this.events,
    );
  }

  /**
   * Update event emitter options
   */
  updateEventOptions(options: Partial<FlowEventOptions>): void {
    this.events.updateOptions(options);
  }

  /**
   * Reset run state and rebuild execution context
   */
  private initializeRunState(options: { clearResults: boolean; clearStatus: boolean }): void {
    this.isPaused = false;
    this.globalAbortController = new AbortController();
    this.stepCorrelationIds = new Map();
    this.correlationPrefix = randomUUID();

    if (options.clearResults) {
      this.stepResults.clear();
    }
    if (options.clearStatus) {
      this.stepStatus.clear();
      this.lastFailedStepName = null;
    }

    this.rebuildExecutionContext();
    this.rebuildStepExecutors();
  }

  private rebuildExecutionContext(): void {
    this.referenceResolver = new ReferenceResolver(this.stepResults, this.context, this.logger);
    this.expressionEvaluator = new SafeExpressionEvaluator(this.logger, this.referenceResolver);
    this.dependencyResolver = new DependencyResolver(this.flow, this.expressionEvaluator, this.logger);
    this.executionContext = {
      referenceResolver: this.referenceResolver,
      expressionEvaluator: this.expressionEvaluator,
      stepResults: this.stepResults,
      context: this.context,
      logger: this.logger,
      signal: this.globalAbortController.signal,
      flow: this.flow,
    };
  }

  private rebuildStepExecutors(): void {
    this.stepExecutors = [
      this.createRequestStepExecutor(),
      new LoopStepExecutor(
        this.executeStep.bind(this),
        this.logger,
        (step, iteration, totalIterations) =>
          this.events.emitStepProgress(step, iteration, totalIterations),
      ),
      new ConditionStepExecutor(this.executeStep.bind(this), this.logger, this.policyResolver),
      new TransformStepExecutor(
        this.expressionEvaluator,
        this.referenceResolver,
        this.context,
        this.logger,
        this.policyResolver,
      ),
      new StopStepExecutor(this.logger, this.globalAbortController),
    ];
  }

  /**
   * Replace the execution context for future runs
   */
  setContext(context: ExecutionContextData): void {
    if (!context || typeof context !== 'object' || Array.isArray(context)) {
      throw new ValidationError('Context must be a non-null object', {
        contextType: typeof context,
      });
    }
    this.context = context;
    this.rebuildExecutionContext();
    this.rebuildStepExecutors();
  }

  /**
   * Replace all step results for future runs
   */
  setStepResults(results: Map<string, unknown> | Record<string, unknown>): void {
    const normalizedResults =
      results instanceof Map ? results : new Map(Object.entries(results || {}));
    const validStepNames = new Set(this.flow.steps.map((step) => step.name));

    for (const stepName of normalizedResults.keys()) {
      if (!validStepNames.has(stepName)) {
        throw new ValidationError('Unknown step name in step results', { stepName });
      }
    }

    this.stepResults.clear();
    this.stepStatus.clear();
    for (const [stepName, value] of normalizedResults.entries()) {
      this.stepResults.set(stepName, value);
      this.stepStatus.set(stepName, { status: 'success' });
    }
    this.lastFailedStepName = null;
    this.rebuildExecutionContext();
    this.rebuildStepExecutors();
  }

  /**
   * Pause the currently running flow
   */
  pause(): void {
    if (this.globalAbortController.signal.aborted) {
      return;
    }
    this.isPaused = true;
    this.globalAbortController.abort('paused');
  }

  /**
   * Resume execution after the last completed step
   */
  async resume(options?: { signal?: AbortSignal }): Promise<Map<string, any>> {
    this.initializeRunState({ clearResults: false, clearStatus: false });
    const orderedSteps = this.dependencyResolver.getExecutionOrder();
    this.ensureStatusFromResults(orderedSteps);
    const lastSuccessIndex = this.findLastStatusIndex(orderedSteps, 'success');
    const startIndex = lastSuccessIndex + 1;
    return this.runFromIndex(startIndex, options);
  }

  /**
   * Retry execution starting from the last failed step
   */
  async retry(options?: { signal?: AbortSignal }): Promise<Map<string, any>> {
    this.initializeRunState({ clearResults: false, clearStatus: false });
    const orderedSteps = this.dependencyResolver.getExecutionOrder();
    this.ensureStatusFromResults(orderedSteps);

    const lastFailedStep =
      this.lastFailedStepName ||
      orderedSteps
        .slice()
        .reverse()
        .find((step) => this.stepStatus.get(step.name)?.status === 'failed')?.name ||
      null;

    if (!lastFailedStep) {
      throw new StateError('No failed step to retry', { flowName: this.flow.name });
    }

    const failedIndex = orderedSteps.findIndex((step) => step.name === lastFailedStep);
    if (failedIndex === -1) {
      throw new StateError('Failed step not found in flow', {
        stepName: lastFailedStep,
        flowName: this.flow.name,
      });
    }

    this.clearResultsFromIndex(orderedSteps, failedIndex);
    return this.runFromIndex(failedIndex, options);
  }

  private ensureStatusFromResults(orderedSteps: Step[]): void {
    for (const step of orderedSteps) {
      if (this.stepResults.has(step.name) && !this.stepStatus.has(step.name)) {
        this.stepStatus.set(step.name, { status: 'success' });
      }
    }
  }

  private findLastStatusIndex(
    orderedSteps: Step[],
    status: 'success' | 'failed',
  ): number {
    let lastIndex = -1;
    for (let i = 0; i < orderedSteps.length; i++) {
      const stepStatus = this.stepStatus.get(orderedSteps[i].name);
      if (stepStatus?.status === status) {
        lastIndex = i;
      }
    }
    return lastIndex;
  }

  private clearResultsFromIndex(orderedSteps: Step[], startIndex: number): void {
    for (let i = startIndex; i < orderedSteps.length; i++) {
      const stepName = orderedSteps[i].name;
      this.stepResults.delete(stepName);
      this.stepStatus.delete(stepName);
      if (this.lastFailedStepName === stepName) {
        this.lastFailedStepName = null;
      }
    }
  }

  private async runFromIndex(
    startIndex: number,
    options?: { signal?: AbortSignal },
  ): Promise<Map<string, any>> {
    const safeStartIndex = Math.max(0, startIndex);
    this.logger.info('Executing flow with options:', options);
    const startTime = Date.now();
    let globalTimeoutId: NodeJS.Timeout | undefined;
    let flowAbortEmitted = false;
    try {
      const flowTimeout = this.flow.policies?.global?.timeout?.timeout;
      if (typeof flowTimeout === 'number' && flowTimeout > 0) {
        globalTimeoutId = setTimeout(() => {
          if (!this.globalAbortController.signal.aborted) {
            this.globalAbortController.abort('timeout');
          }
        }, flowTimeout);
      }
      if (options?.signal) {
        if (options.signal.aborted) {
          this.globalAbortController.abort(options.signal.reason ?? 'aborted');
        } else {
          options.signal.addEventListener('abort', () => {
            this.globalAbortController.abort(options.signal?.reason ?? 'aborted');
          });
        }
      }

      const orderedSteps = this.dependencyResolver.getExecutionOrder();
      const orderedStepNames = orderedSteps.map((s) => s.name);

      this.events.emitDependencyResolved(orderedStepNames);
      this.events.emitFlowStart(this.flow.name, orderedStepNames);

      this.logger.info('Executing steps in order:', orderedStepNames);

      for (let index = safeStartIndex; index < orderedSteps.length; index++) {
        const step = orderedSteps[index];
        const stepStartTime = Date.now();

        const correlationId = this.generateCorrelationId(step.name);
        this.stepCorrelationIds.set(step.name, correlationId);
        try {
          if (this.globalAbortController.signal.aborted) {
            const reason = this.globalAbortController.signal.reason || 'Flow execution aborted';
            const isPause = this.isPaused || reason === 'paused';
            this.logger.debug('Skipping step due to abort', {
              stepName: step.name,
              reason: String(reason),
            });
            this.events.emitStepAborted(step, String(reason));
            this.events.emitStepSkip(step, String(reason), correlationId);
            if (!flowAbortEmitted) {
              this.events.emitFlowAborted(this.flow.name, String(reason));
              flowAbortEmitted = true;
            }
            if (isPause) {
              throw new PauseError('Flow execution paused', {
                flowName: this.flow.name,
                stepName: step.name,
              });
            }
            throw new Error(String(reason));
          }

          const stepContext = { metadata: { ...(step.metadata || {}) } };

          this.events.emitStepStart(
            step,
            this.executionContext,
            stepContext,
            correlationId,
            step.metadata || {},
          );

          const result = await this.executeStep(
            step,
            stepContext,
            this.globalAbortController.signal,
          );
          this.stepResults.set(step.name, result);
          this.stepStatus.set(step.name, { status: 'success' });
          if (this.lastFailedStepName === step.name) {
            this.lastFailedStepName = null;
          }

          this.events.emitStepComplete(step, result, stepStartTime, correlationId);

          const shouldStop = this.checkForStopResult(result);

          if (shouldStop) {
            this.logger.info('Workflow stopped by step:', step.name);
            if (!flowAbortEmitted) {
              this.events.emitFlowAborted(this.flow.name, 'Stopped by stop step');
              flowAbortEmitted = true;
            }
            this.events.emitStepSkip(step, 'Workflow stopped by previous step', correlationId);
            break;
          }
        } catch (error: any) {
          const reason = this.globalAbortController.signal.reason;
          const isPause = this.isPaused || reason === 'paused';
          if (this.globalAbortController.signal.aborted && isPause) {
            this.events.emitStepAborted(step, String(reason));
            if (!flowAbortEmitted) {
              this.events.emitFlowAborted(this.flow.name, String(reason));
              flowAbortEmitted = true;
            }
            throw new PauseError('Flow execution paused', {
              flowName: this.flow.name,
              stepName: step.name,
            });
          }

          this.stepStatus.set(step.name, {
            status: 'failed',
            error: error instanceof Error ? error : undefined,
          });
          this.lastFailedStepName = step.name;

          if (error instanceof TimeoutError) {
            this.events.emitStepTimeout(step, error.timeout, error.executionTime);
          }
          this.events.emitStepError(step, error, stepStartTime, correlationId);
          throw error;
        }
      }

      this.events.emitFlowComplete(this.flow.name, this.stepResults, startTime);
      return this.stepResults;
    } catch (error: any) {
      if (error instanceof PauseError) {
        throw error;
      }
      if (this.globalAbortController.signal.aborted && !flowAbortEmitted) {
        const reason = this.globalAbortController.signal.reason || 'Flow execution aborted';
        this.events.emitFlowAborted(this.flow.name, String(reason));
        flowAbortEmitted = true;
      }
      const reason = this.globalAbortController.signal.reason;
      const isPause = this.isPaused || reason === 'paused';
      if (
        !isPause &&
        ((this.globalAbortController.signal.aborted && reason === 'timeout') ||
          error.name === 'AbortError')
      ) {
        const duration = Date.now() - startTime;
        const flowTimeout = this.flow.policies?.global?.timeout?.timeout || 0;
        const timeoutError = new TimeoutError(
          `Flow execution timed out after ${duration}ms. Configured timeout: ${flowTimeout}ms.`,
          flowTimeout,
          duration,
        );

        this.events.emitFlowTimeout(this.flow.name, flowTimeout, duration);
        this.events.emitFlowError(this.flow.name, timeoutError, startTime);
        throw timeoutError;
      }

      this.events.emitFlowError(this.flow.name, error, startTime);
      throw error;
    } finally {
      if (globalTimeoutId) {
        clearTimeout(globalTimeoutId);
      }
    }
  }

  /**
   * Execute the flow and return all step results
   */
  async execute(options?: { signal?: AbortSignal }): Promise<Map<string, any>> {
    const priorAbortReason = this.globalAbortController?.signal.aborted
      ? this.globalAbortController.signal.reason
      : null;
    this.initializeRunState({ clearResults: true, clearStatus: true });
    if (priorAbortReason !== null && priorAbortReason !== undefined) {
      this.globalAbortController.abort(priorAbortReason);
    }
    return this.runFromIndex(0, options);
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

    const correlationId =
      this.stepCorrelationIds.get(step.name) || this.generateCorrelationId(step.name);
    this.stepCorrelationIds.set(step.name, correlationId);

    const contextWithMeta = {
      ...extraContext,
      metadata: {
        ...(extraContext.metadata || {}),
        ...(step.metadata || {}),
      },
    };
    const isNested = Boolean(extraContext._nestedStep);

    try {
      this.logger.debug('Executing step:', {
        stepName: step.name,
        stepType: Object.keys(step).find((k) => k !== 'name'),
        availableExecutors: this.stepExecutors.map((e) => e.constructor.name),
      });

      // Only emit step events for nested steps
      if (isNested) {
        this.events.emitStepStart(
          step,
          this.executionContext,
          contextWithMeta,
          correlationId,
          step.metadata || {},
        );
      }

      const executor = this.findExecutor(step);
      if (!executor) {
        throw new Error(`No executor found for step ${step.name}`);
      }

      this.logger.debug('Selected executor:', {
        stepName: step.name,
        executor: executor.constructor.name,
      });

      const result = await executor.execute(step, this.executionContext, contextWithMeta, signal);

      // Only emit step complete for nested steps
      if (isNested) {
        this.events.emitStepComplete(step, result, stepStartTime, correlationId);
      }

      return result;
    } catch (error: any) {
      const errorMessage = error.message || String(error);
      this.logger.error(`Step execution failed: ${step.name}`, { error: errorMessage });

      // Only emit step error for nested steps
      if (isNested) {
        if (error instanceof TimeoutError) {
          this.events.emitStepTimeout(step, error.timeout, error.executionTime);
        }
        this.events.emitStepError(step, error, stepStartTime, correlationId);
      }

      if (
        error?.name === 'AbortError' ||
        (typeof error.message === 'string' && error.message.includes('aborted'))
      ) {
        this.events.emitStepAborted(step, error.message || 'aborted');
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

  private generateCorrelationId(stepName: string): string {
    return `${this.correlationPrefix}-${stepName}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
