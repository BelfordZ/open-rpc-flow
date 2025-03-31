import { TransformOperation } from './step-executors/types';
import { ReferenceResolver } from './reference-resolver';
import { SafeExpressionEvaluator } from './expression-evaluator/safe-evaluator';
import { Logger } from './util/logger';

export type StepType = 'request' | 'loop' | 'condition' | 'transform' | 'stop';

export interface Flow {
  name: string;
  description: string;
  steps: Step[];
  context?: Record<string, any>;
  timeouts?: TimeoutOptions;
}

export interface Step {
  name: string;
  description?: string;
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
    input?: string;
    operations: TransformOperation[];
  };
  stop?: {
    endWorkflow?: boolean;
  };
  /**
   * Timeout for this specific step in milliseconds.
   * Takes precedence over flow-level timeouts.
   * @minimum 50 - Must be at least 50ms
   * @maximum 3600000 - Cannot exceed 1 hour (3600000ms)
   */
  timeout?: number;
  /**
   * Fallback configuration for when this step times out
   */
  timeoutFallback?: {
    /**
     * Static value to use as the step result if timeout occurs
     */
    value?: any;
    /**
     * Expression to evaluate to get the fallback value
     */
    expression?: string;
    /**
     * Whether to continue executing the flow after a timeout occurs
     * @default false
     */
    continueExecution?: boolean;
  };
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
  options?: JsonRpcHandlerOptions
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
 * Timeout configuration options for different step types
 */
export interface TimeoutOptions {
  /**
   * Global timeout for all steps (ms)
   * @minimum 50 - Must be at least 50ms
   * @maximum 3600000 - Cannot exceed 1 hour (3600000ms)
   */
  global?: number;

  /**
   * Timeout for all request steps (ms)
   * @minimum 50 - Must be at least 50ms
   * @maximum 3600000 - Cannot exceed 1 hour (3600000ms)
   */
  request?: number;

  /**
   * Timeout for all transform steps (ms)
   * @minimum 50 - Must be at least 50ms
   * @maximum 3600000 - Cannot exceed 1 hour (3600000ms)
   */
  transform?: number;

  /**
   * Timeout for all condition steps (ms)
   * @minimum 50 - Must be at least 50ms
   * @maximum 3600000 - Cannot exceed 1 hour (3600000ms)
   */
  condition?: number;

  /**
   * Timeout for all loop steps (ms)
   * @minimum 50 - Must be at least 50ms
   * @maximum 3600000 - Cannot exceed 1 hour (3600000ms)
   */
  loop?: number;

  /**
   * Timeout for expression evaluation (ms)
   * @minimum 50 - Must be at least 50ms
   * @maximum 3600000 - Cannot exceed 1 hour (3600000ms)
   */
  expression?: number;
}
