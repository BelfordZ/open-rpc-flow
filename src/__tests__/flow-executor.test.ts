import { FlowExecutor } from '../flow-executor';
import { StepExecutionContext, StepType } from '../step-executors/types';
import { Flow, JsonRpcRequest } from '../types';
import { createMockContext } from './test-utils';
import { noLogger } from '../util/logger';

describe('FlowExecutor', () => {
  let executor: FlowExecutor;
  let jsonRpcHandler: jest.Mock;

  beforeEach(() => {
    jsonRpcHandler = jest.fn();
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for unit tests',
      steps: [],
    };
    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger);
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
    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger);
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
    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger);
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
    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger);
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
                using: 'item.value > 150',
              },
              {
                type: 'map',
                using: '{ id: item.id, doubled: item.value * 2 }',
              },
            ],
          },
        },
      ],
    };

    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger);
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
    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger);
    await expect(executor.execute()).rejects.toThrow('Test error');
  });
});
