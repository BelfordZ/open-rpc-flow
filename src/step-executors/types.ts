import { Step } from '../types';
import { ReferenceResolver } from '../reference-resolver';
import { ExpressionEvaluator } from '../expression-evaluator';
import { TransformExecutor, TransformOperation } from '../transform-executor';

export { Step };

/**
 * Represents the execution context available to all step executors
 */
export interface StepExecutionContext {
  referenceResolver: ReferenceResolver;
  expressionEvaluator: ExpressionEvaluator;
  transformExecutor: TransformExecutor;
  stepResults: Map<string, any>;
  context: Record<string, any>;
}

/**
 * Base interface for step execution results with stronger typing
 */
export interface StepExecutionResult<T = any> {
  result: T;
  type: StepType;
  metadata?: Record<string, any>;
}

/**
 * Enum of all possible step types
 */
export enum StepType {
  Request = 'request',
  Loop = 'loop',
  Condition = 'condition',
  Transform = 'transform'
}

/**
 * Type guard to check if a step is a specific type
 */
export type StepTypeGuard<T extends Step> = (step: Step) => step is T;

/**
 * Base interface for all step executors with improved generic constraints
 */
export interface StepExecutor<
  TStep extends Step = Step,
  TResult = any,
  TContext extends StepExecutionContext = StepExecutionContext
> {
  /**
   * Type guard to check if a step can be handled by this executor
   */
  canExecute: StepTypeGuard<TStep>;
  
  /**
   * Execute the step and return the result
   */
  execute(
    step: TStep,
    context: TContext,
    extraContext?: Record<string, any>
  ): Promise<StepExecutionResult<TResult>>;
}

/**
 * Specific step types with their corresponding properties
 */
export interface RequestStep extends Step {
  request: {
    method: string;
    params: Record<string, any> | any[];
  };
}

export interface LoopStep extends Step {
  loop: {
    over: string;
    as: string;
    condition?: string;
    maxIterations?: number;
    step: Step;
  };
}

export interface ConditionStep extends Step {
  condition: {
    if: string;
    then: Step;
    else?: Step;
  };
}

export interface TransformStep extends Step {
  transform: {
    input: string;
    operations: TransformOperation[];
  };
}

/**
 * Type guards for each step type
 */
export const isRequestStep = (step: Step): step is RequestStep => 
  'request' in step && step.request !== undefined;

export const isLoopStep = (step: Step): step is LoopStep =>
  'loop' in step && typeof step.loop === 'object';

export const isConditionStep = (step: Step): step is ConditionStep =>
  'condition' in step && step.condition !== undefined;

export const isTransformStep = (step: Step): step is TransformStep =>
  'transform' in step && typeof step.transform === 'object'; 

/**
 * Base type for loop results
 */
export interface LoopResultBase {
  iterationCount: number;
  skippedCount: number;
}

/**
 * Loop result with array of values
 */
export interface LoopResult<T> extends LoopResultBase {
  value: T[];
}

/**
 * Utility type for loop step results
 */
export type LoopStepResult<T> = StepExecutionResult<LoopResult<T>>;