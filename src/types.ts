import { StepType, TransformOperation } from './step-executors/types';
import { ReferenceResolver } from './reference-resolver';
import { SafeExpressionEvaluator } from './expression-evaluator/safe-evaluator';
import { Logger } from './util/logger';
import { RetryPolicy } from './errors/recovery';

export type { StepType } from './step-executors/types';

/**
 * Context object passed to flows and steps
 */
export interface ExecutionContextData {
  [key: string]: unknown;
}

/**
 * Overrides that can be provided to the PolicyResolver
 */
export interface PolicyOverrides {
  retryPolicy?: RetryPolicy;
  [key: string]: unknown;
}

/**
 * Standard structure for error objects
 */
export interface ErrorData {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * JSON-serializable summary of a caught step failure, attached to a
 * recovered step's result envelope as `error` and exposed to a nested
 * recovery step as `${error}`.
 */
export interface StepErrorInfo {
  /** Error class name, e.g. 'JsonRpcRequestError' or 'TimeoutError'. */
  name: string;
  /** Human-readable failure message. */
  message: string;
  /** Machine-readable code when the error carries one (string or number). */
  code?: string | number;
}

/**
 * Per-step error recovery configuration (issue #193).
 *
 * Declared on a step as `onError`, applied after the step's retries are
 * exhausted. Exactly one recovery strategy may be set:
 * - `fallback`: the step recovers with this value as its result. May be a
 *   static JSON value or a `${...}` expression resolved at recovery time
 *   against the normal reference scope (input, context, completed steps).
 * - `step`: a single nested recovery step to run when the parent fails.
 *   Its `name` is required; it resolves references against the normal scope
 *   plus `${error}` (the caught {@link StepErrorInfo}), and its `.result`
 *   becomes the parent step's result. It may declare its own `policies`
 *   but must not declare its own `onError` (one level only).
 * - `{}` (neither): the error info itself becomes the step's result.
 *
 * A recovered step keeps `success` status; its result envelope carries the
 * caught failure as `error`, so `${stepName.error} != null` discriminates
 * recovered steps downstream while `${stepName.result}` holds the recovered
 * value. Recovery never triggers flow-level `onFailure: 'abort-flow'`.
 */
export interface OnErrorConfig {
  fallback?: unknown;
  step?: Step;
}

/**
 * Policies for a specific step type or as a default for all steps
 */
export interface Policies {
  /**
   * Retry policy configuration
   */
  retryPolicy?: {
    /**
     * Maximum number of retry attempts
     * @minimum 0
     * @maximum 100
     * @default 3
     */
    maxAttempts?: number;
    /**
     * Backoff configuration for retries
     */
    backoff?: {
      /**
       * The strategy to use for the backoff
       * @default "exponential"
       */
      strategy?: 'exponential' | 'linear';
      /**
       * Initial delay in milliseconds
       */
      initial?: number;
      /**
       * Multiplier/exponent for the backoff
       */
      multiplier?: number;
      /**
       * Maximum delay in milliseconds
       * @default 5000
       */
      maxDelay?: number;
    };
    /**
     * List of error codes that are considered retryable
     */
    retryableErrors?: string[];
  };
  /**
   * Timeout policy configuration
   */
  timeout?: {
    /**
     * Timeout in milliseconds
     * @default 10000
     */
    timeout?: number;
    /**
     * Timeout for expression evaluation in milliseconds
     * @default 1000
     */
    expressionEval?: number;
  };
  /**
   * Execution policy configuration
   */
  execution?: {
    /**
     * Maximum number of concurrent steps (0 = unlimited)
     * @default 0
     */
    maxConcurrency?: number;
    /**
     * Failure behavior for independent branches
     * @default "skip-dependents"
     */
    onFailure?: 'skip-dependents' | 'abort-flow';
  };
}

/**
 * Metaschema-compliant policies for the flow
 * - global: applies to the whole flow
 * - step: can be a default for all steps, or per-stepType (request, transform, etc)
 */
export interface FlowPolicies {
  global?: Policies;
  step?: {
    // Per-stepType policies (metaschema-compliant)
    request?: Policies;
    transform?: Policies;
    loop?: Policies;
    condition?: Policies;
    stop?: Policies;
    // Default for all steps (metaschema-compliant)
    timeout?: Policies['timeout'];
    retryPolicy?: Policies['retryPolicy'];
    // Allow additional keys for future extensibility
    [key: string]: any;
  };
}

export interface Flow {
  name: string;
  description: string;
  steps: Step[];
  context?: ExecutionContextData;
  /**
   * Global and step-level policies for the flow (metaschema-compliant)
   */
  policies?: FlowPolicies;
}

/**
 * Runtime input supplied to `FlowExecutor.execute(input)`.
 *
 * Unlike `flow.context` (static, declared on the flow), input is provided
 * fresh on every run and is addressable in any `${...}` reference or
 * expression as `${input.<key>}` — e.g. `${input.userId}`. The executor
 * deep-clones the input, so later mutations of the caller's object cannot
 * affect the run; it is also frozen, so steps should treat it as read-only.
 *
 * Input must be JSON-serializable: it travels inside checkpoints
 * (`exportState`/`importState`), which are pure JSON.
 */
export type FlowInput = Record<string, unknown>;

/**
 * Classic if/then/else condition branch.
 */
export interface IfCondition {
  if: string;
  then: Step;
  else?: Step;
}

/**
 * Switch condition: evaluates an expression and executes the case whose
 * key matches the value, or `default` when nothing matches.
 *
 * Case keys are strings; a non-string switch value matches the case key
 * equal to its `String()` coercion (so `42` matches `"42"`, `true` matches
 * `"true"`), mirroring JavaScript property-access semantics.
 */
export interface SwitchCondition {
  switch: string;
  cases: Record<string, Step | Step[]>;
  default?: Step | Step[];
}

export interface Step {
  name: string;
  description?: string;
  /**
   * Optional policies for this specific step
   */
  policies?: Policies;
  request?: {
    method: string;
    params: Record<string, any> | any[];
  };
  loop?: {
    over: string;
    as: string;
    condition?: string;
    maxIterations?: number;
    step?: Step;
    steps?: Step[];
  };
  condition?: IfCondition | SwitchCondition;
  transform?: {
    input?: string | any[];
    operations: TransformOperation[];
  };
  delay?: {
    duration: number;
    step: Step;
  };
  stop?: {
    endWorkflow?: boolean;
  };
  /**
   * Per-step error recovery: what the step yields when it fails after
   * retries are exhausted, instead of failing the flow (issue #193).
   */
  onError?: OnErrorConfig;
  /**
   * Optional custom metadata for this step
   */
  metadata?: Record<string, any>;
  timeout?: number;
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, any> | any[];
  id: number;
}

/**
 * Options for JsonRpcHandler requests
 */
export interface JsonRpcHandlerOptions {
  /**
   * AbortSignal that can be used to cancel the request
   */
  signal?: AbortSignal;

