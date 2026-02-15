import { StepExecutionContext, Step } from '../../types';
import { JsonRpcRequestError } from '../../step-executors/types';
import { createMockContext } from '../test-utils';
import { TestLogger } from '../../util/logger';
import { ErrorCode } from '../../errors/codes';
import { ExecutionError } from '../../errors/base';
import { RequestStepExecutor } from '../../step-executors';
import { PolicyResolver } from '../../util/policy-resolver';

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
    const flow = { name: 'test', description: '', steps: [] };
    const policyResolver = new PolicyResolver(flow, testLogger);
    executor = new RequestStepExecutor(jsonRpcHandler, testLogger, policyResolver);
    context = createMockContext();
  });

  afterEach(() => {
    jest.clearAllMocks();
    //testLogger.print();
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
    expect(result.result).toEqual(['foo', 'bar']);
    expect(jsonRpcHandler).toHaveBeenCalledTimes(1);
    expect(jsonRpcHandler).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        method: 'permissions.get',
        params: expect.objectContaining({
          userId: 1,
          role: 'admin',
        }),
        id: expect.any(Number),
      },
      expect.anything(),
    );
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

    expect(jsonRpcHandler).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        method: 'test.method',
        params: {
          value: 'test',
        },
        id: expect.any(Number),
      },
      expect.anything(),
    );
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

    expect(jsonRpcHandler).toHaveBeenCalledWith(
      {
        jsonrpc: '2.0',
        method: 'test.method',
        params: ['first', 'second'],
        id: expect.any(Number),
      },
      expect.anything(),
    );
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

    const warnLogs = testLogger.getLogs().filter((l) => l.level === 'warn');
    expect(warnLogs.length).toBeGreaterThan(0);
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

  describe('with retry policy', () => {
    let rpExecutor: RequestStepExecutor;

    beforeEach(() => {
      jest.clearAllMocks();
      // Create a flow with a global retry policy
      const flow: any = {
        name: 'test',
        description: '',
        steps: [],
        policies: {
          global: {
            retryPolicy: {
              maxAttempts: 3,
              retryableErrors: [ErrorCode.NETWORK_ERROR],
              backoff: {
                initial: 100,
                multiplier: 2,
                maxDelay: 5000,
                strategy: 'exponential',
              },
            },
          },
        },
      };
      const policyResolver = new PolicyResolver(flow, testLogger);
      rpExecutor = new RequestStepExecutor(jsonRpcHandler, testLogger, policyResolver);
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    it('executes request using retry policy', async () => {
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
          params: {},
        }),
        expect.anything(),
      );

      // Verify we got the correct result
      expect(result.result).toEqual({ success: true });
    });

    it('uses step-level policies.retryPolicy when available', async () => {
      const stepWithPolicies: RequestStep = {
        name: 'stepWithPolicies',
        request: {
          method: 'test.method',
          params: {},
        },
        policies: {
          retryPolicy: {
            maxAttempts: 5,
            backoff: {
              initial: 50,
              multiplier: 3,
              maxDelay: 2000,
              strategy: 'linear',
            },
            retryableErrors: [ErrorCode.NETWORK_ERROR, ErrorCode.VALIDATION_ERROR],
          },
        },
      };

      // Mock implementation to fail a few times
      let callCount = 0;
      jsonRpcHandler.mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          throw new ExecutionError('Temporary error', { code: ErrorCode.NETWORK_ERROR });
        }
        return { success: true };
      });

      // Execute with step-level policies
      const result = await rpExecutor.execute(stepWithPolicies, context);

      // Verify correct backoff was used (captured by logger)
      expect(
        testLogger
          .getLogsAs<{ backoffStrategy?: string }>()
          .some(
            (log) =>
              log.message === 'Starting retryable operation' &&
              log.data?.backoffStrategy === 'linear',
          ),
      ).toBeTruthy();

      // Verify success after retries
      expect(result.result).toEqual({ success: true });
      expect(jsonRpcHandler).toHaveBeenCalledTimes(3);
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

    // Expect the executor to throw a timeout error with the expected message pattern
    await expect(executor.execute(step, context)).rejects.toThrow(
      /Step "abortTest" execution timed out after \d+ms/,
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
      signal: abortController.signal,
    };

    await executor.execute(step, contextWithSignal);

    // Verify that the signal was passed to jsonRpcHandler
    const [, options] = jsonRpcHandler.mock.calls[0];
    const handlerSignal = options?.signal;
    expect(handlerSignal).toBeDefined();
    abortController.abort('test-abort');
    expect(handlerSignal?.aborted).toBe(true);
  });

  it('uses passed signal when no context signal', async () => {
    const step: RequestStep = {
      name: 'signalArgTest',
      request: { method: 'test.method', params: {} },
    };
    const ac = new AbortController();
    await executor.execute(step, context, {}, ac.signal);
    const [, options] = jsonRpcHandler.mock.calls[0];
    const handlerSignal = options?.signal;
    expect(handlerSignal).toBeDefined();
    ac.abort('test-abort');
    expect(handlerSignal?.aborted).toBe(true);
  });

  it('prefers context signal over passed signal', async () => {
    const step: RequestStep = {
      name: 'signalPrecedence',
      request: { method: 'test.method', params: {} },
    };
    const ctxAC = new AbortController();
    const argAC = new AbortController();
    const ctx = { ...context, signal: ctxAC.signal };
    await executor.execute(step, ctx, {}, argAC.signal);
    const [, options] = jsonRpcHandler.mock.calls[0];
    const handlerSignal = options?.signal;
    expect(handlerSignal).toBeDefined();
    ctxAC.abort('test-abort');
    expect(handlerSignal?.aborted).toBe(true);
  });

  it('uses context signal directly when timeout is disabled', async () => {
    const step: RequestStep = {
      name: 'signalNoTimeout',
      request: { method: 'test.method', params: {} },
      policies: { timeout: { timeout: 0 } },
    };
    const ctxAC = new AbortController();
    const ctx = { ...context, signal: ctxAC.signal };
    await executor.execute(step, ctx);
    const [, options] = jsonRpcHandler.mock.calls[0];
    expect(options?.signal).toBe(ctxAC.signal);
  });

  it('propagates an already aborted context signal to the handler signal', async () => {
    const step: RequestStep = {
      name: 'signalAlreadyAborted',
      request: { method: 'test.method', params: {} },
    };
    const ctxAC = new AbortController();
    ctxAC.abort('pre-aborted');
    const ctx = { ...context, signal: ctxAC.signal };
    jsonRpcHandler.mockResolvedValue({ ok: true });
    await executor.execute(step, ctx);
    const [, options] = jsonRpcHandler.mock.calls[0];
    expect(options?.signal?.aborted).toBe(true);
  });

  it('returns a timeout error when handler rejects after timeout abort', async () => {
    jest.useFakeTimers();
    const step: RequestStep = {
      name: 'timeoutRejectTest',
      request: { method: 'test.method', params: {} },
      policies: { timeout: { timeout: 50 } },
    };
    jsonRpcHandler.mockImplementation((_req, options) => {
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    });
    const promise = executor.execute(step, context);
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    await expect(promise).rejects.toThrow(/execution timed out/);
    jest.useRealTimers();
  });

  it('times out when handler does not respond in time', async () => {
    jest.useFakeTimers();
    const step: RequestStep = {
      name: 'timeoutTest',
      request: { method: 'test.method', params: {} },
      policies: { timeout: { timeout: 100 } },
    };
    jsonRpcHandler.mockImplementation(() => new Promise(() => {}));
    const promise = executor.execute(step, context);
    jest.advanceTimersByTime(200);
    await Promise.resolve();
    await expect(promise).rejects.toThrow(/execution timed out/);
    jest.useRealTimers();
  });

  it('handles custom errors properly', async () => {
    const step: RequestStep = {
      name: 'errorTest',
      request: {
        method: 'test.method',
        params: {},
      },
    };

    // Create a custom error
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'CustomError';
      }
    }

    // Mock jsonRpcHandler to throw a custom error
    jsonRpcHandler.mockRejectedValue(new CustomError('Custom error'));

    // Execute and expect the error to be rethrown as an ExecutionError
    await expect(executor.execute(step, context)).rejects.toThrow(
      'Failed to execute request step "errorTest": Custom error',
    );

    expect(jsonRpcHandler).toHaveBeenCalledTimes(1);
  });

  it('rethrows JsonRpcRequestError directly', async () => {
    const step: RequestStep = {
      name: 'jsonRpcErrorTest',
      request: {
        method: 'test.method',
        params: {},
      },
    };

    // Create a JsonRpcRequestError
    const jsonRpcError = new JsonRpcRequestError('JSON-RPC error occurred', {
      code: -32001,
      message: 'JSON-RPC error',
    });

    // Mock jsonRpcHandler to throw a JsonRpcRequestError
    jsonRpcHandler.mockRejectedValue(jsonRpcError);

    // The error should be rethrown directly
    try {
      await executor.execute(step, context);
      fail('Expected to throw JsonRpcRequestError');
    } catch (error) {
      // Verify we got the same error instance back, unmodified
      expect(error).toBe(jsonRpcError);
      // Add type assertion
      expect((error as JsonRpcRequestError).message).toBe('JSON-RPC error occurred');
      expect(error instanceof JsonRpcRequestError).toBe(true);
    }
  });
});
