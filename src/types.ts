import { TransformOperation } from './step-executors/types';
import { JsonRpcRequest, JsonRpcParamValue } from './types/json-rpc';
import { StepExecutionContext, StepExecutionResult } from './types/step-execution';

export type StepType = 'request' | 'loop' | 'condition' | 'transform' | 'stop';

export interface Flow {
  name: string;
  description: string;
  steps: Step[];
  context?: Record<string, JsonRpcParamValue>;
}

export interface Step {
  name: string;
  description?: string;
  request?: {
    method: string;
    params: Record<string, JsonRpcParamValue> | JsonRpcParamValue[];
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

// Re-export types from other modules
export { JsonRpcRequest, StepExecutionContext, StepExecutionResult };
