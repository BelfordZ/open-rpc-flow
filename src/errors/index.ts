export * from './base';
export * from './codes';
export * from './recovery';
export * from './circuit-breaker';
export * from './context';

import { ErrorCode } from './codes';

/**
 * Base error class for all flow-related errors
 */
export class FlowError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context: Record<string, any>,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'FlowError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error class for validation errors
 */
export class ValidationError extends FlowError {
  constructor(message: string, context: Record<string, any>) {
    super(message, ErrorCode.VALIDATION_ERROR, context);
    this.name = 'ValidationError';
  }
}

/**
 * Error class for execution errors
 */
export class ExecutionError extends FlowError {
  constructor(message: string, context: Record<string, any>, cause?: Error) {
    super(message, ErrorCode.EXECUTION_ERROR, context, cause);
    this.name = 'ExecutionError';
  }
}

/**
 * Error class for timeout errors
 */
export class TimeoutError extends FlowError {
  constructor(message: string, context: Record<string, any>) {
    super(message, ErrorCode.TIMEOUT_ERROR, context);
    this.name = 'TimeoutError';
  }
}

/**
 * Error class for state errors
 */
export class StateError extends FlowError {
  constructor(message: string, context: Record<string, any>) {
    super(message, ErrorCode.STATE_ERROR, context);
    this.name = 'StateError';
  }
}
