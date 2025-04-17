import { Step } from '../types';
import { StepExecutionContext } from '../types';
import { RetryPolicy } from '../errors/recovery';

export { Step };

/**
 * Interface for transform operations
 */
export interface TransformOperation {
  type: 'map' | 'filter' | 'reduce' | 'flatten' | 'sort' | 'unique' | 'group' | 'join';
  using: string;
  as?: string;
  initial?: any;
}

/**
 * Custom error class for JSON-RPC request errors
 */
export class JsonRpcRequestError extends Error {
  constructor(
    message: string,
    public readonly error: {
      code: number;
      message: string;
      data?: any;
    },
  ) {
    super(message);
    this.name = 'JsonRpcRequestError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Base interface for step execution results with stronger typing
 */
export interface StepExecutionResult<T = any> {
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
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
  Transform = 'transform',
  Stop = 'stop',
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
  TContext extends StepExecutionContext = StepExecutionContext,
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
    extraContext?: Record<string, any>,
    signal?: AbortSignal
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
  /**
   * @deprecated Use step.policies.retryPolicy instead
   * Retry policy that overrides the global retry policy for this specific step
   */
  retryPolicy?: RetryPolicy;
}

export interface LoopStep extends Step {
  loop: {
    over: string;
    as: string;
    condition?: string;
    maxIterations?: number;
    step?: Step;
    steps?: Step[];
  };
}

export interface ConditionStep extends Step {
  condition: {
    if: string;
    then: Step;
    else?: Step;
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
  !!step.transform && typeof step.transform === 'object';

/**
 * Type guard for loop results
 */
export const isLoopResult = <T>(result: StepExecutionResult<any>): result is LoopStepResult<T> =>
  result.type === StepType.Loop && 'value' in result.result && 'iterationCount' in result.result;

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

export interface TransformStep extends Step {
  timeout?: number;
  transform: {
    input: string | any[];
    operations: TransformOperation[];
  };
}
