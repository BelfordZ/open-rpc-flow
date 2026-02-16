import { ErrorCode } from './codes';

/**
 * Base error class for all flow-related errors
 */
export class FlowError<C extends Record<string, unknown> = Record<string, any>> extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly context: C,
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

  toString(options?: { includeStack?: boolean }): string {
    let str = `${this.name}: ${this.message}`;
    if (this.code) str += ` [code=${this.code}]`;
    if (this.context) {
      for (const [key, value] of Object.entries(this.context as Record<string, unknown>)) {
        if (key === 'cause' || key === 'lastError' || key === 'code' || key === 'lastErrorCode')
          continue; // handled below
        let val = value as unknown;
        if (key === 'step') {
          val = (value as any).name;
        }
        str += ` [${key}=${val}]`;
      }
    }
    if (options?.includeStack && this.stack) {
      str += `\n${this.stack}`;
    }
    return str;
  }
}

/**
 * Error class for validation errors
 */
export class ValidationError<
  C extends Record<string, unknown> = Record<string, any>,
> extends FlowError<C> {
  constructor(message: string, context: C) {
    super(message, ErrorCode.VALIDATION_ERROR, context);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Error class for execution errors
 */
export class ExecutionError<
  C extends Record<string, unknown> = Record<string, any>,
> extends FlowError<C> {
  constructor(message: string, context: C, cause?: Error) {
    const code = (context as any).code || ErrorCode.EXECUTION_ERROR;
    super(message, code, context, cause);
    this.name = 'ExecutionError';
    Object.setPrototypeOf(this, ExecutionError.prototype);
  }
}

/**
 * Error class for state errors
 */
export class StateError<
  C extends Record<string, unknown> = Record<string, any>,
> extends FlowError<C> {
  constructor(message: string, context: C) {
    super(message, ErrorCode.STATE_ERROR, context);
    this.name = 'StateError';
    Object.setPrototypeOf(this, StateError.prototype);
  }
}

/**
 * Error class for paused executions
 */
export class PauseError<
  C extends Record<string, unknown> = Record<string, any>,
> extends StateError<C> {
  constructor(message: string, context: C) {
    super(message, context);
    this.name = 'PauseError';
    Object.setPrototypeOf(this, PauseError.prototype);
  }
}
type RetryErrorContext = {
  code: ErrorCode.MAX_RETRIES_EXCEEDED;
  attempts: number;
  lastError: string;
  lastErrorType?: string;
  lastErrorCode: string;
  policy: any;
};
export class MaxRetriesExceededError extends ExecutionError<Record<string, unknown>> {
  public readonly allErrors: unknown[];

  constructor(message: string, context: RetryErrorContext, allErrors: unknown[], cause?: Error) {
    super(
      message,
      {
        code: context.code,
        attempts: context.attempts,
        policyMaxAttempts: context.policy.maxAttempts,
      },
      cause,
    );
    this.name = 'MaxRetriesExceededError';
    this.allErrors = allErrors;
    Object.setPrototypeOf(this, MaxRetriesExceededError.prototype);
  }

  toString(options?: { includeStack?: boolean }): string {
    let str = super.toString(options);
    if (this.allErrors && this.allErrors.length > 0) {
      str += `\nAll errors in retry chain:`;
      this.allErrors.forEach((err, idx) => {
        const errAny = err as any;
        if (typeof errAny?.toString === 'function') {
          str += `\n  [${idx + 1}] ${errAny.toString({ ...options, includeStack: false })}`;
        } else {
          str += `\n  [${idx + 1}] ${String(err)}`;
        }
      });
    }
    return str;
  }
}

/**
 * Error class for loop step execution errors
 */
export class LoopStepExecutionError extends ExecutionError {
  constructor(message: string, context: Record<string, unknown>, cause?: Error) {
    super(message, { ...context, code: ErrorCode.EXECUTION_ERROR }, cause);
    this.name = 'LoopStepExecutionError';
    Object.setPrototypeOf(this, LoopStepExecutionError.prototype);
  }
}
