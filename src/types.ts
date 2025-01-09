import { TransformOperation } from './transform-executor';
import { ReferenceResolver } from './reference-resolver';
import { ExpressionEvaluator } from './expression-evaluator';
import { TransformExecutor } from './transform-executor';
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
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, any> | any[];
  id: number;
}

export interface StepExecutionContext {
  referenceResolver: ReferenceResolver;
  expressionEvaluator: ExpressionEvaluator;
  transformExecutor: TransformExecutor;
  stepResults: Map<string, any>;
  context: Record<string, any>;
  logger: Logger;
}
