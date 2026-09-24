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
  DelayStepExecutor,
} from './step-executors';
import { Logger, defaultLogger } from './util/logger';
import { FlowExecutorEvents, FlowEventOptions } from './util/flow-executor-events';
import { OpenRpcDocument, validateFlow } from './flow-doctor';
import { randomUUID } from 'crypto';
import { RetryPolicy } from './errors/recovery';
import { ErrorCode } from './errors/codes';
import { TimeoutError } from './errors/timeout-error';
import {
  ExecutionError,
  FlowError,
  PauseError,
  ResetError,
  StateError,
  ValidationError,
} from './errors/base';
import { JsonRpcRequestError } from './step-executors/types';
import { PolicyResolver } from './util/policy-resolver';
import {
  assertJsonSerializable,
  CHECKPOINT_VERSION,
  CheckpointStepStatus,
  FlowCheckpoint,
  hashStep,
  validateCheckpoint,
} from './checkpoint';

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
  /**
   * OpenRPC document for opt-in upfront semantic validation (Flow Doctor).
   * When `validateUpfront` is true, the flow is validated against this
   * document in the constructor and a `ValidationError` is thrown if any
   * error-severity diagnostics are found.
   */
  openrpcDocument?: OpenRpcDocument;
  /**
   * Validate the flow against `openrpcDocument` before execution.
   * Requires `openrpcDocument` to be set.
   */
  validateUpfront?: boolean;
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
  /**
   * Epoch bumped every time run state is reinitialized. Steps capture the
   * epoch of the run that started them; a step from an older epoch must never
   * write results/status into newer state (see reset()).
   */
  private runEpoch = 0;
  private stepCorrelationIds!: Map<string, string>;
  private correlationPrefix!: string;
  private isPaused: boolean;

  /**
   * Set by importState(). The next run entry point (execute/resume/retry/
   * resumeFrom) must preserve the imported state instead of starting fresh.
   * Consumed (cleared) by initializeRunState().
   */
  private pendingImportedState = false;

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

    // Opt-in upfront semantic validation (Flow Doctor, issue #151): fail
    // fast with every diagnostic instead of failing mid-run at step 7 of 10.
    if (options?.validateUpfront) {
      if (!options.openrpcDocument) {
        throw new ValidationError('validateUpfront requires openrpcDocument to be set', {
          flowName: flow.name,
        });
      }
      const diagnostics = validateFlow(flow, options.openrpcDocument);
      const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
      if (errors.length > 0) {
        const summary = errors
          .map((diagnostic) => `[${diagnostic.step}] ${diagnostic.message}`)
          .join('; ');
        throw new ValidationError(
          `Flow '${flow.name}' failed upfront validation with ${errors.length} error(s): ${summary}`,
          { flowName: flow.name, diagnostics },
        );
      }
    }

    this.context = Object.freeze({ ...(flow.context || {}) });
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
    // An imported checkpoint is honored by exactly one run entry point: once
    // any of execute()/resume()/retry()/resumeFrom() starts, the flag is
    // consumed so a later execute() goes back to fresh-run semantics.
    this.pendingImportedState = false;
    this.globalAbortController = new AbortController();
    // Bump the epoch so in-flight steps from a superseded run can detect that
    // their state was cleared and must not write into the fresh state.
    this.runEpoch++;
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
      new DelayStepExecutor(this.executeStep.bind(this), this.logger),
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
    this.context = Object.freeze({ ...context });
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
   * Export a durable checkpoint of the executor's current progress.
   *
   * The checkpoint is versioned, deeply isolated from executor internals,
   * and JSON-normalized: it deep-equals `JSON.parse(JSON.stringify(snapshot))`,
   * so persisting it as JSON and reading it back loses nothing.
   *
   * Serialization discipline: step results and context must be
   * JSON-serializable. Values that `JSON.stringify` silently corrupts
   * (functions, symbols, BigInts, Maps, Sets, Promises, binary buffers,
   * circular references) make `exportState()` throw a `CheckpointError`
   * (`CHECKPOINT_NOT_SERIALIZABLE`) naming the offending path — fail fast
   * here instead of persisting a checkpoint that imports as something
   * different. `undefined` is dropped from objects (`null` in arrays),
   * `Date`s become ISO strings, and class instances lose their prototype;
   * convert such values to plain data before exporting if that matters.
   *
   * @returns a {@link FlowCheckpoint} safe to persist with `JSON.stringify`.
   */
  exportState(): FlowCheckpoint {
    const stepStatus: Record<string, CheckpointStepStatus> = {};
    for (const [stepName, status] of this.stepStatus) {
      stepStatus[stepName] = {
        status: status.status,
        // Errors are stored as plain data, never Error instances. `stack`
        // may be undefined; the JSON normalization below drops it.
        ...(status.error !== undefined
          ? { error: { message: status.error.message, stack: status.error.stack } }
          : {}),
      };
    }
    const raw: FlowCheckpoint = {
      version: CHECKPOINT_VERSION,
      flowName: this.flow.name,
      stepHashes: Object.fromEntries(this.flow.steps.map((step) => [step.name, hashStep(step)])),
      exportedAt: new Date().toISOString(),
      context: this.context as Record<string, unknown>,
      stepResults: Object.fromEntries(this.stepResults),
      stepStatus,
      lastFailedStepName: this.lastFailedStepName,
    };
    assertJsonSerializable(raw);
    // JSON-normalize: the returned snapshot is deeply isolated from executor
    // internals and is exactly what a JSON persist/restore round trip yields.
    return JSON.parse(JSON.stringify(raw)) as FlowCheckpoint;
  }

  /**
   * Import a checkpoint previously produced by {@link exportState} (or its
   * JSON round-tripped form: a plain object, or a JSON string).
   *
   * The imported state is deep-cloned into the executor, so later mutations
   * of the caller's object cannot affect the run. The next `execute()` call
   * becomes a resume: steps with recorded successes are skipped, the failed
   * step (if any) is re-run, and steps that never ran execute normally.
   *
   * Flow edits are reconciled per step instead of rejected (the "run, fix,
   * re-run" loop): the checkpoint records a digest of each step definition,
   * and on import each recorded step is compared against this executor's
   * flow —
   * - unchanged steps keep their recorded results and stay skipped;
   * - steps added after export have no recorded progress and run normally;
   * - a recorded step whose definition changed is treated as fixed: its
   *   recorded results are discarded so it re-runs, and its transitive
   *   dependents are discarded too (they consumed the old definition's
   *   output);
   * - a recorded step that no longer exists is dropped with a warning.
   *
   * Compatibility checks (all failures throw instead of silently misbehaving):
   * - the checkpoint must be well-formed (`ValidationError` otherwise);
   * - its `version` must match (`CheckpointError` with
   *   `CHECKPOINT_VERSION_MISMATCH` otherwise).
   *
   * Idempotency warning: resuming re-runs the failed step and every step
   * that never completed. Steps that already succeeded are never re-run.
   * Make sure re-executed steps are safe to run again.
   *
   * A checkpoint exported while paused imports unpaused: the new executor
   * simply continues from the recorded progress.
   */
  importState(snapshot: unknown): void {
    let candidate: unknown = snapshot;
    if (typeof candidate === 'string') {
      try {
        candidate = JSON.parse(candidate);
      } catch {
        throw new ValidationError('Invalid checkpoint: string is not valid JSON', {
          actualType: 'string',
        });
      }
    }
    const checkpoint = validateCheckpoint(candidate);

    if (checkpoint.flowName !== this.flow.name) {
      this.logger.warn(
        `Checkpoint flow name '${checkpoint.flowName}' differs from flow '${this.flow.name}'. ` +
          `Step definitions are compared per step, so importing anyway.`,
      );
    }

    // The checkpoint is JSON-shaped by construction, but a hand-built object
    // could smuggle in functions or Maps; enforce serializability symmetrically.
    assertJsonSerializable(checkpoint);
    // Deep-clone through JSON: the executor must not alias the caller's object.
    const isolated = JSON.parse(JSON.stringify(checkpoint)) as FlowCheckpoint;

    this.context = Object.freeze({ ...isolated.context });
    this.stepResults.clear();
    for (const [stepName, result] of Object.entries(isolated.stepResults)) {
      this.stepResults.set(stepName, result);
    }
    this.stepStatus.clear();
    for (const [stepName, status] of Object.entries(isolated.stepStatus)) {
      this.stepStatus.set(stepName, {
        status: status.status,
        ...(status.error !== undefined ? { error: rehydrateCheckpointError(status.error) } : {}),
      });
    }
    // Reconcile the imported progress against this executor's (possibly
    // edited) flow before anything below treats a status entry as current.
    this.reconcileImportedSteps(isolated.stepHashes);
    // Defensive: a result without a status entry counts as a success, mirroring
    // the completed-step detection in runFromIndex().
    for (const stepName of this.stepResults.keys()) {
      if (!this.stepStatus.has(stepName)) {
        this.stepStatus.set(stepName, { status: 'success' });
      }
    }
    this.lastFailedStepName = isolated.lastFailedStepName;
    // Self-heal a semantic inconsistency that only hand-built checkpoints can
    // have: lastFailedStepName must name a step whose status is 'failed'.
    // Otherwise retry() would re-run (and clear downstream of) a step that
    // actually succeeded.
    if (
      this.lastFailedStepName !== null &&
      this.stepStatus.get(this.lastFailedStepName)?.status !== 'failed'
    ) {
      this.lastFailedStepName = null;
    }
    // Arm the next execute() to resume from this state instead of clearing it.
    this.pendingImportedState = true;
    this.rebuildExecutionContext();
    this.rebuildStepExecutors();
  }

  /**
   * Reconcile imported step progress against this executor's flow, which may
   * have been edited since the checkpoint was exported. Recorded results for
   * steps whose definition changed (or that no longer exist) are discarded
   * so those steps re-run, along with their transitive dependents — the rest
   * of the recorded progress is kept untouched.
   *
   * @param checkpointHashes per-step digests recorded in the checkpoint.
   */
  private reconcileImportedSteps(checkpointHashes: Record<string, string>): void {
    const currentHashes = new Map<string, string>();
    for (const step of this.flow.steps) {
      currentHashes.set(step.name, hashStep(step));
    }

    // Direct dependents per step, from the current flow's dependency graph.
    const dependentsByStep = new Map<string, Set<string>>();
    for (const node of this.dependencyResolver.getDependencyGraph().nodes) {
      dependentsByStep.set(node.name, new Set(node.dependents));
    }
    const transitiveDependents = (root: string): Set<string> => {
      const seen = new Set<string>();
      const queue = [...(dependentsByStep.get(root) ?? [])];
      while (queue.length > 0) {
        const name = queue.shift() as string;
        if (seen.has(name)) {
          continue;
        }
        seen.add(name);
        queue.push(...(dependentsByStep.get(name) ?? []));
      }
      return seen;
    };

    const invalidated = new Set<string>();
    const drop = (stepName: string): void => {
      if (invalidated.has(stepName)) {
        return;
      }
      invalidated.add(stepName);
      this.stepResults.delete(stepName);
      this.stepStatus.delete(stepName);
    };

    const removed: string[] = [];
    const changed: string[] = [];
    for (const [stepName, recordedHash] of Object.entries(checkpointHashes)) {
      const currentHash = currentHashes.get(stepName);
      if (currentHash === undefined) {
        removed.push(stepName);
        drop(stepName);
      } else if (currentHash !== recordedHash) {
        changed.push(stepName);
        drop(stepName);
        for (const dependent of transitiveDependents(stepName)) {
          drop(dependent);
        }
      }
    }

    if (removed.length > 0) {
      this.logger.warn(
        `Checkpoint reconciliation: dropped recorded progress for removed step(s) ` +
          `${removed.join(', ')}; they will not be skipped on resume.`,
      );
    }
    if (changed.length > 0) {
      const rerun = [...invalidated].filter((name) => !removed.includes(name));
      this.logger.info(
        `Checkpoint reconciliation: step definition(s) changed for ${changed.join(', ')}; ` +
          `discarded their recorded progress so they re-run, along with dependent step(s) ` +
          `${rerun.filter((name) => !changed.includes(name)).join(', ') || '(none)'}.`,
      );
    }
  }

  /**
   * Reset executor state: cancel any in-flight run and reinitialize context,
   * results, and status so the executor is ready for a fresh execution.
   *
   * The in-flight run (if any) fails distinctly with ResetError. Reinitializing
   * the run state bumps the run epoch, so steps from the superseded run detect
   * the reset and never write into the fresh state.
   */
  reset(): void {
    if (!this.globalAbortController.signal.aborted) {
      this.globalAbortController.abort('reset');
    }

    // Restore the flow's declared initial context (frozen, per immutable
    // context); initializeRunState rebuilds the resolvers against it below.
    this.context = Object.freeze({ ...(this.flow.context || {}) });
    this.initializeRunState({ clearResults: true, clearStatus: true });
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
   * Resume execution from a specific step and clear results for that step and any downstream steps
   */
  async resumeFrom(
    stepName: string,
    options?: { signal?: AbortSignal },
  ): Promise<Map<string, any>> {
    this.initializeRunState({ clearResults: false, clearStatus: false });
    const orderedSteps = this.dependencyResolver.getExecutionOrder();
    this.ensureStatusFromResults(orderedSteps);

    const startIndex = orderedSteps.findIndex((step) => step.name === stepName);
    if (startIndex === -1) {
      throw new StateError('Step not found in flow', {
        stepName,
        flowName: this.flow.name,
      });
    }

    this.clearResultsFromIndex(orderedSteps, startIndex);
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

  private findLastStatusIndex(orderedSteps: Step[], status: 'success' | 'failed'): number {
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
    // Epoch of this run. If reset() reinitializes run state while this run is
    // in flight, the epoch changes and this run must not touch the fresh state.
    const runEpoch = this.runEpoch;
    let globalTimeoutId: NodeJS.Timeout | undefined;
    let flowAbortEmitted = false;
    const executionPolicy = this.flow.policies?.global?.execution;
    const maxConcurrency = executionPolicy?.maxConcurrency ?? 0;
    const onFailure = executionPolicy?.onFailure ?? 'skip-dependents';
    const concurrencyLimit =
      typeof maxConcurrency === 'number' && maxConcurrency > 0
        ? maxConcurrency
        : Number.POSITIVE_INFINITY;
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
      const stepsByName = new Map(orderedSteps.map((step) => [step.name, step]));
      const stepIndex = new Map<string, number>();
      orderedSteps.forEach((step, index) => stepIndex.set(step.name, index));
      const graph = this.dependencyResolver.getDependencyGraph();
      const depsByStep = new Map<string, Set<string>>();
      const dependentsByStep = new Map<string, Set<string>>();
      for (const node of graph.nodes) {
        depsByStep.set(node.name, new Set(node.dependencies));
        dependentsByStep.set(node.name, new Set(node.dependents));
      }

      this.events.emitDependencyResolved(orderedStepNames);
      this.events.emitFlowStart(this.flow.name, orderedStepNames);

      this.logger.info('Executing steps in order:', orderedStepNames);

      const completed = new Set<string>();
      const failed = new Map<string, Error>();
      const skipped = new Map<string, string>();
      const inFlight = new Set<string>();
      const forcedCompleted = new Set<string>();
      for (let index = 0; index < safeStartIndex; index++) {
        forcedCompleted.add(orderedSteps[index].name);
      }
      for (const step of orderedSteps) {
        if (
          this.stepStatus.get(step.name)?.status === 'success' ||
          this.stepResults.has(step.name) ||
          forcedCompleted.has(step.name)
        ) {
          completed.add(step.name);
        }
      }

      const markSkipped = (stepName: string, reason: string): void => {
        const step = stepsByName.get(stepName)!;
        skipped.set(stepName, reason);
        const correlationId = this.generateCorrelationId(stepName);
        this.stepCorrelationIds.set(stepName, correlationId);
        this.events.emitStepSkip(step, reason, correlationId);
      };

      const skipDependents = (rootStepName: string, reason: string): void => {
        const queue = [...dependentsByStep.get(rootStepName)!];
        while (queue.length > 0) {
          const dependentName = queue.shift()!;
          if (
            completed.has(dependentName) ||
            failed.has(dependentName) ||
            skipped.has(dependentName)
          ) {
            continue;
          }
          markSkipped(dependentName, reason);
          queue.push(...dependentsByStep.get(dependentName)!);
        }
      };

      const inDegree = new Map<string, number>();
      const readyQueue: Step[] = [];
      for (const step of orderedSteps) {
        if (completed.has(step.name) || skipped.has(step.name)) {
          continue;
        }
        const deps = depsByStep.get(step.name)!;
        let remainingDeps = 0;
        for (const dep of deps) {
          if (!completed.has(dep)) {
            remainingDeps += 1;
          }
        }
        inDegree.set(step.name, remainingDeps);
        if (remainingDeps === 0) {
          readyQueue.push(step);
        }
      }

      const running = new Set<Promise<void>>();
      let stopScheduling = false;
      let stopReason: string | null = null;
      let pauseError: PauseError | null = null;
      let workflowStopped = false;
      let stopIndex: number | null = null;

      const startStep = (step: Step): void => {
        const run = (async () => {
          const stepStartTime = Date.now();
          const correlationId = this.generateCorrelationId(step.name);
          this.stepCorrelationIds.set(step.name, correlationId);
          inFlight.add(step.name);
          try {
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

            if (runEpoch !== this.runEpoch) {
              // This run was superseded by reset() while the step was in
              // flight (the handler ignored the abort and resolved). Drop the
              // result instead of recording it into the fresh state.
              return;
            }

            this.stepResults.set(step.name, result);
            this.stepStatus.set(step.name, { status: 'success' });
            completed.add(step.name);
            if (this.lastFailedStepName === step.name) {
              this.lastFailedStepName = null;
            }

            this.events.emitStepComplete(step, result, stepStartTime, correlationId);

            const shouldStop = this.checkForStopResult(result);
            if (shouldStop) {
              workflowStopped = true;
              stopScheduling = true;
              stopReason = 'Stopped by stop step';
              stopIndex = stepIndex.get(step.name)!;
              if (!flowAbortEmitted) {
                this.events.emitFlowAborted(this.flow.name, stopReason);
                flowAbortEmitted = true;
              }
              // The stop step itself completed successfully (step:complete was
              // emitted above), so it must not also be reported as skipped.
              // Only steps that will never run get a step:skip. (Issue #150.)
              for (const stepName of orderedStepNames) {
                if (
                  completed.has(stepName) ||
                  failed.has(stepName) ||
                  skipped.has(stepName) ||
                  inFlight.has(stepName)
                ) {
                  continue;
                }
                markSkipped(stepName, stopReason);
              }
              return;
            }

            const dependents = dependentsByStep.get(step.name)!;
            for (const dependentName of dependents) {
              if (
                completed.has(dependentName) ||
                failed.has(dependentName) ||
                skipped.has(dependentName)
              ) {
                continue;
              }
              const remaining = inDegree.get(dependentName)! - 1;
              inDegree.set(dependentName, remaining);
              if (remaining === 0) {
                const dependentStep = stepsByName.get(dependentName)!;
                readyQueue.push(dependentStep);
              }
            }
          } catch (error: any) {
            if (runEpoch !== this.runEpoch) {
              // This step belonged to a run superseded by reset(). Its state
              // was already cleared: report the abort truthfully but write
              // nothing, and emit no timeout/error events for it.
              this.events.emitStepAborted(step, 'reset');
              return;
            }
            const reason = this.globalAbortController.signal.reason;
            const isPause = this.isPaused || reason === 'paused';
            if (this.globalAbortController.signal.aborted && isPause) {
              this.events.emitStepAborted(step, String(reason));
              if (!flowAbortEmitted) {
                this.events.emitFlowPaused(this.flow.name, String(reason));
                flowAbortEmitted = true;
              }
              pauseError = new PauseError('Flow execution paused', {
                flowName: this.flow.name,
                stepName: step.name,
              });
              stopScheduling = true;
              stopReason = String(reason);
              return;
            }

            this.stepStatus.set(step.name, {
              status: 'failed',
              error: error instanceof Error ? error : undefined,
            });
            this.lastFailedStepName = step.name;
            failed.set(step.name, error instanceof Error ? error : new Error(String(error)));

            if (error instanceof TimeoutError) {
              this.events.emitStepTimeout(step, error.timeout, error.executionTime);
            }
            this.events.emitStepError(step, error, stepStartTime, correlationId);

            if (onFailure === 'abort-flow') {
              stopScheduling = true;
              stopReason = `Aborted due to failed step: ${step.name}`;
              if (!this.globalAbortController.signal.aborted) {
                this.globalAbortController.abort('aborted');
              }
              if (!flowAbortEmitted) {
                this.events.emitFlowAborted(this.flow.name, stopReason);
                flowAbortEmitted = true;
              }
              return;
            }

            skipDependents(step.name, `Skipped due to failed dependency: ${step.name}`);
          } finally {
            inFlight.delete(step.name);
          }
        })();

        running.add(run);
        run.finally(() => running.delete(run));
      };

      const skipRemaining = (reason: string): void => {
        for (const stepName of orderedStepNames) {
          if (
            completed.has(stepName) ||
            failed.has(stepName) ||
            skipped.has(stepName) ||
            inFlight.has(stepName)
          ) {
            continue;
          }
          const step = stepsByName.get(stepName)!;
          this.events.emitStepAborted(step, reason);
          markSkipped(stepName, reason);
        }
      };

      while (
        (readyQueue.length > 0 || running.size > 0) &&
        !pauseError &&
        // Stop scheduling the moment reset() supersedes this run.
        runEpoch === this.runEpoch
      ) {
        if (this.globalAbortController.signal.aborted && !stopScheduling) {
          const reason = this.globalAbortController.signal.reason || 'Flow execution aborted';
          stopScheduling = true;
          stopReason = String(reason);
          if (reason === 'Stopped by stop step') {
            workflowStopped = true;
          }
          if (!flowAbortEmitted) {
            if (this.isPaused || reason === 'paused') {
              this.events.emitFlowPaused(this.flow.name, String(reason));
            } else {
              this.events.emitFlowAborted(this.flow.name, String(reason));
            }
            flowAbortEmitted = true;
          }
          if (this.isPaused || reason === 'paused') {
            pauseError = new PauseError('Flow execution paused', {
              flowName: this.flow.name,
              stepName: 'flow',
            });
          }
        }

        while (!stopScheduling && readyQueue.length > 0 && running.size < concurrencyLimit) {
          const step = readyQueue.shift()!;
          startStep(step);
        }

        if (stopScheduling && stopReason && !workflowStopped) {
          skipRemaining(stopReason);
        }

        if (running.size === 0) {
          break;
        }

        await Promise.race(Array.from(running));
      }

      if (stopScheduling && stopReason && !workflowStopped && runEpoch === this.runEpoch) {
        skipRemaining(stopReason);
      }

      if (running.size > 0) {
        await Promise.allSettled(Array.from(running));
      }

      if (runEpoch !== this.runEpoch) {
        // This run was superseded by reset(): its state was already cleared.
        // Fail distinctly rather than reporting stale failures or a
        // misleading success.
        if (!flowAbortEmitted) {
          this.events.emitFlowAborted(this.flow.name, 'reset');
          flowAbortEmitted = true;
        }
        throw new ResetError('Flow execution was reset', { flowName: this.flow.name });
      }

      if (pauseError) {
        throw pauseError;
      }

      if (workflowStopped && stopIndex !== null) {
        for (const [stepName, index] of stepIndex.entries()) {
          if (index > stopIndex) {
            this.stepResults.delete(stepName);
            this.stepStatus.delete(stepName);
          }
        }
      }

      if (
        this.globalAbortController.signal.aborted &&
        this.globalAbortController.signal.reason === 'timeout'
      ) {
        const duration = Date.now() - startTime;
        const flowTimeout = this.flow.policies?.global?.timeout?.timeout || 0;
        const timeoutError = new TimeoutError(
          `Flow execution timed out after ${duration}ms. Configured timeout: ${flowTimeout}ms.`,
          flowTimeout,
          duration,
        );
        throw timeoutError;
      }

      if (failed.size > 0 && !workflowStopped) {
        const errors = Array.from(failed.values());
        // Snapshot the successful steps' results so consumers can inspect
        // how far the flow got without re-executing (issue #162). This is a
        // shallow copy of the map: reset()/setStepResults()/re-execution may
        // clear or replace the live map, but the error keeps its own
        // snapshot. Result values are shared references, which is safe
        // because the framework never mutates stored results.
        const stepResults = Object.fromEntries(this.stepResults);
        if (errors.length === 1) {
          const error = errors[0] as Error & { context?: Record<string, unknown> };
          error.context = { ...error.context, stepResults };
          throw errors[0];
        }
        throw new ExecutionError('Flow execution failed with multiple errors', {
          failedSteps: Array.from(failed.keys()),
          skippedSteps: Array.from(skipped.keys()),
          stepResults,
        });
      }

      if (
        this.globalAbortController.signal.aborted &&
        this.globalAbortController.signal.reason !== 'paused' &&
        this.globalAbortController.signal.reason !== 'Stopped by stop step' &&
        !workflowStopped
      ) {
        throw new Error(String(this.globalAbortController.signal.reason));
      }

      this.events.emitFlowComplete(this.flow.name, this.stepResults, startTime);
      return this.stepResults;
    } catch (error: any) {
      if (error instanceof PauseError) {
        throw error;
      }
      if (error instanceof ResetError) {
        // Already reported via flow:aborted above; pass through like PauseError
        // instead of converting to a flow:error.
        throw error;
      }
      if (this.globalAbortController.signal.aborted && !flowAbortEmitted) {
        const reason = this.globalAbortController.signal.reason || 'Flow execution aborted';
        if (this.isPaused || reason === 'paused') {
          this.events.emitFlowPaused(this.flow.name, String(reason));
        } else {
          this.events.emitFlowAborted(this.flow.name, String(reason));
        }
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
        const timeoutError =
          error instanceof TimeoutError
            ? error
            : new TimeoutError(
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
   * Execute the flow and return all step results.
   *
   * Normally this starts a fresh run, clearing prior results and status.
   * After {@link importState}, the next `execute()` instead resumes from the
   * imported checkpoint: completed steps are skipped and the failed step (if
   * any) is re-run. The resume behavior applies to exactly one `execute()`
   * call; subsequent calls go back to fresh-run semantics.
   */
  async execute(options?: { signal?: AbortSignal }): Promise<Map<string, any>> {
    const priorAbortReason = this.globalAbortController?.signal.aborted
      ? this.globalAbortController.signal.reason
      : null;
    // importState() arms the flag; initializeRunState() consumes it.
    const resumeImported = this.pendingImportedState;
    this.initializeRunState({ clearResults: !resumeImported, clearStatus: !resumeImported });
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

      // Do not wrap framework errors: FlowError subclasses already carry a
      // machine-readable code, step context, and a cause chain. JSON-RPC
      // request errors are also passed through untouched so the detailed
      // error response (code/message/data) reaches the consumer intact.
      if (error instanceof FlowError || error instanceof JsonRpcRequestError) {
        throw error;
      }

      // Wrap remaining errors in an ExecutionError that preserves the
      // original details instead of flattening them into a generic message
      // (issue #51): the original error is kept as `cause`, any error code it
      // carries is propagated, and step context is attached for actionable
      // error output.
      const cause = error instanceof Error ? error : undefined;
      const originalCode =
        error && typeof error === 'object' && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
      throw new ExecutionError(
        `Failed to execute step ${step.name}: ${errorMessage}`,
        {
          code: originalCode ?? ErrorCode.EXECUTION_ERROR,
          stepName: step.name,
          // Successful steps so far, so consumers can see how far the flow
          // got before failing (see issue #19).
          completedSteps: Array.from(this.stepResults.keys()),
        },
        cause,
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

/**
 * Rehydrate a checkpoint's plain-data error back into an `Error` instance so
 * the executor's internal `stepStatus` map keeps its `error?: Error` type
 * invariant. The original error class is not preserved — only the message
 * and stack survive the JSON round trip — which is fine: the step re-runs on
 * resume and the recorded error is informational.
 */
function rehydrateCheckpointError(stored: { message: string; stack?: string }): Error {
  const error = new Error(stored.message);
  if (stored.stack !== undefined) {
    error.stack = stored.stack;
  }
  return error;
}
