/**
 * Base class for expression evaluator errors
 */
export class ExpressionError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when expression evaluation fails
 */
export class ExpressionEvaluationError extends ExpressionError {
  constructor(
    message: string,
    public readonly expression: string,
    cause?: Error,
  ) {
    super(message, cause);
  }
}

/**
 * Error thrown when reference resolution fails
 */
export class ReferenceResolutionError extends ExpressionError {
  constructor(
    message: string,
    public readonly path: string,
    cause?: Error,
  ) {
    super(message, cause);
  }
}

/**
 * Error thrown when array access fails
 */
export class ArrayAccessError extends ExpressionError {
  constructor(
    message: string,
    public readonly expression: string,
    cause?: Error,
  ) {
    super(message, cause);
  }
}

/**
 * Error thrown when comparison evaluation fails
 */
export class ComparisonError extends ExpressionError {
  constructor(
    message: string,
    public readonly expression: string,
    cause?: Error,
  ) {
    super(message, cause);
  }
} 