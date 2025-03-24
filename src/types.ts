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
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, any> | any[];
  id: number;
}

/**
 * Represents the execution context available to all step executors
 */
export interface StepExecutionContext {
  referenceResolver: ReferenceResolver;
  expressionEvaluator: SafeExpressionEvaluator;
  stepResults: Map<string, any>;
  context: Record<string, any>;
  logger: Logger;
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
