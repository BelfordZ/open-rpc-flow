import { RetryableOperation } from '../recovery';
import { FlowError, ExecutionError } from '../base';
import { ErrorCode } from '../codes';
import { Logger } from '../../util/logger';

describe('RetryableOperation', () => {
  let mockLogger: jest.Mocked<Logger>;
  const defaultPolicy = {
    maxAttempts: 3,
    backoff: {
      initial: 100,
      multiplier: 2,
      maxDelay: 1000,
    },
    retryableErrors: [ErrorCode.NETWORK_ERROR],
  };

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('execute', () => {
    it('should execute successfully on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const retryable = new RetryableOperation(operation, defaultPolicy, mockLogger);

      const result = await retryable.execute();

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).toHaveBeenCalledWith('Operation succeeded', { attempt: 1 });
    });

    it('should retry on retryable error and succeed', async () => {
      const networkError = new FlowError('network error', ErrorCode.NETWORK_ERROR, {});
      const operation = jest
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('success');

      const retryable = new RetryableOperation(operation, defaultPolicy, mockLogger);

      const result = await retryable.execute();

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
      expect(mockLogger.debug).toHaveBeenCalledWith('Operation succeeded', { attempt: 2 });
    });

    it('should throw immediately on non-retryable error', async () => {
      const error = new FlowError('validation error', ErrorCode.VALIDATION_ERROR, {});
      const operation = jest.fn().mockRejectedValue(error);

      const retryable = new RetryableOperation(operation, defaultPolicy, mockLogger);

      await expect(retryable.execute()).rejects.toThrow(error);
      expect(operation).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).toHaveBeenCalledWith('Error is not retryable, throwing', {
        attempt: 1,
        error: error.message,
        errorType: 'FlowError',
      });
    });

    it('should throw ExecutionError after max attempts', async () => {
      const networkError = new FlowError('network error', ErrorCode.NETWORK_ERROR, {});
      const operation = jest.fn().mockRejectedValue(networkError);

      const retryable = new RetryableOperation(operation, defaultPolicy, mockLogger);

      const result = await retryable.execute().catch((e: unknown) => e);
      if (!(result instanceof ExecutionError)) {
        throw new Error('Expected ExecutionError');
      }
      expect(result).toBeInstanceOf(ExecutionError);
      expect(result.message).toBe('Max retry attempts exceeded');
      expect(result.context.code).toBe(ErrorCode.MAX_RETRIES_EXCEEDED);
      expect(operation).toHaveBeenCalledTimes(3);
      expect(mockLogger.debug).toHaveBeenCalledWith('Max attempts exceeded', {
        attempt: 3,
        maxAttempts: 3,
        lastError: networkError.message,
      });
    });

    it('should handle unknown error types', async () => {
      const error = new Error('unknown error');
      const operation = jest.fn().mockRejectedValue(error);

      const retryable = new RetryableOperation(operation, defaultPolicy, mockLogger);

      await expect(retryable.execute()).rejects.toThrow(error);
      expect(operation).toHaveBeenCalledTimes(1);

      // Verify the last relevant debug call
      const debugCalls = mockLogger.debug.mock.calls;
      const lastRelevantCall = debugCalls.find((call) => call[0] === 'Error is not retryable');
      expect(lastRelevantCall?.[1]).toEqual({
        errorType: 'Error',
        errorMessage: 'unknown error',
        retryableErrors: defaultPolicy.retryableErrors,
      });
    });

    it('should handle non-Error objects', async () => {
      const operation = jest.fn().mockRejectedValue('string error');

      const retryable = new RetryableOperation(operation, defaultPolicy, mockLogger);

      await expect(retryable.execute()).rejects.toThrow('string error');
      expect(operation).toHaveBeenCalledTimes(1);

      // Verify the last relevant debug call
      const debugCalls = mockLogger.debug.mock.calls;
      const lastRelevantCall = debugCalls.find((call) => call[0] === 'Error is not retryable');
      expect(lastRelevantCall?.[1]).toEqual({
        errorType: 'Error',
        errorMessage: 'string error',
        retryableErrors: defaultPolicy.retryableErrors,
      });
    });

    it('should handle null/undefined errors', async () => {
      const operation = jest.fn().mockRejectedValue(null);

      const retryable = new RetryableOperation(operation, defaultPolicy, mockLogger);

      await expect(retryable.execute()).rejects.toThrow('null');
      expect(operation).toHaveBeenCalledTimes(1);

      // Verify the last relevant debug call
      const debugCalls = mockLogger.debug.mock.calls;
      const lastRelevantCall = debugCalls.find((call) => call[0] === 'Error is not retryable');
      expect(lastRelevantCall?.[1]).toEqual({
        errorType: 'Error',
        errorMessage: 'null',
        retryableErrors: defaultPolicy.retryableErrors,
      });
    });

    it('should calculate backoff delay correctly', async () => {
      const networkError = new FlowError('network error', ErrorCode.NETWORK_ERROR, {});
      const operation = jest.fn().mockRejectedValue(networkError);

      const retryable = new RetryableOperation(operation, defaultPolicy, mockLogger);

      const startTime = Date.now();
      const result = await retryable.execute().catch((e: unknown) => e);
      const duration = Date.now() - startTime;

      if (!(result instanceof ExecutionError)) {
        throw new Error('Expected ExecutionError');
      }
      expect(result).toBeInstanceOf(ExecutionError);
      expect(result.message).toBe('Max retry attempts exceeded');

      // With initial=100ms, multiplier=2, we expect:
      // First retry: 100ms
      // Second retry: 200ms
      // Total: ~300ms minimum
      expect(duration).toBeGreaterThanOrEqual(300);
      expect(duration).toBeLessThan(1000);
    });

    it('should handle custom retry delay', async () => {
      const policy = {
        ...defaultPolicy,
        retryDelay: 200, // Reduced from 500 for faster tests
      };

      const networkError = new FlowError('network error', ErrorCode.NETWORK_ERROR, {});
      const operation = jest.fn().mockRejectedValue(networkError);

      const retryable = new RetryableOperation(operation, policy, mockLogger);

      const startTime = Date.now();
      const result = await retryable.execute().catch((e: unknown) => e);
      const duration = Date.now() - startTime;

      if (!(result instanceof ExecutionError)) {
        throw new Error('Expected ExecutionError');
      }
      expect(result).toBeInstanceOf(ExecutionError);
      expect(result.message).toBe('Max retry attempts exceeded');

      // With 2 retries at 200ms each, we expect ~400ms minimum
      expect(duration).toBeGreaterThanOrEqual(400);
      expect(duration).toBeLessThan(800);
    });
  });
});
