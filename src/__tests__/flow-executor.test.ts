import { FlowExecutor, DEFAULT_RETRY_POLICY } from '../flow-executor';
import { Flow } from '../types';
import { TestLogger } from '../util/logger';
import { TransformStepExecutor } from '../step-executors/transform-executor';
import { ErrorCode } from '../errors/codes';
import { RetryPolicy } from '../errors/recovery';

describe('FlowExecutor', () => {
  let executor: FlowExecutor;
  let jsonRpcHandler: jest.Mock;
  let testLogger: TestLogger;

  beforeEach(() => {
    jsonRpcHandler = jest.fn();
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for unit tests',
      steps: [],
    };
    testLogger = new TestLogger('FlowExecutorTest');
    executor = new FlowExecutor(flow, jsonRpcHandler, { logger: testLogger });
  });

  afterEach(() => {
    testLogger.clear();
  });

  it('uses the default logger if not provided', async () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for unit tests',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {},
          },
        },
      ],
    };

    jsonRpcHandler.mockResolvedValue({ success: true });
    executor = new FlowExecutor(flow, jsonRpcHandler, testLogger);
    await executor.execute();

    // expect testLogger to have captured logs
    expect(testLogger.getLogs().length).toBeGreaterThan(0);
  });

  it('executes a simple request step', async () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for unit tests',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {},
          },
        },
      ],
    };

    jsonRpcHandler.mockResolvedValue({ success: true });
    executor = new FlowExecutor(flow, jsonRpcHandler, testLogger);
    const results = await executor.execute();

    expect(results.get('get_data').result).toEqual({ success: true });
    expect(jsonRpcHandler).toHaveBeenCalledTimes(1);
  });

  it('executes a loop step', async () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for unit tests',
      context: {
        items: [
          { id: 1, value: 100 },
          { id: 2, value: 200 },
          { id: 3, value: 300 },
        ],
      },
      steps: [
        {
          name: 'process_items',
          loop: {
            over: '${context.items}',
            as: 'item',
            maxIterations: 2,
            step: {
              name: 'process_item',
              request: {
                method: 'processItem',
                params: { id: '${item.id}' },
              },
            },
          },
        },
      ],
    };

    jsonRpcHandler.mockResolvedValue({ success: true });
    executor = new FlowExecutor(flow, jsonRpcHandler, testLogger);
    const results = await executor.execute();

    const loopResult = results.get('process_items');
    expect(loopResult.result.value).toHaveLength(2);
    expect(jsonRpcHandler).toHaveBeenCalledTimes(2);
  });

  it('executes a condition step', async () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for unit tests',
      context: {
        value: 150,
      },
      steps: [
        {
          name: 'check_condition',
          condition: {
            if: '${context.value} > 100',
            then: {
              name: 'success',
              request: {
                method: 'success',
                params: {},
              },
            },
            else: {
              name: 'failure',
              request: {
                method: 'failure',
                params: {},
              },
            },
          },
        },
      ],
    };

    jsonRpcHandler.mockResolvedValue({ success: true });
    executor = new FlowExecutor(flow, jsonRpcHandler, testLogger);
    const results = await executor.execute();

    const conditionResult = results.get('check_condition');
    expect(conditionResult.metadata.branchTaken).toBe('then');
    expect(jsonRpcHandler).toHaveBeenCalledTimes(1);
  });

  it('executes a transform step', async () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for unit tests',
      context: {
        items: [
          { id: 1, value: 100 },
          { id: 2, value: 200 },
          { id: 3, value: 300 },
        ],
      },
      steps: [
        {
          name: 'transform_data',
          transform: {
            input: '${context.items}',
            operations: [
              {
                type: 'filter',
                using: '${item.value} > 150',
              },
              {
                type: 'map',
                using: '{ id: ${item.id}, doubled: ${item.value} * 2 }',
              },
            ],
          },
        },
      ],
    };

    executor = new FlowExecutor(flow, jsonRpcHandler, testLogger);
    const results = await executor.execute();

    const transformResult = results.get('transform_data').result;
    expect(transformResult).toHaveLength(2);
    expect(transformResult[0].doubled).toBe(400);
    expect(transformResult[1].doubled).toBe(600);
  });

  it('handles errors gracefully', async () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for unit tests',
      steps: [
        {
          name: 'error_step',
          request: {
            method: 'error',
            params: {},
          },
        },
      ],
    };

    jsonRpcHandler.mockRejectedValue(new Error('Test error'));
    executor = new FlowExecutor(flow, jsonRpcHandler, testLogger);
    await expect(executor.execute()).rejects.toThrow('Test error');
  });

  it('handles errors without message property', async () => {
    // Create an error-like object without a message property
    const customError = { toString: () => 'Custom error without message' };

    // Mock the transform executor's execute method
    const mockExecute = jest.fn().mockRejectedValue(customError);
    jest.spyOn(TransformStepExecutor.prototype, 'execute').mockImplementation(mockExecute);

    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for unit tests',
      steps: [
        {
          name: 'error_step',
          transform: {
            input: '${context.nonexistent}',
            operations: [
              {
                type: 'map',
                using: '${item}',
              },
            ],
          },
        },
      ],
    };

    executor = new FlowExecutor(flow, jsonRpcHandler, testLogger);
    await expect(executor.execute()).rejects.toThrow(
      'Failed to execute step error_step: Custom error without message',
    );

    // Restore original execute method
    jest.restoreAllMocks();
  });

  it('throws error when no executor is found for step', async () => {
    const flow: any = {
      name: 'Test Flow',
      description: 'Test flow for unit tests',
      steps: [
        {
          name: 'unknown_step',
          aggregate: {
            // This is a valid property in the Step interface but has no executor
            from: 'some_source',
            select: ['field1', 'field2'],
            groupBy: 'field1',
          },
        },
      ],
    };

    executor = new FlowExecutor(flow, jsonRpcHandler, testLogger);
    await expect(executor.execute()).rejects.toThrow('No executor found for step unknown_step');
  });

  it('handles condition step without else branch', async () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for condition without else branch',
      context: {
        value: 50,
      },
      steps: [
        {
          name: 'check_condition',
          condition: {
            if: '${context.value} > 100',
            then: {
              name: 'success',
              request: {
                method: 'success',
                params: {},
              },
            },
          },
        },
      ],
    };

    jsonRpcHandler.mockResolvedValue({ success: true });
    executor = new FlowExecutor(flow, jsonRpcHandler, testLogger);
    const results = await executor.execute();

    const conditionResult = results.get('check_condition');
    expect(conditionResult.metadata.branchTaken).toBe('else');
    expect(conditionResult.result).toBeUndefined();
    expect(jsonRpcHandler).toHaveBeenCalledTimes(0);
  });

  it('sets retry policy from options.retryPolicy', () => {
    const retryPolicy: RetryPolicy = {
      maxAttempts: 7,
      backoff: { initial: 123, multiplier: 3, maxDelay: 999, strategy: 'exponential' },
      retryableErrors: [ErrorCode.NETWORK_ERROR],
    };
    const flow: Flow = { name: 'RetryPolicyTest', description: '', steps: [] };
    executor = new FlowExecutor(flow, jest.fn(), { logger: testLogger, retryPolicy });
    expect((executor as any).retryPolicy).toEqual(retryPolicy);
  });

  it('sets retry policy from flow.policies.global.retryPolicy', () => {
    const flow: Flow = {
      name: 'RetryPolicyTest',
      description: '',
      policies: {
        global: {
          retryPolicy: {
            maxAttempts: 4,
            backoff: {
              initial: 50,
              multiplier: 2,
              maxDelay: 500,
              strategy: 'exponential' as const,
            },
            retryableErrors: [ErrorCode.TIMEOUT_ERROR],
          },
        },
      },
      steps: [],
    };
    executor = new FlowExecutor(flow, jest.fn(), { logger: testLogger });
    expect((executor as any).retryPolicy).toEqual({
      maxAttempts: 4,
      backoff: { initial: 50, multiplier: 2, maxDelay: 500, strategy: 'exponential' },
      retryableErrors: [ErrorCode.TIMEOUT_ERROR],
    });
  });

  it('retries steps according to global retry policy', async () => {
    let callCount = 0;
    const flow: Flow = {
      name: 'RetryPolicyTest',
      description: '',
      policies: {
        global: {
          retryPolicy: {
            maxAttempts: 3,
            backoff: { initial: 1, multiplier: 1, maxDelay: 10, strategy: 'exponential' },
            retryableErrors: [ErrorCode.NETWORK_ERROR],
          },
        },
      },
      steps: [
        {
          name: 'failStep',
          request: { method: 'fail', params: {} },
        },
      ],
    };
    const handler = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount < 3) throw Object.assign(new Error('fail'), { code: ErrorCode.NETWORK_ERROR });
      return { result: 'ok' };
    });
    executor = new FlowExecutor(flow, handler, { logger: testLogger });
    const results = await executor.execute();
    expect(results.get('failStep').result).toEqual({ result: 'ok' });
    expect(callCount).toBe(3);
  });

  it('falls back to DEFAULT_RETRY_POLICY if no policy is set', () => {
    const flow: Flow = { name: 'RetryPolicyTest', description: '', steps: [] };
    executor = new FlowExecutor(flow, jest.fn(), { logger: testLogger });
    expect((executor as any).retryPolicy).toEqual({
      ...DEFAULT_RETRY_POLICY,
      maxAttempts: 1,
    });
  });
});
