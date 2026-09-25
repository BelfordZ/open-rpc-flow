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
  FlowInput,
  getStepType,
  StepErrorInfo,
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
import { joinStepPath } from './util/step-path';
import { FlowExecutorEvents, FlowEventOptions } from './util/flow-executor-events';
import { OpenRpcDocument, validateFlow } from './flow-doctor';
import { randomUUID } from 'crypto';
import { RetryPolicy } from './errors/recovery';
import { ErrorCode } from './errors/codes';
import { TimeoutError } from './errors/timeout-error';
import { StopBranch } from './errors/stop-branch';
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
  /**
   * Logger instance to use. Defaults to a `ConsoleLogger` at the `warn`
   * level, so normal runs only emit warnings and errors. Pass
   * `new ConsoleLogger('FlowExecutor', console, 'debug')` to opt back into
   * full output, or a `Logger` of your own to redirect it entirely.
   */
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
 * Per-run options for {@link FlowExecutor.execute}.
 */
export interface ExecuteOptions {
  /**
   * External AbortSignal wired to the run. Aborting it with the reason
   * `'paused'` pauses the flow (resumable via `exportState`/`importState`);
   * any other abort reason cancels the run.
   */
  signal?: AbortSignal;
}

/**
 * Split `execute()`'s arguments into runtime input and run options.
 *
 * `execute()` accepts the input positionally — `execute({ userId: 1 })` — but
 * the pre-input signature `execute({ signal })` keeps working: a first
 * argument carrying a `signal` property (an AbortSignal, or an explicit
 * `undefined`) is treated as the options object for backward compatibility.
 */
function normalizeExecuteArgs(
  input?: FlowInput | ExecuteOptions | null,
  options?: ExecuteOptions,
): { input: FlowInput | null | undefined; options: ExecuteOptions } {
  if (options === undefined && isExecuteOptions(input)) {
    return { input: undefined, options: input };
  }
  return { input: input as FlowInput | null | undefined, options: options ?? {} };
}

function isExecuteOptions(value: unknown): value is ExecuteOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'signal')) {
    return false;
  }
  const signal = (value as { signal?: unknown }).signal;
  return signal === undefined || signal instanceof AbortSignal;
}

/**
 * Summarize a caught step failure as JSON-serializable {@link StepErrorInfo}.
 */
function toStepErrorInfo(error: unknown): StepErrorInfo {
  const name = error instanceof Error ? error.name || 'Error' : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  const rawCode =
    error !== null && typeof error === 'object' && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
  const info: StepErrorInfo = { name, message };
  if (typeof rawCode === 'string' || typeof rawCode === 'number') {
    info.code = rawCode;
  }
  return info;
}

/**
 * Find a {@link TimeoutError} in the error's cause chain. Step executors
 * wrap failures (the request executor wraps a step timeout in an
 * ExecutionError for its retry bookkeeping), but the cause chain preserves
 * the original timeout.
 */
