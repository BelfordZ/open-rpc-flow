import {
  FlowError,
  ValidationError,
  ExecutionError,
  ErrorCode,
  RetryableOperation,
  RetryPolicy,
} from '../../errors';
import { noLogger, TestLogger } from '../../util/logger';

describe('Error Framework', () => {
  let testLogger: TestLogger;

  beforeEach(() => {
    testLogger = new TestLogger('ErrorFrameworkTest');
  });

  afterEach(() => {
    //testLogger.print();
    testLogger.clear();
  });

  describe('Error Classes', () => {
    it('should create FlowError with context', () => {
      const context = { foo: 'bar' };
      const error = new FlowError('test error', ErrorCode.INTERNAL_ERROR, context);

      expect(error.message).toBe('test error');
      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.context).toEqual(context);
      expect(error.name).toBe('FlowError');
    });

    it('should create ValidationError', () => {
      const context = { field: 'name', value: null };
      const error = new ValidationError('Invalid field', context);

      expect(error.message).toBe('Invalid field');
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.context).toEqual(context);
      expect(error instanceof FlowError).toBe(true);
    });

    it('should create ExecutionError with cause', () => {
      const cause = new Error('original error');
      const context = { operation: 'test' };
      const error = new ExecutionError('Execution failed', context, cause);

      expect(error.message).toBe('Execution failed');
      expect(error.code).toBe(ErrorCode.EXECUTION_ERROR);
      expect(error.context).toEqual(context);
      expect(error.cause).toBe(cause);
      expect(error instanceof FlowError).toBe(true);
    });
  });

  describe('RetryableOperation', () => {
    const policy: RetryPolicy = {
      maxAttempts: 3,
      backoff: {
        initial: 0,
        multiplier: 1,
        maxDelay: 0,
      },
      retryableErrors: [ErrorCode.NETWORK_ERROR],
    };

    it('should retry on retryable error', async () => {
      const logger = testLogger.createNested('debugging');

      // Use the approach from recovery.test.ts that works
      const networkError = new FlowError('network error', ErrorCode.NETWORK_ERROR, {});

      // Verify that the error has the correct code
      logger.debug('Network error details', {
        error: networkError,
        code: networkError.code,
        codeType: typeof networkError.code,
        errorType: networkError.constructor.name,
        isFlowError: networkError instanceof FlowError,
      });

      // Use the working implementation from recovery.test.ts
      const operation = jest
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('success');

      const retryable = new RetryableOperation(operation, policy, logger);

      const result = await retryable.execute();

      logger.debug('Operation result', { result });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable error', async () => {
      const operation = jest.fn().mockImplementation(() => {
        throw new ValidationError('Invalid input', {
          code: ErrorCode.INVALID_INPUT,
        });
      });

      const retryable = new RetryableOperation(operation, policy, noLogger);

      await expect(retryable.execute()).rejects.toThrow('Invalid input');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should throw after max attempts', async () => {
      const operationLogger = testLogger.createNested('operation');
      let attempts = 0;

      const operation = jest.fn().mockImplementation(() => {
        attempts++;
        operationLogger.debug('Creating error', { attempt: attempts });

        // Create a FlowError directly instead of ExecutionError
        const error = new FlowError('Network error', ErrorCode.NETWORK_ERROR, {
          attempts,
        });

        operationLogger.debug('Created error', {
          errorType: error.constructor.name,
          errorCode: error.code,
          message: error.message,
        });

        throw error;
      });

      const retryableLogger = testLogger.createNested('retryable');
      const retryable = new RetryableOperation(operation, policy, retryableLogger);

      const error = (await retryable.execute().catch((e) => e)) as FlowError;

      // Check by constructor name instead of instanceof
      expect(error.constructor.name).toBe('MaxRetriesExceededError');
      expect(error.message).toBe('Max retry attempts exceeded');
      expect(error.context.code).toBe(ErrorCode.MAX_RETRIES_EXCEEDED);
      expect(operation).toHaveBeenCalledTimes(3);
      expect(attempts).toBe(3);
    });
  });
});
