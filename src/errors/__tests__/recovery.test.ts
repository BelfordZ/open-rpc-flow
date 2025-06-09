import { RetryableOperation } from '../recovery';
import { FlowError, ExecutionError } from '../base';
import { ErrorCode } from '../codes';
import { TestLogger } from '../../util/logger';

describe('RetryableOperation', () => {
  let testLogger: TestLogger;
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
    testLogger = new TestLogger('RetryableOperation');
  });

  afterEach(() => {
    jest.useRealTimers();
    testLogger.clear();
  });

  describe('execute', () => {
    it('should execute successfully on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      const result = await retryable.execute();

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable error and succeed', async () => {
      const networkError = new FlowError('network error', ErrorCode.NETWORK_ERROR, {});
      const operation = jest
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('success');

      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      const result = await retryable.execute();

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);

      const warnings = testLogger.getLogs().filter((l) => l.level === 'warn');
      expect(warnings.length).toBeGreaterThan(0);
    });

    it('should throw immediately on non-retryable error', async () => {
      const error = new FlowError('validation error', ErrorCode.VALIDATION_ERROR, {});
      const operation = jest.fn().mockRejectedValue(error);

      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      await expect(retryable.execute()).rejects.toThrow(error);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should throw ExecutionError after max attempts', async () => {
      const networkError = new FlowError('network error', ErrorCode.NETWORK_ERROR, {});
      const operation = jest.fn().mockRejectedValue(networkError);

      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      const result = await retryable.execute().catch((e: unknown) => e);
      if (!(result instanceof ExecutionError)) {
        throw new Error('Expected ExecutionError');
      }
      expect(result).toBeInstanceOf(ExecutionError);
      expect(result.message).toBe('Max retry attempts exceeded');
      expect(result.context.code).toBe(ErrorCode.MAX_RETRIES_EXCEEDED);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should handle unknown error types', async () => {
      const error = new Error('unknown error');
      const operation = jest.fn().mockRejectedValue(error);

      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      await expect(retryable.execute()).rejects.toThrow(error);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle non-Error objects', async () => {
      const operation = jest.fn().mockRejectedValue('string error');

      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      await expect(retryable.execute()).rejects.toThrow('string error');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle null/undefined errors', async () => {
      const operation = jest.fn().mockRejectedValue(null);

      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      await expect(retryable.execute()).rejects.toThrow('null');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should calculate backoff delay correctly', async () => {
      const networkError = new FlowError('network error', ErrorCode.NETWORK_ERROR, {});
      const operation = jest.fn().mockRejectedValue(networkError);

      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

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

      const retryable = new RetryableOperation(operation, policy, testLogger);

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

    it('should handle max attempts with non-FlowError and FlowError objects', async () => {
      // Test with Error that will be retryable
      // Since regular errors are not normally retryable, we'll make this one look like
      // one of our special error types so it will retry
      const regularError = new Error('regular error');
      Object.defineProperty(regularError, 'constructor', {
        value: { name: 'ExecutionError' },
      });
      // Give it a retryable error code
      Object.defineProperty(regularError, 'code', {
        value: ErrorCode.NETWORK_ERROR,
      });

      // This will retry but eventually fail, and use the 'unknown' branch for the
      // non-FlowError object in the log
      const operation1 = jest.fn().mockRejectedValue(regularError);
      const retryable1 = new RetryableOperation(operation1, defaultPolicy, testLogger);

      // Run until max attempts
      const result1 = (await retryable1.execute().catch((e) => e)) as ExecutionError;
      expect(result1).toBeInstanceOf(ExecutionError);
      expect(result1.message).toBe('Max retry attempts exceeded');
      expect(operation1).toHaveBeenCalledTimes(3); // Max attempts
    });

    it('should retry on any error object with a matching code property (duck-typed)', async () => {
      const duckError = { message: 'duck error', code: ErrorCode.NETWORK_ERROR };
      let attempt = 0;
      const operation = jest.fn().mockImplementation(() => {
        attempt++;
        if (attempt < 2) throw duckError;
        return 'success';
      });

      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      const result = await retryable.execute();

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe('isRetryable function', () => {
    it('should handle ExecutionError correctly', async () => {
      // Create a custom execution error
      class ExecutionError extends Error {
        code: string;
        constructor(message: string, code: string) {
          super(message);
          this.name = 'ExecutionError';
          this.code = code;
        }
      }

      const executionError = new ExecutionError('execution error', ErrorCode.NETWORK_ERROR);
      const operation = jest
        .fn()
        .mockRejectedValueOnce(executionError)
        .mockResolvedValueOnce('success');

      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      const result = await retryable.execute();

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should handle ValidationError correctly', async () => {
      // Create a custom validation error
      class ValidationError extends Error {
        code: string;
        constructor(message: string, code: string) {
          super(message);
          this.name = 'ValidationError';
          this.code = code;
        }
      }

      const validationError = new ValidationError('validation error', ErrorCode.NETWORK_ERROR);
      const operation = jest
        .fn()
        .mockRejectedValueOnce(validationError)
        .mockResolvedValueOnce('success');

      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      const result = await retryable.execute();

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should handle TimeoutError correctly', async () => {
      // Create a custom timeout error
      class TimeoutError extends Error {
        code: string;
        constructor(message: string, code: string) {
          super(message);
          this.name = 'TimeoutError';
          this.code = code;
        }
      }

      const timeoutError = new TimeoutError('timeout error', ErrorCode.NETWORK_ERROR);
      const operation = jest
        .fn()
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce('success');

      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      const result = await retryable.execute();

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should handle StateError correctly', async () => {
      // Create a custom state error
      class StateError extends Error {
        code: string;
        constructor(message: string, code: string) {
          super(message);
          this.name = 'StateError';
          this.code = code;
        }
      }

      const stateError = new StateError('state error', ErrorCode.NETWORK_ERROR);
      const operation = jest
        .fn()
        .mockRejectedValueOnce(stateError)
        .mockResolvedValueOnce('success');

      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      const result = await retryable.execute();

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should handle error with constructor but without name property', async () => {
      // Create a custom error without a name property
      const errorWithoutName = new Error('error without name');
      Object.defineProperty(errorWithoutName, 'constructor', {
        value: { name: undefined },
      });

      const operation = jest.fn().mockRejectedValue(errorWithoutName);

      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      await expect(retryable.execute()).rejects.toThrow('error without name');
    });

    it('should handle error without constructor', async () => {
      // Create a custom error-like object without a constructor
      const errorWithoutConstructor = {
        message: 'error without constructor',
      };

      const operation = jest.fn().mockRejectedValue(errorWithoutConstructor);

      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      // The error will be converted to a string, so check for that instead
      await expect(retryable.execute()).rejects.toThrow();
    });

    it('should handle all retryable error code types correctly', async () => {
      const mixedPolicy = {
        ...defaultPolicy,
        retryableErrors: [
          ErrorCode.NETWORK_ERROR,
          ErrorCode.INTERNAL_ERROR,
          ErrorCode.VALIDATION_ERROR,
        ],
      };

      // Test with different error codes
      const firstCodeError = new FlowError('first code error', ErrorCode.NETWORK_ERROR, {});
      const firstOperation = jest
        .fn()
        .mockRejectedValueOnce(firstCodeError)
        .mockResolvedValueOnce('success');

      const firstRetryable = new RetryableOperation(firstOperation, mixedPolicy, testLogger);
      const firstResult = await firstRetryable.execute();
      expect(firstResult).toBe('success');
      expect(firstOperation).toHaveBeenCalledTimes(2);

      // Test with a different error code
      const secondCodeError = new FlowError('second code error', ErrorCode.VALIDATION_ERROR, {});
      const secondOperation = jest
        .fn()
        .mockRejectedValueOnce(secondCodeError)
        .mockResolvedValueOnce('success');

      const secondRetryable = new RetryableOperation(secondOperation, mixedPolicy, testLogger);
      const secondResult = await secondRetryable.execute();
      expect(secondResult).toBe('success');
      expect(secondOperation).toHaveBeenCalledTimes(2);
    });

    it('should handle error objects with partial FlowError properties', async () => {
      // Create a proper error but with FlowError constructor name
      const mockFlowError = new Error('Mock flow error');
      Object.defineProperty(mockFlowError, 'constructor', {
        value: { name: 'FlowError' },
      });
      Object.defineProperty(mockFlowError, 'code', {
        value: ErrorCode.NETWORK_ERROR,
      });

      const operation1 = jest
        .fn()
        .mockRejectedValueOnce(mockFlowError)
        .mockResolvedValueOnce('success');

      const retryable1 = new RetryableOperation(operation1, defaultPolicy, testLogger);
      const result1 = await retryable1.execute();
      expect(result1).toBe('success');
      expect(operation1).toHaveBeenCalledTimes(2);
    });

    it('should handle errors with various constructor name conditions', async () => {
      // Test each constructor condition separately

      // Test ExecutionError constructor
      const executionError = new Error('Execution error');
      Object.defineProperty(executionError, 'constructor', {
        value: { name: 'ExecutionError' },
      });
      Object.defineProperty(executionError, 'code', {
        value: ErrorCode.NETWORK_ERROR,
      });

      const operation1 = jest
        .fn()
        .mockRejectedValueOnce(executionError)
        .mockResolvedValueOnce('success');

      const retryable1 = new RetryableOperation(operation1, defaultPolicy, testLogger);
      const result1 = await retryable1.execute();
      expect(result1).toBe('success');
      expect(operation1).toHaveBeenCalledTimes(2);

      // Test with different error code types (specifically to cover String comparison)
      const numberCodePolicy = {
        ...defaultPolicy,
        retryableErrors: [ErrorCode.NETWORK_ERROR],
      };

      // Error with number code that matches a string value in retryableErrors
      const errorWithNumberCode = new Error('Error with number code');
      Object.defineProperty(errorWithNumberCode, 'constructor', {
        value: { name: 'FlowError' },
      });
      // Create a property that's actually a number but should match the string value
      Object.defineProperty(errorWithNumberCode, 'code', {
        value: 'NETWORK_ERROR',
      });

      const operation2 = jest
        .fn()
        .mockRejectedValueOnce(errorWithNumberCode)
        .mockResolvedValueOnce('success');

      const retryable2 = new RetryableOperation(operation2, numberCodePolicy, testLogger);
      const result2 = await retryable2.execute();
      expect(result2).toBe('success');
      expect(operation2).toHaveBeenCalledTimes(2);
    });

    it('should correctly check retryable error codes', async () => {
      // This test specifically targets the string comparison in isRetryable

      // Create a policy with both string and number error codes
      const mixedPolicy = {
        ...defaultPolicy,
        retryableErrors: [ErrorCode.NETWORK_ERROR],
      };

      // Test with an error that has a matching error code
      const matchingError = new Error('Matching error');
      Object.defineProperty(matchingError, 'constructor', {
        value: { name: 'FlowError' },
      });
      Object.defineProperty(matchingError, 'code', {
        value: ErrorCode.NETWORK_ERROR, // This should match
      });

      const operation1 = jest
        .fn()
        .mockRejectedValueOnce(matchingError)
        .mockResolvedValueOnce('success');

      const retryable1 = new RetryableOperation(operation1, mixedPolicy, testLogger);
      const result1 = await retryable1.execute();
      expect(result1).toBe('success');
      expect(operation1).toHaveBeenCalledTimes(2);

      // Test with an error that has a non-matching error code
      const nonMatchingError = new Error('Non-matching error');
      Object.defineProperty(nonMatchingError, 'constructor', {
        value: { name: 'FlowError' },
      });
      Object.defineProperty(nonMatchingError, 'code', {
        value: ErrorCode.VALIDATION_ERROR, // This should NOT match
      });

      const operation2 = jest.fn().mockRejectedValue(nonMatchingError);
      const retryable2 = new RetryableOperation(operation2, mixedPolicy, testLogger);

      await expect(retryable2.execute()).rejects.toThrow('Non-matching error');
    });

    it('should handle errors with non-standard constructor properties', async () => {
      // Create an error with a constructor property that doesn't have a name
      const errorWithWeirdConstructor = new Error('Weird constructor');
      Object.defineProperty(errorWithWeirdConstructor, 'constructor', {
        value: {}, // Constructor without a name property
      });

      const operation = jest.fn().mockRejectedValue(errorWithWeirdConstructor);
      const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);

      await expect(retryable.execute()).rejects.toThrow('Weird constructor');
    });

    it('should handle special error string comparison edge cases', async () => {
      // This test targets the String comparison in lines 92-122

      // Create a FlowError-like object with a numeric code
      const numericCodeError = new Error('Numeric code error');
      Object.defineProperty(numericCodeError, 'constructor', {
        value: { name: 'FlowError' },
      });
      Object.defineProperty(numericCodeError, 'code', {
        value: 123, // Numeric code that won't match any string error code
      });

      const operation1 = jest.fn().mockRejectedValue(numericCodeError);
      const retryable1 = new RetryableOperation(operation1, defaultPolicy, testLogger);

      await expect(retryable1.execute()).rejects.toThrow('Numeric code error');
      expect(operation1).toHaveBeenCalledTimes(1);

      // Add a policy with a numeric error code to match
      const numericPolicy = {
        ...defaultPolicy,
        retryableErrors: [ErrorCode.NETWORK_ERROR, 123], // Using TypeScript's type flexibility for testing
      } as any; // Cast to any to bypass type checking

      const operation2 = jest
        .fn()
        .mockRejectedValueOnce(numericCodeError)
        .mockResolvedValueOnce('success');

      const retryable2 = new RetryableOperation(operation2, numericPolicy, testLogger);
      const result2 = await retryable2.execute();
      expect(result2).toBe('success');
      expect(operation2).toHaveBeenCalledTimes(2);
    });

    it('should handle all FlowError-like objects', async () => {
      // This test targets each branch of the error checking logic
      const errorNames = [
        'FlowError',
        'ExecutionError',
        'ValidationError',
        'TimeoutError',
        'StateError',
      ];

      // Test each constructor name variation sequentially
      for (const errorName of errorNames) {
        // Create an error with this constructor name
        const customError = new Error(`${errorName} test`);
        Object.defineProperty(customError, 'constructor', {
          value: { name: errorName },
        });
        Object.defineProperty(customError, 'code', {
          value: ErrorCode.NETWORK_ERROR,
        });

        const operation = jest
          .fn()
          .mockRejectedValueOnce(customError)
          .mockResolvedValueOnce('success');

        const retryable = new RetryableOperation(operation, defaultPolicy, testLogger);
        const result = await retryable.execute();
        expect(result).toBe('success');
        expect(operation).toHaveBeenCalledTimes(2);
      }
    });

    it('should handle special error cases that affect branches', async () => {
      // Test with error that has constructor.name but is not in our list
      const unknownTypeError = new Error('Unknown type error');
      Object.defineProperty(unknownTypeError, 'constructor', {
        value: { name: 'UnknownError' }, // Not in our list of known error types
      });
      Object.defineProperty(unknownTypeError, 'code', {
        value: ErrorCode.NETWORK_ERROR,
      });

      const operation1 = jest.fn().mockRejectedValue(unknownTypeError);
      const retryable1 = new RetryableOperation(operation1, defaultPolicy, testLogger);

      await expect(retryable1.execute()).rejects.toThrow('Max retry attempts exceeded');
      expect(operation1).toHaveBeenCalledTimes(3);

      // Test with object missing specific properties
      const emptyError = { name: 'FlowError' }; // Has name but no constructor or code

      const operation2 = jest.fn().mockRejectedValue(emptyError);
      const retryable2 = new RetryableOperation(operation2, defaultPolicy, testLogger);

      await expect(retryable2.execute()).rejects.toThrow('{"name":"FlowError"}');
      expect(operation2).toHaveBeenCalledTimes(1);
    });

    describe('detailed isRetryable tests', () => {
      // Test each branch of the if condition individually
      it('should return false when error is not an object', () => {
        const retryable = new RetryableOperation(jest.fn(), defaultPolicy, testLogger);
        const result = (retryable as any).isRetryable('not an object');
        expect(result).toBe(false);
      });

      it('should return false when error has no constructor', () => {
        const retryable = new RetryableOperation(jest.fn(), defaultPolicy, testLogger);
        const result = (retryable as any).isRetryable({});
        expect(result).toBe(false);
      });

      it('should return false when error constructor has no name', () => {
        const retryable = new RetryableOperation(jest.fn(), defaultPolicy, testLogger);
        const error = {};
        Object.defineProperty(error, 'constructor', { value: {} });
        const result = (retryable as any).isRetryable(error);
        expect(result).toBe(false);
      });

      it('should return false when error name is not a FlowError type', () => {
        const retryable = new RetryableOperation(jest.fn(), defaultPolicy, testLogger);
        const error = {};
        Object.defineProperty(error, 'constructor', { value: { name: 'RandomError' } });
        const result = (retryable as any).isRetryable(error);
        expect(result).toBe(false);
      });
    });

    describe('calculateDelay', () => {
      it('calculates exponential delay', () => {
        const retryable = new RetryableOperation(jest.fn(), defaultPolicy, testLogger);
        const delay = (retryable as any).calculateDelay(2);
        expect(delay).toBe(200);
      });

      it('calculates linear delay', () => {
        const linearPolicy = {
          ...defaultPolicy,
          backoff: { ...defaultPolicy.backoff, strategy: 'linear' },
        } as const;
        const retryable = new RetryableOperation(jest.fn(), linearPolicy, testLogger);
        const delay = (retryable as any).calculateDelay(3);
        expect(delay).toBe(104);
      });
    });
  });
});
