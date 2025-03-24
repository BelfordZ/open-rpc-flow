import {
  FlowError,
  ValidationError,
  ExecutionError,
  ErrorCode,
  RetryableOperation,
  RetryPolicy,
  CircuitBreaker,
  CircuitBreakerConfig,
  ContextCollector,
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
      const operationLogger = testLogger.createNested('operation');
      let attempts = 0;
      let lastError: ExecutionError;

      const operation = jest.fn().mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          operationLogger.debug('Creating error', { attempt: attempts });

          lastError = new ExecutionError('Network error', {
            code: ErrorCode.NETWORK_ERROR,
            attempt: attempts,
          });

          operationLogger.debug('Created error', {
            errorType: lastError.constructor.name,
            errorCode: lastError.code,
            message: lastError.message,
          });

          throw lastError;
        }
        return Promise.resolve('success');
      });

      const retryableLogger = testLogger.createNested('retryable');
      const retryable = new RetryableOperation(operation, policy, retryableLogger);
      const result = await retryable.execute();

      expect(result).toBe('success');
      expect(attempts).toBe(3);
      expect(operation).toHaveBeenCalledTimes(3);
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
      let lastError: ExecutionError;

      const operation = jest.fn().mockImplementation(() => {
        attempts++;
        operationLogger.debug('Creating error', { attempt: attempts });

        lastError = new ExecutionError('Network error', {
          code: ErrorCode.NETWORK_ERROR,
          attempts,
        });

        operationLogger.debug('Created error', {
          errorType: lastError.constructor.name,
          errorCode: lastError.code,
          message: lastError.message,
        });

        throw lastError;
      });

      const retryableLogger = testLogger.createNested('retryable');
      const retryable = new RetryableOperation(operation, policy, retryableLogger);

      await expect(retryable.execute()).rejects.toThrow('Max retry attempts exceeded');
      expect(operation).toHaveBeenCalledTimes(3);
      expect(attempts).toBe(3);
    });
  });

  describe('CircuitBreaker', () => {
    const config: CircuitBreakerConfig = {
      failureThreshold: 2,
      recoveryTime: 1000,
      monitorWindow: 5000,
    };

    let circuitBreaker: CircuitBreaker;

    beforeEach(() => {
      circuitBreaker = new CircuitBreaker(config, noLogger);
    });

    it('should allow operations when closed', async () => {
      const operation = jest.fn().mockResolvedValue('success');

      const result = await circuitBreaker.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should open after failure threshold', async () => {
      const operation = jest.fn().mockRejectedValue(
        new ExecutionError('Failed', {
          code: ErrorCode.NETWORK_ERROR,
        }),
      );

      // First failure
      await expect(circuitBreaker.execute(operation)).rejects.toThrow('Failed');

      // Second failure opens the circuit
      await expect(circuitBreaker.execute(operation)).rejects.toThrow('Failed');

      // Circuit is now open
      await expect(circuitBreaker.execute(operation)).rejects.toThrow('Circuit breaker is open');

      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should transition to half-open after recovery time', async () => {
      const operation = jest
        .fn()
        .mockRejectedValueOnce(new Error('Failed'))
        .mockRejectedValueOnce(new Error('Failed'))
        .mockResolvedValueOnce('success');

      // Open the circuit
      await expect(circuitBreaker.execute(operation)).rejects.toThrow();
      await expect(circuitBreaker.execute(operation)).rejects.toThrow();

      // Wait for recovery time
      await new Promise((resolve) => setTimeout(resolve, config.recoveryTime));

      // Should allow one request in half-open state
      const result = await circuitBreaker.execute(operation);
      expect(result).toBe('success');
    });
  });

  describe('ContextCollector', () => {
    let collector: ContextCollector;

    beforeEach(() => {
      collector = new ContextCollector(noLogger);
    });

    it('should collect execution context', async () => {
      const context = await collector.collect();

      expect(context).toHaveProperty('step');
      expect(context).toHaveProperty('execution');
      expect(context).toHaveProperty('system');

      expect(context.system).toHaveProperty('memory');
      expect(context.system).toHaveProperty('cpu');
      expect(context.system).toHaveProperty('env');
    });
  });
});
