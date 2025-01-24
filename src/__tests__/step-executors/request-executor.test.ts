import { RequestStepExecutor, JsonRpcRequestError } from '../../step-executors';
import { StepExecutionContext, Step } from '../../types';
import { createMockContext } from '../test-utils';
import { noLogger } from '../../util/logger';

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

  beforeEach(() => {
    jsonRpcHandler = jest.fn();
    executor = new RequestStepExecutor(jsonRpcHandler, noLogger);
    context = createMockContext();
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
    jsonRpcHandler.mockResolvedValue(['read', 'write']);
    await executor.execute(step, context);

    expect(jsonRpcHandler).toHaveBeenCalledWith({
      jsonrpc: '2.0',
      method: 'permissions.get',
      params: {
        userId: 1,
        role: 'admin',
      },
      id: expect.any(Number),
    });
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
    });
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
    });
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
});
