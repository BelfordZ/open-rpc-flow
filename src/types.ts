import { StepType, TransformOperation } from './step-executors/types';
import { ReferenceResolver } from './reference-resolver';
import { SafeExpressionEvaluator } from './expression-evaluator/safe-evaluator';
import { Logger } from './util/logger';

export type { StepType } from './step-executors/types';

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

/**
 * Minimal OpenRPC content descriptor
 */
export interface OpenRPCContentDescriptor {
  name: string;
  description?: string;
  required?: boolean;
  schema: Record<string, any>;
}

/**
 * Minimal OpenRPC method definition
 */
export interface OpenRPCMethod {
  name: string;
  description?: string;
  params: OpenRPCContentDescriptor[];
  result: OpenRPCContentDescriptor;
}

export interface Flow {
  name: string;
  description: string;
  steps: Step[];
  context?: Record<string, any>;
  /**
   * Global and step-level policies for the flow (metaschema-compliant)
   */
  policies?: FlowPolicies;
}

export interface Step {
  name: string;
  description?: string;
  /**
   * Optional policies for this specific step
   */
  policies?: Policies;
  /**
   * Optional OpenRPC method definition describing the step's interface
   */
  openrpc?: OpenRPCMethod;
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
  condition?: {
    if: string;
    then: Step;
    else?: Step;
  };
  transform?: {
    input?: string | any[];
    operations: TransformOperation[];
  };
  stop?: {
    endWorkflow?: boolean;
  };
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
  stepResults: Map<string, any>;
  context: Record<string, any>;
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
  if (step.stop) return StepType.Stop;
  return StepType.Unknown;
}
