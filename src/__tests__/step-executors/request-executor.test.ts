import { StepExecutionContext, Step } from '../../types';
import { JsonRpcRequestError } from '../../step-executors/types';
import { createMockContext } from '../test-utils';
import { TestLogger } from '../../util/logger';
import { CircuitBreaker, CircuitBreakerConfig } from '../../errors/circuit-breaker';
import { RetryPolicy, RetryableOperation } from '../../errors/recovery';
import { ErrorCode } from '../../errors/codes';
import { ExecutionError } from '../../errors/base';
import { RequestStepExecutor } from '../../step-executors';
import { json } from 'stream/consumers';

interface RequestStep extends Step {
  request: {
    method: string;
    params: Record<string, any>;
  };
}

describe('RequestStepExecutor', () => {
  let executor: RequestStepExecutor;
  let context: StepExecutionContext;
  let jsonRpcHandler: jest.Mock;
  const testLogger = new TestLogger('RequestStepExecutorTest');

  beforeEach(() => {
    jsonRpcHandler = jest.fn();
    executor = new RequestStepExecutor(jsonRpcHandler, testLogger);
    context = createMockContext();
  });

  afterEach(() => {
    jest.clearAllMocks();
    testLogger.print();
    testLogger.clear();
  });

  it('executes a simple request step', async () => {
    const step: RequestStep = {
      name: 'getUser',
      request: {
        method: 'user.get',
        params: { id: 1 },
      },
    };

    jsonRpcHandler.mockResolvedValue({ id: 1, name: 'Test User' });
    const result = await executor.execute(step, context);

    expect(result.type).toBe('request');
    expect(result.result).toEqual({ id: 1, name: 'Test User' });
    expect(result.metadata).toEqual({
      hasError: false,
      method: 'user.get',
      requestId: 1,
      timestamp: expect.any(String),
    });
  });

  it('resolves references in request parameters', async () => {
    const step: RequestStep = {
      name: 'getPermissions',
      request: {
        method: 'permissions.get',
        params: {
          userId: '${user.id}',
          role: '${user.role}',
        },
      },
    };

    context.stepResults.set('user', { id: 1, role: 'admin' });
    jsonRpcHandler.mockResolvedValue(['foo', 'bar']);
    const result = await executor.execute(step, context);
    console.log(jsonRpcHandler.mock.calls);
    expect(result.result).toEqual(['foo', 'bar']);
    expect(jsonRpcHandler).toHaveBeenCalledTimes(1);
    expect(jsonRpcHandler).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'permissions.get',
      params: expect.objectContaining({
        userId: 1,
        role: 'admin',
      }),
      id: expect.any(Number),
    }, undefined);
  });

  it('handles JSON-RPC error responses', async () => {
    const step: RequestStep = {
      name: 'failingRequest',
      request: {
        method: 'error.test',
        params: {},
      },
    };

    const errorResponse = {
      error: {
        code: -32000,
        message: 'Custom error',
        data: { details: 'Additional info' },
      },
    };

    jsonRpcHandler.mockResolvedValue(errorResponse);

    const result = await executor.execute(step, context);

    expect(result.result).toBe(errorResponse);
    expect(result.result.error).toBe(errorResponse.error);
  });

  it('validates method type and emptiness', async () => {
    const nonStringStep: RequestStep = {
      name: 'nonStringMethod',
      request: {
        method: 123 as any,
        params: {},
      },
    };

    const emptyStep: RequestStep = {
      name: 'emptyMethod',
      request: {
        method: '',
        params: {},
      },
    };

    const whitespaceStep: RequestStep = {
      name: 'whitespaceMethod',
      request: {
        method: '   ',
        params: {},
      },
    };

    await expect(executor.execute(nonStringStep, context)).rejects.toThrow(
      'Invalid method name: must be a non-empty string',
    );

    await expect(executor.execute(emptyStep, context)).rejects.toThrow(
      'Invalid method name: must be a non-empty string',
    );

    await expect(executor.execute(whitespaceStep, context)).rejects.toThrow(
      'Invalid method name: must be a non-empty string',
    );
  });

  it('validates params type', async () => {
    const step: RequestStep = {
      name: 'invalidParams',
      request: {
        method: 'test.method',
        params: 'invalid' as any,
      },
    };

    await expect(executor.execute(step, context)).rejects.toThrow(
      'Invalid params: must be an object, array, or null',
    );
  });

  it('handles request errors gracefully', async () => {
    const step: RequestStep = {
      name: 'failingRequest',
      request: {
        method: 'error.test',
        params: {},
      },
    };

    jsonRpcHandler.mockRejectedValue(new Error('Network error'));
    await expect(executor.execute(step, context)).rejects.toThrow(
      'Failed to execute request step "failingRequest": Network error',
    );
  });

  it('handles context variables in parameters', async () => {
    const step: RequestStep = {
      name: 'contextTest',
      request: {
        method: 'test.method',
        params: {
          value: '${context.testValue}',
        },
      },
    };

    context.context.testValue = 'test';
    jsonRpcHandler.mockResolvedValue({ success: true });
    await executor.execute(step, context);

    expect(jsonRpcHandler).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'test.method',
      params: {
        value: 'test',
      },
      id: expect.any(Number),
    }, undefined);
  });

  it('cycles request IDs correctly', async () => {
    const step: RequestStep = {
      name: 'idTest',
      request: {
        method: 'test.method',
        params: {},
      },
    };

    (executor as any).requestId = Number.MAX_SAFE_INTEGER - 1;
    jsonRpcHandler.mockResolvedValue({ success: true });

    const result1 = await executor.execute(step, context);
    const result2 = await executor.execute(step, context);

    expect(result1.metadata?.requestId).toBe(Number.MAX_SAFE_INTEGER);
    expect(result2.metadata?.requestId).toBe(1);
  });

  it('increments request IDs correctly', async () => {
    const step: RequestStep = {
      name: 'idTest',
      request: {
        method: 'test.method',
        params: {},
      },
    };

    jsonRpcHandler.mockResolvedValue({ success: true });

    const result1 = await executor.execute(step, context);
    const result2 = await executor.execute(step, context);
    const result3 = await executor.execute(step, context);

    expect(result1.metadata?.requestId).toBe(1);
    expect(result2.metadata?.requestId).toBe(2);
    expect(result3.metadata?.requestId).toBe(3);
  });

  it('handles array parameters', async () => {
    const step: RequestStep = {
      name: 'arrayParams',
      request: {
        method: 'test.method',
        params: ['${value1}', '${value2}'],
      },
    };

    context.stepResults.set('value1', 'first');
    context.stepResults.set('value2', 'second');
    jsonRpcHandler.mockResolvedValue({ success: true });

    await executor.execute(step, context);

    expect(jsonRpcHandler).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'test.method',
      params: ['first', 'second'],
      id: expect.any(Number),
    }, undefined);
  });

  it('handles unknown errors', async () => {
    const step: RequestStep = {
      name: 'unknownError',
      request: {
        method: 'test.method',
        params: {},
      },
    };

    jsonRpcHandler.mockRejectedValue(null);
    await expect(executor.execute(step, context)).rejects.toThrow(
      'Failed to execute request step "unknownError": Unknown error',
    );
  });

  it('handles request errors gracefully', async () => {
    const step: RequestStep = {
      name: 'requestError',
      request: {
        method: 'error.test',
        params: {},
      },
    };
    jsonRpcHandler.mockResolvedValue({ error: { message: 'Custom error' } });
    const result = await executor.execute(step, context);
    expect(result.metadata).toBeDefined();
    expect(result?.metadata?.hasError).toBe(true);
    expect(result.result.error).toEqual({ message: 'Custom error' });
  });

  it('throws error when given invalid step type', async () => {
    const invalidStep = {
      name: 'invalidStep',
      loop: {
        // This makes it a LoopStep instead of a RequestStep
        over: '${items}',
        as: 'item',
        step: {
          name: 'someStep',
        },
      },
    };

    await expect(executor.execute(invalidStep as any, context)).rejects.toThrow(
      'Invalid step type for RequestStepExecutor',
    );
  });

  it('rethrows unexpected errors', async () => {
    const step: RequestStep = {
      name: 'jsonRpcError',
      request: {
        method: 'test.method',
        params: {},
      },
    };

    const jsonRpcError = new Error('Kaboom');

    jsonRpcHandler.mockRejectedValue(jsonRpcError);

    // The error should be rethrown as-is, not wrapped in another error
    await expect(executor.execute(step, context)).rejects.toThrow(
      'Failed to execute request step "jsonRpcError": Kaboom',
    );
  });

  it('rethrows JsonRpcRequestError as-is', async () => {
    const step: RequestStep = {
      name: 'jsonRpcRequestError',
      request: {
        method: 'test.method',
        params: {},
      },
    };

    // Create a JsonRpcRequestError instance
    const jsonRpcRequestError = new JsonRpcRequestError('JSON-RPC error occurred', {
      code: -32000,
      message: 'Internal error',
    });

    jsonRpcHandler.mockRejectedValue(jsonRpcRequestError);

    // The JsonRpcRequestError should be rethrown as-is, not wrapped
    await expect(executor.execute(step, context)).rejects.toThrow(jsonRpcRequestError);
    // Make sure it doesn't wrap the error in another error message
    await expect(executor.execute(step, context)).rejects.not.toThrow(
      'Failed to execute request step',
    );
  });

  describe('with circuit breaker', () => {
    let circuitBreakerConfig: CircuitBreakerConfig;
    let cbExecutor: RequestStepExecutor;
    
    beforeEach(() => {
      // Reset the mocks
      jest.clearAllMocks();
      
      // Create a circuit breaker config
      circuitBreakerConfig = {
        failureThreshold: 3,
        recoveryTime: 5000,
        monitorWindow: 60000
      };
      
      // Create an executor with circuit breaker config - using real implementation
      cbExecutor = new RequestStepExecutor(
        jsonRpcHandler,
        testLogger,
        null,
        circuitBreakerConfig
      );
    });
    
    afterEach(() => {
      jest.clearAllMocks();
    });
    
    it('initializes with circuit breaker configuration', () => {
      // Verify the executor has a circuit breaker
      expect((cbExecutor as any).circuitBreaker).toBeInstanceOf(CircuitBreaker);
    });
    
    it('executes request using circuit breaker', async () => {
      const step: RequestStep = {
        name: 'circuitBreakerTest',
        request: {
          method: 'test.method',
          params: {},
        },
      };
      
      jsonRpcHandler.mockResolvedValue({ success: true });
      
      const result = await cbExecutor.execute(step, context);
      
      // Verify result was processed through the circuit breaker
      expect(result.result).toEqual({ success: true });
      expect(jsonRpcHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'test.method',
          params: {}
        }),
        undefined
      );
    });
    
    it('handles errors with circuit breaker', async () => {
      const step: RequestStep = {
        name: 'circuitBreakerErrorTest',
        request: {
          method: 'test.method',
          params: {},
        },
      };
      
      // Setup the mock to throw an error
      jsonRpcHandler.mockRejectedValue(new Error('Circuit break error'));
      
      // Original implementation passes through errors
      await expect(cbExecutor.execute(step, context)).rejects.toThrow(
        'Failed to execute request step "circuitBreakerErrorTest": Circuit break error'
      );
      
      // Verify jsonRpcHandler was called
      expect(jsonRpcHandler).toHaveBeenCalled();
    });
  });
  
  describe('with retry policy only', () => {
    let retryPolicy: RetryPolicy;
    let rpExecutor: RequestStepExecutor;
    
    beforeEach(() => {
      // Reset the mocks
      jest.clearAllMocks();
      
      // Create a retry policy with correct properties
      retryPolicy = {
        maxAttempts: 3,
        retryableErrors: [ErrorCode.NETWORK_ERROR],
        backoff: {
          initial: 100,
          multiplier: 2,
          maxDelay: 5000
        },
        retryDelay: 1000
      };
      
      // Create an executor with retry policy only - using real implementation
      rpExecutor = new RequestStepExecutor(
        jsonRpcHandler,
        testLogger,
        retryPolicy,
        null // no circuit breaker
      );
    });
    
    afterEach(() => {
      jest.clearAllMocks();
    });
    
    it('executes request using retry policy without circuit breaker', async () => {
      const step: RequestStep = {
        name: 'retryPolicyTest',
        request: {
          method: 'test.method',
          params: {},
        },
      };
      
      jsonRpcHandler.mockResolvedValue({ success: true });
      
      // Execute the step
      const result = await rpExecutor.execute(step, context);
      
      // Verify jsonRpcHandler was called with correct parameters
      expect(jsonRpcHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'test.method',
          params: {}
        }),
        undefined
      );
      
      // Verify we got the correct result
      expect(result.result).toEqual({ success: true });
    });
    
    it('handles errors with retry policy', async () => {
      const step: RequestStep = {
        name: 'retryPolicyErrorTest',
        request: {
          method: 'test.method',
          params: {},
        },
      };
      
      // Simulate a temporary failure then success
      let callCount = 0;
      jsonRpcHandler.mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          throw new ExecutionError('Temporary error', { code: ErrorCode.NETWORK_ERROR });
        }
        return { success: true };
      });
      
      // Should succeed after retries
      const result = await rpExecutor.execute(step, context);
      
      // Verify jsonRpcHandler was called multiple times
      expect(jsonRpcHandler).toHaveBeenCalledTimes(3);
      expect(result.result).toEqual({ success: true });
    });
  });
  
  describe('with circuit breaker and retry policy', () => {
    let circuitBreakerConfig: CircuitBreakerConfig;
    let retryPolicy: RetryPolicy;
    let cbRpExecutor: RequestStepExecutor;
    
    beforeEach(() => {
      // Reset the mocks
      jest.clearAllMocks();
      
      // Create configs with the correct properties
      circuitBreakerConfig = {
        failureThreshold: 3,
        recoveryTime: 5000,
        monitorWindow: 60000
      };
      
      retryPolicy = {
        maxAttempts: 3,
        retryableErrors: [ErrorCode.NETWORK_ERROR],
        backoff: {
          initial: 100,
          multiplier: 2,
          maxDelay: 5000
        }
      };
      
      // Create an executor with both circuit breaker and retry policy - using real implementation
      cbRpExecutor = new RequestStepExecutor(
        jsonRpcHandler,
        testLogger,
        retryPolicy,
        circuitBreakerConfig
      );
    });
    
    afterEach(() => {
      jest.clearAllMocks();
    });
    
    it('executes request using both circuit breaker and retry policy', async () => {
      const step: RequestStep = {
        name: 'combinedTest',
        request: {
          method: 'test.method',
          params: {},
        },
      };
      
      jsonRpcHandler.mockResolvedValue({ success: true });
      
      const result = await cbRpExecutor.execute(step, context);
      
      // Verify jsonRpcHandler was called with correct parameters
      expect(jsonRpcHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'test.method',
          params: {}
        }),
        undefined
      );
      
      // Verify we got the correct result
      expect(result.result).toEqual({ success: true });
    });
  });

  it('handles AbortError correctly', async () => {
    const step: RequestStep = {
      name: 'abortTest',
      request: {
        method: 'test.method',
        params: {},
      },
    };

    // Create an AbortError
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    
    // Mock JSON-RPC handler to throw the AbortError
    jsonRpcHandler.mockRejectedValue(abortError);

    // Expect the executor to throw an ExecutionError with TIMEOUT_ERROR code
    await expect(executor.execute(step, context)).rejects.toThrow(
      'Request step "abortTest" was aborted'
    );
  });

  it('passes signal from context to jsonRpcHandler', async () => {
    const step: RequestStep = {
      name: 'signalTest',
      request: {
        method: 'test.method',
        params: {},
      },
    };

    // Create a mock abort controller and signal
    const abortController = new AbortController();
    const contextWithSignal = {
      ...context,
      signal: abortController.signal
    };

    await executor.execute(step, contextWithSignal);

    // Verify that the signal was passed to jsonRpcHandler
    expect(jsonRpcHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'test.method'
      }),
      { signal: abortController.signal }
    );
  });

  it.only('rethrows non-JsonRpcRequestError errors from outer catch block', async () => {
    const step: RequestStep = {
      name: 'outerErrorTest',
      request: {
        method: 'test.method',
        params: {},
      },
    };
    
    // Create a custom error class that isn't JsonRpcRequestError
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'CustomError';
      }
    }
    
    // Configure executor with real circuit breaker
    const executorWithCircuitBreaker = new RequestStepExecutor(
      jsonRpcHandler,
      testLogger,
      null,
      { failureThreshold: 3, recoveryTime: 5000, monitorWindow: 60000 }
    );
    
    // Mock jsonRpcHandler to throw a custom error
    jsonRpcHandler.mockRejectedValue(new CustomError('Custom outer error'));
 
    // Execute and expect the error to be rethrown
    await expect(executorWithCircuitBreaker.execute(step, context))
      .rejects.toThrow('Failed to execute request step "outerErrorTest": Custom outer error');
         
    expect(jsonRpcHandler).toHaveBeenCalledTimes(1);
  });

  it('rethrows JsonRpcRequestError from outer catch block', async () => {
    const step: RequestStep = {
      name: 'outerJsonRpcErrorTest',
      request: {
        method: 'test.method',
        params: {},
      },
    };
    
    // Create a JsonRpcRequestError directly from the step-executors types
    const jsonRpcError = new JsonRpcRequestError('Outer JSON-RPC error occurred', {
      code: -32001,
      message: 'Outer JSON-RPC error',
    });
    
    // Create a executor with a real circuit breaker
    const testExecutor = new RequestStepExecutor(
      jsonRpcHandler,
      testLogger,
      null,
      { failureThreshold: 3, recoveryTime: 5000, monitorWindow: 60000 }
    );
    
    // Mock jsonRpcHandler to throw a JsonRpcRequestError
    jsonRpcHandler.mockRejectedValue(jsonRpcError);
    
    // The error should be rethrown directly
    try {
      await testExecutor.execute(step, context);
      fail('Expected to throw JsonRpcRequestError');
    } catch (error) {
      // Verify we got the same error instance back, unmodified
      expect(error).toBe(jsonRpcError);
      // Add type assertion
      expect((error as JsonRpcRequestError).message).toBe('Outer JSON-RPC error occurred');
      expect(error instanceof JsonRpcRequestError).toBe(true);
    }
  });
});
