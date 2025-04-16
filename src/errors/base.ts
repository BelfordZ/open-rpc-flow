import { ErrorCode } from './codes';

/**
 * Base error class for all flow-related errors
 */
export class FlowError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly context: Record<string, any>,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'FlowError';

    // Ensure the prototype chain is set up correctly
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }

    // Set up the prototype chain for instanceof checks
    Object.setPrototypeOf(this, FlowError.prototype);
  }
}

/**
 * Error class for validation errors
 */
export class ValidationError extends FlowError {
  constructor(message: string, context: Record<string, any>) {
    super(message, ErrorCode.VALIDATION_ERROR, context);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Error class for execution errors
 */
export class ExecutionError extends FlowError {
  constructor(message: string, context: Record<string, any>, cause?: Error) {
    const code = context.code || ErrorCode.EXECUTION_ERROR;
    super(message, code, context, cause);
    this.name = 'ExecutionError';
    Object.setPrototypeOf(this, ExecutionError.prototype);
  }
}

/**
 * Error class for state errors
 */
export class StateError extends FlowError {
  constructor(message: string, context: Record<string, any>) {
    super(message, ErrorCode.STATE_ERROR, context);
    this.name = 'StateError';
    Object.setPrototypeOf(this, StateError.prototype);
  }
}
