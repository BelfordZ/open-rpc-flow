/**
 * Base class for all flow execution errors
 */
export class FlowError extends Error {
  constructor(message: string, public details: Record<string, any> = {}) {
    super(message);
    this.name = this.constructor.name;
    // Ensure proper inheritance in ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when flow definition is invalid
 */
export class ValidationError extends FlowError {
  constructor(message: string, details: Record<string, any> = {}) {
    super(message, details);
  }
}

/**
 * Error thrown when dependencies cannot be resolved
 */
export class DependencyError extends FlowError {
  constructor(message: string, details: Record<string, any> = {}) {
    super(message, details);
  }
}

/**
 * Error thrown when expression evaluation fails
 */
export class ExpressionError extends FlowError {
  constructor(message: string, details: Record<string, any> = {}) {
    super(message, details);
  }
}

/**
 * Error thrown when JSON-RPC request fails
 */
export class RequestError extends FlowError {
  constructor(message: string, details: Record<string, any> = {}) {
    super(message, details);
  }
}

/**
 * Base class for step execution errors
 */
export class StepExecutionError extends FlowError {
  constructor(message: string, details: Record<string, any> = {}) {
    super(message, details);
  }
}

/**
 * Error thrown for loop step specific errors
 */
export class LoopError extends StepExecutionError {
  constructor(message: string, details: Record<string, any> = {}) {
    super(message, details);
  }
}

/**
 * Error thrown for transform step specific errors
 */
export class TransformError extends StepExecutionError {
  constructor(message: string, details: Record<string, any> = {}) {
    super(message, details);
  }
}

/**
 * Error thrown for condition step specific errors
 */
export class ConditionError extends StepExecutionError {
  constructor(message: string, details: Record<string, any> = {}) {
    super(message, details);
  }
} 