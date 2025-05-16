import {
  FlowError,
  ValidationError,
  ExecutionError,
  StateError,
  MaxRetriesExceededError,
} from '../base';
import { TimeoutError } from '../timeout-error';
import { ErrorCode } from '../codes';

describe('FlowError', () => {
  it('should create base error with minimal parameters', () => {
    const error = new FlowError('test message', ErrorCode.INTERNAL_ERROR, {});
    expect(error.message).toBe('test message');
    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(error.context).toEqual({});
    expect(error.cause).toBeUndefined();
    expect(error).toBeInstanceOf(FlowError);
    expect(error).toBeInstanceOf(Error);
  });

  it('should create base error with cause', () => {
    const cause = new Error('cause error');
    const error = new FlowError('test message', ErrorCode.INTERNAL_ERROR, {}, cause);
    expect(error.cause).toBe(cause);
  });

  it('should capture stack trace when available', () => {
    const error = new FlowError('test message', ErrorCode.INTERNAL_ERROR, {});
    expect(error.stack).toBeDefined();
    expect(error.stack?.includes('FlowError')).toBe(true);
  });

  it('should handle missing Error.captureStackTrace', () => {
    const originalCaptureStackTrace = Error.captureStackTrace;
    Error.captureStackTrace = undefined as any;

    const error = new FlowError('test message', ErrorCode.INTERNAL_ERROR, {});
    expect(error).toBeInstanceOf(FlowError);

    Error.captureStackTrace = originalCaptureStackTrace;
  });
});

describe('ValidationError', () => {
  it('should create validation error with correct properties', () => {
    const context = { field: 'test' };
    const error = new ValidationError('invalid input', context);

    expect(error.message).toBe('invalid input');
    expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error.context).toBe(context);
    expect(error.name).toBe('ValidationError');
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toBeInstanceOf(FlowError);
  });
});

describe('ExecutionError', () => {
  it('should create execution error with default code', () => {
    const context = { operation: 'test' };
    const error = new ExecutionError('execution failed', context);

    expect(error.code).toBe(ErrorCode.EXECUTION_ERROR);
    expect(error.context).toBe(context);
    expect(error.name).toBe('ExecutionError');
  });

  it('should create execution error with custom code', () => {
    const context = { operation: 'test', code: ErrorCode.TIMEOUT_ERROR };
    const error = new ExecutionError('execution failed', context);

    expect(error.code).toBe(ErrorCode.TIMEOUT_ERROR);
  });

  it('should create execution error with cause', () => {
    const cause = new Error('root cause');
    const error = new ExecutionError('execution failed', {}, cause);

    expect(error.cause).toBe(cause);
  });
});

describe('TimeoutError', () => {
  it('should create timeout error with correct properties', () => {
    const error = new TimeoutError('operation timed out', 1000, 1200);

    expect(error.message).toBe('operation timed out');
    expect(error.code).toBe(ErrorCode.TIMEOUT_ERROR);
    expect(error.name).toBe('TimeoutError');
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).toBeInstanceOf(FlowError);
  });
});

describe('StateError', () => {
  it('should create state error with correct properties', () => {
    const context = { state: 'invalid' };
    const error = new StateError('invalid state', context);

    expect(error.message).toBe('invalid state');
    expect(error.code).toBe(ErrorCode.STATE_ERROR);
    expect(error.context).toBe(context);
    expect(error.name).toBe('StateError');
    expect(error).toBeInstanceOf(StateError);
    expect(error).toBeInstanceOf(FlowError);
  });
});

describe('toString methods', () => {
  it('formats FlowError with context and stack', () => {
    const err = new FlowError('oops', ErrorCode.INTERNAL_ERROR, {
      step: { name: 'myStep' },
      foo: 'bar',
    });
    const str = err.toString({ includeStack: true });
    expect(str).toContain('FlowError: oops');
    expect(str).toContain('[code=INTERNAL_ERROR]');
    expect(str).toContain('[step=myStep]');
    expect(str).toContain('[foo=bar]');
    expect(str).toContain(err.stack!.split('\n')[0]);
  });

  it('formats MaxRetriesExceededError with all errors', () => {
    const baseErr = new FlowError('base', ErrorCode.NETWORK_ERROR, {});
    const retryErr = new MaxRetriesExceededError(
      'failed',
      {
        code: ErrorCode.MAX_RETRIES_EXCEEDED,
        attempts: 2,
        lastError: 'base',
        lastErrorCode: ErrorCode.NETWORK_ERROR,
        policy: { maxAttempts: 2 },
      },
      [baseErr],
    );
    const str = retryErr.toString();
    expect(str).toContain('MaxRetriesExceededError: failed');
    expect(str).toContain('All errors in retry chain');
    expect(str).toContain('[1] FlowError: base');
  });
});