function findTimeoutError(error: unknown): TimeoutError | undefined {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current instanceof TimeoutError) {
      return current;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
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
  /**
   * Runtime input for the current run, addressable as `${input.<key>}`.
   * Set by `execute(input)` (deep-cloned and frozen); restored from the
   * checkpoint by `importState()` so a resumed run sees the same input.
   */
  private flowInput: FlowInput = {};
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
    this.referenceResolver = new ReferenceResolver(
      this.stepResults,
      this.context,
      this.logger,
      this.flowInput,
    );
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
    this.referenceResolver = new ReferenceResolver(
      this.stepResults,
      this.context,
      this.logger,
      this.flowInput,
    );
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
        (step, reason) => this.emitNestedStepSkip(step, reason),
      ),
      new ConditionStepExecutor(
        this.executeStep.bind(this),
        this.logger,
        this.policyResolver,
        (step, reason) => this.emitNestedStepSkip(step, reason),
      ),
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
      input: this.flowInput,
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
    // The input travels with the checkpoint so a resumed run sees the same
    // `${input.*}` values. Checkpoints exported before input existed have no
    // `input` field; they resume with empty input.
    this.flowInput = Object.freeze({ ...((isolated.input ?? {}) as Record<string, unknown>) });
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
    // A reset returns the executor to pristine state: no run input either.
    this.flowInput = {};
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
  async resume(options?: ExecuteOptions): Promise<Map<string, any>> {
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
  async resumeFrom(stepName: string, options?: ExecuteOptions): Promise<Map<string, any>> {
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
  async retry(options?: ExecuteOptions): Promise<Map<string, any>> {
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
          } catch (stepError: any) {
            // Mutable alias: recovery may substitute the error that the
            // failure path below reports (assigning to the catch parameter
            // directly is banned by no-ex-assign).
            let error = stepError;
            if (runEpoch !== this.runEpoch) {
              // This step belonged to a run superseded by reset(). Its state
              // was already cleared: report the abort truthfully but write
              // nothing, and emit no timeout/error events for it.
              this.events.emitStepAborted(step, 'reset');
              return;
            }
            if (error instanceof StopBranch) {
              // A bare `stop: {}` terminated its branch: graceful early exit,
              // not an abort and not a failure (issue #188). The stop step
              // itself completed (step:complete); every step that will never
              // run is reported as skipped (step:skip). The flow then
              // completes normally — deliberately no flow:aborted, unlike
              // `endWorkflow: true`.
              const branchStopReason = `Branch terminated by stop step "${error.stepName}"`;
              if (error.stepName === step.name) {
                this.stepResults.set(step.name, error.result);
                this.stepStatus.set(step.name, { status: 'success' });
                completed.add(step.name);
                this.events.emitStepComplete(step, error.result, stepStartTime, correlationId);
              } else {
                // A nested stop terminated a branch inside this step, so the
                // step itself produced no result.
                markSkipped(step.name, branchStopReason);
              }
              stopScheduling = true;
              stopReason = branchStopReason;
              for (const stepName of orderedStepNames) {
                if (
                  completed.has(stepName) ||
                  failed.has(stepName) ||
                  skipped.has(stepName) ||
                  inFlight.has(stepName)
                ) {
                  continue;
                }
                markSkipped(stepName, branchStopReason);
              }
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

            // Per-step error recovery (issue #193). This catch block only
            // runs after the step's retries are exhausted (retries live
            // inside the step executors), so a step declaring `onError`
            // recovers here instead of failing: it keeps `success` status,
            // its result envelope carries the caught failure as `error`,
            // dependents proceed, and flow-level `onFailure: 'abort-flow'`
            // is never tripped by a recovered step.
            if (step.onError !== undefined) {
              try {
                const recovered = await this.tryRecoverStep(step, error);
                this.stepResults.set(step.name, recovered);
                this.stepStatus.set(step.name, { status: 'success' });
                completed.add(step.name);
                if (this.lastFailedStepName === step.name) {
                  this.lastFailedStepName = null;
                }

                const failure = error instanceof Error ? error : new Error(String(error));
                // A timed-out step reports step:timeout even when it
                // recovers, mirroring the failure path. The timeout hides in
                // the cause chain behind the executor's retry wrapper.
                const timeoutError = findTimeoutError(error);
                if (timeoutError) {
                  this.events.emitStepTimeout(
                    step,
                    timeoutError.timeout,
                    timeoutError.executionTime,
                  );
                }
                this.events.emitStepError(step, failure, stepStartTime, correlationId);
                this.events.emitStepRecovered(
                  step,
                  recovered,
                  failure,
                  stepStartTime,
                  correlationId,
                );

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
                return;
              } catch (recoveryError: unknown) {
                // Recovery itself failed — an invalid onError config, or the
                // nested recovery step failing. The parent fails for real
                // through the normal failure path below. The recovery error
                // retains the original failure as `cause` where applicable.
                error =
                  recoveryError instanceof Error ? recoveryError : new Error(String(recoveryError));
              }
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
   * call; subsequent calls go back to fresh-run semantics. Resuming logs an
   * info line naming the skipped steps and the failed step being re-run.
   *
   * @param input runtime input for this run, addressable in any `${...}`
   * reference or expression as `${input.<key>}`. It is deep-cloned and frozen,
   * so the caller's object cannot affect the run and steps should treat it as
   * read-only. It must be JSON-serializable: it travels inside checkpoints.
   * Omit it (or pass nothing) for a run with empty input. For backward
   * compatibility, `execute({ signal })` is still treated as the options
   * object; use `execute(input, { signal })` to combine both.
   * @param options per-run options (currently just `signal`).
   */
  async execute(
    input?: FlowInput | ExecuteOptions | null,
    options?: ExecuteOptions,
  ): Promise<Map<string, any>> {
    const priorAbortReason = this.globalAbortController?.signal.aborted
      ? this.globalAbortController.signal.reason
      : null;
    // importState() arms the flag; initializeRunState() consumes it.
    const resumeImported = this.pendingImportedState;
    const { input: normalizedInput, options: execOptions } = normalizeExecuteArgs(input, options);
    // An explicit input argument always wins. Otherwise a checkpoint resume
    // keeps the input the checkpoint was exported with; a fresh run starts
    // with empty input.
    if (normalizedInput !== undefined) {
      this.setFlowInput(normalizedInput);
    } else if (!resumeImported) {
      this.setFlowInput({});
    }
    this.initializeRunState({ clearResults: !resumeImported, clearStatus: !resumeImported });
    if (resumeImported) {
      this.logCheckpointResume();
    }
    if (priorAbortReason !== null && priorAbortReason !== undefined) {
      this.globalAbortController.abort(priorAbortReason);
    }
    return this.runFromIndex(0, execOptions);
  }

  /**
   * Validate, deep-clone, and freeze the run input.
   */
  private setFlowInput(input: FlowInput | null): void {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      throw new ValidationError('Flow input must be a non-null object', {
        inputType: Array.isArray(input) ? 'array' : typeof input,
      });
    }
    let cloned: FlowInput;
    try {
      cloned = JSON.parse(JSON.stringify(input)) as FlowInput;
    } catch {
      throw new ValidationError('Flow input must be JSON-serializable (no circular references)', {
        flowName: this.flow.name,
      });
    }
    this.flowInput = Object.freeze(cloned);
  }

  /**
   * Log what a checkpoint resume will do: which recorded-completed steps are
   * skipped and which failed step (if any) is re-run. One line, so a resumed
   * run is auditable without per-step noise.
   */
  private logCheckpointResume(): void {
    const skippedSteps: string[] = [];
    for (const step of this.flow.steps) {
      const completed =
        this.stepStatus.get(step.name)?.status === 'success' || this.stepResults.has(step.name);
      if (completed) {
        skippedSteps.push(step.name);
      }
    }
    const skippedSummary = skippedSteps.length > 0 ? skippedSteps.join(', ') : '(none)';
    const failedSummary = this.lastFailedStepName
      ? `re-running failed step '${this.lastFailedStepName}'`
      : 'no failed step recorded';
    this.logger.info(
      `Resuming from checkpoint: skipping completed step(s): ${skippedSummary}; ${failedSummary}.`,
    );
  }

  /**
   * Recover a failed step via its `onError` configuration (issue #193).
   *
   * Returns the recovered result envelope. Structural problems in the config
   * fail fast with `ValidationError` (Flow Doctor's `validateFlow` reports
   * the same problems statically). When the nested recovery step itself
   * fails, the parent fails for real: the recovery step's error is thrown
   * with the original error attached as `cause`.
   */
  private async tryRecoverStep(step: Step, error: unknown): Promise<StepExecutionResult> {
    const onError = step.onError;
    if (onError === null || typeof onError !== 'object' || Array.isArray(onError)) {
      throw new ValidationError(`Step '${step.name}' has an invalid onError: expected an object`, {
        flowName: this.flow.name,
        stepName: step.name,
      });
    }
    const unknownKeys = Object.keys(onError).filter((key) => key !== 'fallback' && key !== 'step');
    if (unknownKeys.length > 0) {
      throw new ValidationError(
        `Step '${step.name}' has unknown onError key(s): ${unknownKeys.join(', ')}`,
        { flowName: this.flow.name, stepName: step.name },
      );
    }
    // Explicit key presence decides: `{ fallback: undefined, step: {...} }`
    // is invalid even though the fallback carries no value.
    const hasFallback = Object.prototype.hasOwnProperty.call(onError, 'fallback');
    const hasRecoveryStep = Object.prototype.hasOwnProperty.call(onError, 'step');
    if (hasFallback && hasRecoveryStep) {
      throw new ValidationError(
        `Step '${step.name}' onError cannot set both 'fallback' and 'step'`,
        { flowName: this.flow.name, stepName: step.name },
      );
    }

    const errorInfo = toStepErrorInfo(error);
    this.logger.debug(`Recovering step '${step.name}' via onError`, { error: errorInfo });

    if (hasRecoveryStep) {
      const recoveryStep = onError.step as Step;
      if (
        recoveryStep === null ||
        typeof recoveryStep !== 'object' ||
        Array.isArray(recoveryStep)
      ) {
        throw new ValidationError(`Step '${step.name}' onError.step must be a step object`, {
          flowName: this.flow.name,
          stepName: step.name,
        });
      }
      if (typeof recoveryStep.name !== 'string' || recoveryStep.name.length === 0) {
        throw new ValidationError(`Step '${step.name}' onError.step must have a name`, {
          flowName: this.flow.name,
          stepName: step.name,
        });
      }
      if (recoveryStep.onError !== undefined) {
        throw new ValidationError(
          `Step '${step.name}' onError.step must not declare its own onError (one level only)`,
          { flowName: this.flow.name, stepName: step.name },
        );
      }
      // The nested recovery step runs with the normal reference scope plus
      // `${error}` holding the caught failure summary. It reuses the standard
      // nested-step machinery, so any step type works, its own policies
      // (timeout/retries) are honored, and its step:start/step:complete
      // events fire under its own name.
      const nestedContext: ExecutionContextData = {
        _nestedStep: true,
        _parentStep: step.name,
        error: errorInfo,
      };
      let nestedResult: StepExecutionResult;
      try {
        nestedResult = await this.executeStep(
          recoveryStep,
          nestedContext,
          this.globalAbortController.signal,
        );
      } catch (nestedError: unknown) {
        if (nestedError instanceof StopBranch) {
          // A stop inside the recovery step adopts its result, mirroring
          // the top-level stop handling.
          nestedResult = nestedError.result;
        } else {
          const failure =
            nestedError instanceof Error ? nestedError : new Error(String(nestedError));
          (failure as { cause?: unknown }).cause =
            error instanceof Error ? error : new Error(String(error));
          throw failure;
        }
      }
      this.stepResults.set(recoveryStep.name, nestedResult);
      this.stepStatus.set(recoveryStep.name, { status: 'success' });
      return this.buildRecoveredEnvelope(step, nestedResult.result, errorInfo);
    }

    // A `${...}` fallback resolves at recovery time against the normal scope
    // (input, context, completed step results); static values pass through.
    // With neither `fallback` nor `step`, the error info itself becomes the
    // step's result.
    const recoveredValue = hasFallback
      ? this.referenceResolver.resolveReferences(onError.fallback, {})
      : errorInfo;
    return this.buildRecoveredEnvelope(step, recoveredValue, errorInfo);
  }

  /**
   * Build the result envelope for a recovered step: the recovered value as
   * `result`, with the caught failure attached as `error` so `${step.error}`
   * discriminates recovered steps downstream.
   */
  private buildRecoveredEnvelope(
    step: Step,
    recoveredValue: unknown,
    errorInfo: StepErrorInfo,
  ): StepExecutionResult {
    return {
      result: recoveredValue,
      type: getStepType(step),
      metadata: {
        recovered: true,
        recoveredAt: new Date().toISOString(),
      },
      error: errorInfo,
    };
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

    // Tag this step execution with its execution path so handler calls can be
    // attributed to steps (used by record/replay). Nested steps derive their
    // path from the parent path carried in the extra context; loop executors
    // extend it with an iteration segment (see LoopStepExecutor).
    const parentPath =
      typeof extraContext._stepPath === 'string' ? extraContext._stepPath : undefined;
    (contextWithMeta as ExecutionContextData)._stepPath = joinStepPath(parentPath, step.name);
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
      if (error instanceof StopBranch) {
        // Internal control-flow signal, not a failure: a bare stop step ran
        // and terminated its branch (issue #188). The stop step itself is
        // reported as complete here when it ran nested — the top-level run
        // loop reports top-level stop steps — and the signal propagates
        // untouched to the enclosing branch boundary. It is never wrapped
        // in an ExecutionError and never retried.
        if (isNested && error.stepName === step.name) {
          this.events.emitStepComplete(step, error.result, stepStartTime, correlationId);
        }
        throw error;
      }

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
   * Emit step:skip for a nested step that will never run because a bare
   * stop step terminated its branch (issue #188). Wired into the loop and
   * condition executors, which report the remaining steps of a terminated
   * branch through this callback.
   */
  private emitNestedStepSkip(step: Step, reason: string): void {
    const correlationId = this.generateCorrelationId(step.name);
    this.stepCorrelationIds.set(step.name, correlationId);
    this.events.emitStepSkip(step, reason, correlationId);
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
