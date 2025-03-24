import { JsonRpcParamValue } from './json-rpc';
import { Logger } from '../util/logger';
import { ReferenceResolver } from '../reference-resolver';
import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';

/**
 * Represents the result of executing a step
 */
export interface StepExecutionResult {
  success: boolean;
  data?: JsonRpcParamValue;
  error?: {
    message: string;
    code?: number;
    details?: JsonRpcParamValue;
  };
}

/**
 * Represents the execution context available to all step executors
 */
export interface StepExecutionContext {
  referenceResolver: ReferenceResolver;
  expressionEvaluator: SafeExpressionEvaluator;
  stepResults: Map<string, StepExecutionResult>;
  context: Record<string, JsonRpcParamValue>;
  logger: Logger;
}
