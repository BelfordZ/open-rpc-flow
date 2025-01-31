import { FlowExecutor } from '../flow-executor';
import { Flow } from '../types';
import { defaultLogger, noLogger } from '../util/logger';
import { TransformStepExecutor } from '../step-executors/transform-executor';
import { EventEmitter } from 'events';

// spy on defaultLogger
const defaultLoggerSpy = jest.spyOn(defaultLogger, 'createNested');

describe('FlowExecutor', () => {
  let executor: FlowExecutor;
  let jsonRpcHandler: jest.Mock;
  let eventEmitter: EventEmitter;

  beforeEach(() => {
    jsonRpcHandler = jest.fn();
    eventEmitter = new EventEmitter();
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for unit tests',
      steps: [],
    };
    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger, eventEmitter);
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
    executor = new FlowExecutor(flow, jsonRpcHandler);
    await executor.execute();

    // expect defaultLogger to have been used
    expect(defaultLoggerSpy).toHaveBeenCalled();
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
    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger, eventEmitter);
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
    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger, eventEmitter);
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
    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger, eventEmitter);
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

    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger, eventEmitter);
    const results = await executor.execute();

    const transformResult = results.get('transform_data').result;
    expect(transformResult).toHaveLength(2);
    expect(transformResult[0].doubled).toBe(400);
    expect(transformResult[1].doubled).toBe 600);
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
    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger, eventEmitter);
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

    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger, eventEmitter);
    await expect(executor.execute()).rejects.toThrow(
      'Failed to execute step error_step: Custom error without message',
    );

    // Restore original execute method
    jest.restoreAllMocks();
  });

  it('throws error when no executor is found for step', async () => {
    const flow: Flow = {
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

    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger, eventEmitter);
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
    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger, eventEmitter);
    const results = await executor.execute();

    const conditionResult = results.get('check_condition');
    expect(conditionResult.metadata.branchTaken).toBe('else');
    expect(conditionResult.result).toBeUndefined();
    expect(jsonRpcHandler).toHaveBeenCalledTimes(0);
  });

  it('emits events for basic event emission', async () => {
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
    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger, eventEmitter);

    const stepStartedSpy = jest.fn();
    const stepCompletedSpy = jest.fn();

    eventEmitter.on('stepStarted', stepStartedSpy);
    eventEmitter.on('stepCompleted', stepCompletedSpy);

    await executor.execute();

    expect(stepStartedSpy).toHaveBeenCalledWith({
      stepName: 'get_data',
      context: expect.any(Object),
    });
    expect(stepCompletedSpy).toHaveBeenCalledWith({
      stepName: 'get_data',
      result: { success: true },
      metadata: expect.any(Object),
    });
  });

  it('emits events for detailed event emission', async () => {
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
    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger, eventEmitter);

    const loopIterationStartedSpy = jest.fn();
    const loopIterationCompletedSpy = jest.fn();

    eventEmitter.on('loopIterationStarted', loopIterationStartedSpy);
    eventEmitter.on('loopIterationCompleted', loopIterationCompletedSpy);

    await executor.execute();

    expect(loopIterationStartedSpy).toHaveBeenCalledTimes(2);
    expect(loopIterationCompletedSpy).toHaveBeenCalledTimes(2);
  });

  it('emits events based on provided options', async () => {
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

    const options = {
      stepStarted: true,
      stepCompleted: false,
    };

    jsonRpcHandler.mockResolvedValue({ success: true });
    executor = new FlowExecutor(flow, jsonRpcHandler, noLogger, eventEmitter, options);

    const stepStartedSpy = jest.fn();
    const stepCompletedSpy = jest.fn();

    eventEmitter.on('stepStarted', stepStartedSpy);
    eventEmitter.on('stepCompleted', stepCompletedSpy);

    await executor.execute();

    expect(stepStartedSpy).toHaveBeenCalledWith({
      stepName: 'get_data',
      context: expect.any(Object),
    });
    expect(stepCompletedSpy).not.toHaveBeenCalled();
  });
});
