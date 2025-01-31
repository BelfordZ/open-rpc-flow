import { TransformOperation } from './step-executors/types';
import { ReferenceResolver } from './reference-resolver';
import { SafeExpressionEvaluator } from './expression-evaluator/safe-evaluator';
import { Logger } from './util/logger';

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
  aggregate?: {
    from: string;
    select?: string[];
    groupBy?: string;
    having?: string;
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