  /**
   * Execution path of the flow step making this call, e.g. `'fetchUsers'`
   * or `'processUsers[2].fetchUser'` for a sub-step inside a loop iteration.
   * Set by FlowExecutor for calls made by flow steps; absent when the handler
   * is used directly. Recording and replay handlers use it to attribute
   * calls to steps (see `src/record-replay/`).
   */
  stepPath?: string;

  /**
   * Additional options specific to the JsonRpcHandler implementation
   */
  [key: string]: any;
}

/**
 * Function signature for the JsonRpcHandler
 */
export type JsonRpcHandler = (
  request: JsonRpcRequest,
  options?: JsonRpcHandlerOptions,
) => Promise<any>;

/**
 * Represents the execution context available to all step executors
 */
export interface StepExecutionContext {
  referenceResolver: ReferenceResolver;
  expressionEvaluator: SafeExpressionEvaluator;
  stepResults: Map<string, unknown>;
  context: ExecutionContextData;
  logger: Logger;
  /**
   * AbortSignal that can be used to cancel operations
   */
  signal?: AbortSignal;
  /**
   * The flow being executed (for accessing flow-level configuration)
   */
  flow?: Flow;
}

/**
 * Represents a node in the dependency graph
 */
export interface DependencyNode {
  name: string;
  type: StepType;
  dependencies: string[];
  dependents: string[];
}

/**
 * Represents the complete dependency graph structure
 */
export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: Array<{
    from: string;
    to: string;
  }>;
}

/**
 * Utility to determine the step type from a Step object
 */
export function getStepType(step: Step): StepType {
  if (step.request) return StepType.Request;
  if (step.loop) return StepType.Loop;
  if (step.condition) return StepType.Condition;
  if (step.transform) return StepType.Transform;
  if (step.delay) return StepType.Delay;
  if (step.stop) return StepType.Stop;
  return StepType.Unknown;
}
