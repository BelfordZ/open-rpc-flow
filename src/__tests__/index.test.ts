import { Flow, FlowExecutor, JsonRpcRequest } from '../index';
import { StepType } from '../step-executors/types';
import { TestLogger, noLogger } from '../util/logger';

const testLogger = new TestLogger('FlowExecutorTest');

describe('FlowExecutor', () => {
  let mockJsonRpcHandler: jest.Mock;

  beforeEach(() => {
    mockJsonRpcHandler = jest.fn(async (request: JsonRpcRequest) => {
      switch (request.method) {
        case 'return_params0':
          return {
            item: (request.params as { item: any }).item,
          };
        case 'getData':
          return {
            items: [
              { id: 1, name: 'Item 1', value: 100 },
              { id: 2, name: 'Item 2', value: 200 },
              { id: 3, name: 'Item 3', value: 300 },
            ],
          };
        case 'processItem':
          return {
            processed: true,
            itemId: (request.params as { id: number }).id,
          };
        case 'return_string':
          return { result: 'foo' };
        default:
          return { result: 'default' };
      }
    });
  });

  afterEach(() => {
    //testLogger.print();
    testLogger.clear();
  });

  it('executes a simple request step', async () => {
    const flow: Flow = {
      name: 'Simple Request',
      description: 'Test simple request execution',
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

    const executor = new FlowExecutor(flow, mockJsonRpcHandler, noLogger);
    const results = await executor.execute();

    expect(mockJsonRpcHandler).toHaveBeenCalledTimes(1);
    expect(results.get('get_data')).toEqual({
      result: {
        items: [
          { id: 1, name: 'Item 1', value: 100 },
          { id: 2, name: 'Item 2', value: 200 },
          { id: 3, name: 'Item 3', value: 300 },
        ],
      },
      type: 'request',
      metadata: expect.any(Object),
    });
  });

  it('executes a loop with request', async () => {
    const flow: Flow = {
      name: 'Loop Test',
      description: 'Test loop execution with requests',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {},
          },
        },
        {
          name: 'process_items',
          loop: {
            over: '${get_data.result.items}',
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

    const executor = new FlowExecutor(flow, mockJsonRpcHandler, noLogger);
    const results = await executor.execute();

    expect(mockJsonRpcHandler).toHaveBeenCalledTimes(3); // 1 getData + 2 processItem (limited by maxIterations)
    const processResults = results.get('process_items');
    expect(Array.isArray(processResults.result.value)).toBeTruthy();
    expect(processResults.result.value).toHaveLength(2);
    expect(processResults.type).toBe(StepType.Loop);
    expect(processResults.result.value).toEqual([
      {
        type: 'request',
        result: { processed: true, itemId: 1 },
        metadata: expect.any(Object),
      },
      {
        type: 'request',
        result: { processed: true, itemId: 2 },
        metadata: expect.any(Object),
      },
    ]);
  });

  it('executes conditional steps', async () => {
    const flow: Flow = {
      name: 'Conditional Test',
      description: 'Test conditional execution',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {},
          },
        },
        {
          name: 'check_items',
          condition: {
            if: '${get_data.result.items.length} > 0',
            then: {
              name: 'process_success',
              request: {
                method: 'success',
                params: {},
              },
            },
            else: {
              name: 'process_failure',
              request: {
                method: 'failure',
                params: {},
              },
            },
          },
        },
      ],
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler, noLogger);
    const results = await executor.execute();

    expect(mockJsonRpcHandler).toHaveBeenCalledTimes(2);
    const conditionResult = results.get('check_items');
    expect(conditionResult).toBeDefined();
    expect(conditionResult.metadata.branchTaken).toBe('then');
    expect(conditionResult.result).toEqual({
      type: 'request',
      result: { result: 'default' },
      metadata: expect.any(Object),
    });
  });

  it('executes aggregate operations', async () => {
    const flow: Flow = {
      name: 'Aggregate Test',
      description: 'Test aggregation operations',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {},
          },
        },
        {
          name: 'select_fields',
          transform: {
            input: '${get_data.result.items}',
            operations: [
              {
                type: 'map',
                using: '{ id: ${item.id}, value: ${item.value} }',
              },
            ],
          },
        },
        {
          name: 'group_by_value',
          transform: {
            input: '${get_data.result.items}',
            operations: [
              {
                type: 'group',
                using: '${item.value}',
              },
              {
                type: 'sort',
                using: '${a.key} - ${b.key}',
              },
            ],
          },
        },
      ],
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler, noLogger);
    const results = await executor.execute();

    expect(results.get('select_fields').result).toEqual([
      { id: 1, value: 100 },
      { id: 2, value: 200 },
      { id: 3, value: 300 },
    ]);

    const groupedResults = results.get('group_by_value').result;
    expect(groupedResults).toHaveLength(3);
    expect(groupedResults[0]).toEqual({
      key: 100,
      items: [{ id: 1, name: 'Item 1', value: 100 }],
    });
    expect(groupedResults[1]).toEqual({
      key: 200,
      items: [{ id: 2, name: 'Item 2', value: 200 }],
    });
    expect(groupedResults[2]).toEqual({
      key: 300,
      items: [{ id: 3, name: 'Item 3', value: 300 }],
    });
  });

  it('executes transform operations', async () => {
    const flow: Flow = {
      name: 'Transform Test',
      description: 'Test transform operations',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {},
          },
        },
        {
          name: 'transform_data',
          transform: {
            input: '${get_data.result.items}',
            operations: [
              {
                type: 'filter',
                using: '${item.value} > 150',
              },
              {
                type: 'map',
                using: '{ id: ${item.id}, doubled: ${item.value} * 2 }',
              },
              {
                type: 'sort',
                using: '${a.doubled} - ${b.doubled}',
              },
            ],
          },
        },
      ],
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler, noLogger);
    const results = await executor.execute();

    const transformedData = results.get('transform_data');
    expect(transformedData.result).toHaveLength(2);
    expect(transformedData.result[0].doubled).toBeLessThan(transformedData.result[1].doubled);
    expect(transformedData.result.every((item: any) => item.doubled > 300)).toBeTruthy();
    expect(transformedData.type).toBe(StepType.Transform);
  });

  it('handles context variables', async () => {
    const flow: Flow = {
      name: 'Context Test',
      description: 'Test context usage',
      context: {
        threshold: 150,
      },
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {},
          },
        },
        {
          name: 'filter_by_context',
          transform: {
            input: '${get_data.result.items}',
            operations: [
              {
                type: 'filter',
                using: '${item.value} > ${context.threshold}',
              },
            ],
          },
        },
      ],
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler, noLogger);
    const results = await executor.execute();

    const filteredData = results.get('filter_by_context');
    expect(filteredData.result).toHaveLength(2);
    expect(filteredData.result.every((item: any) => item.value > 150)).toBeTruthy();
    expect(filteredData.type).toBe(StepType.Transform);
  });

  it('handles reference resolution errors', async () => {
    const flow: Flow = {
      name: 'Error Test',
      description: 'Test error handling',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {},
          },
        },
        {
          name: 'invalid_reference',
          transform: {
            input: '${get_data.nonexistent}',
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

    const executor = new FlowExecutor(flow, mockJsonRpcHandler, noLogger);
    await expect(executor.execute()).rejects.toThrow('Cannot access property');
  });

  it('executes nested loops', async () => {
    const flow: Flow = {
      name: 'Nested Loop Test',
      description: 'Test nested loop execution',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {},
          },
        },
        {
          name: 'nested_process',
          loop: {
            over: '${get_data.result.items}',
            as: 'outer_item',
            maxIterations: 2,
            step: {
              name: 'inner_loop',
              loop: {
                over: '${get_data.result.items}',
                as: 'inner_item',
                maxIterations: 2,
                step: {
                  name: 'process_pair',
                  request: {
                    method: 'processItem',
                    params: {
                      outer_id: '${outer_item.id}',
                      inner_id: '${inner_item.id}',
                    },
                  },
                },
              },
            },
          },
        },
      ],
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler, noLogger);
    const results = await executor.execute();

    expect(mockJsonRpcHandler).toHaveBeenCalledTimes(5); // 1 getData + (2 outer * 2 inner)
    const nestedResults = results.get('nested_process');
    expect(nestedResults.result.value).toHaveLength(2); // Limited by outer maxIterations
    expect(nestedResults.result.value[0].result.value).toHaveLength(2); // Limited by inner maxIterations
    expect(nestedResults.result.value[1].result.value).toHaveLength(2);
    expect(nestedResults.type).toBe(StepType.Loop);
  });

  it('handles complex conditional nesting', async () => {
    const flow: Flow = {
      name: 'Complex Conditional Test',
      description: 'Test complex conditional nesting',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {},
          },
        },
        {
          name: 'nested_condition',
          condition: {
            if: '${get_data.result.items.length} > 0',
            then: {
              name: 'inner_condition',
              condition: {
                if: '${get_data.result.items[0].value} > 150',
                then: {
                  name: 'high_value_process',
                  request: {
                    method: 'processItem',
                    params: { id: '${get_data.result.items[0].id}' },
                  },
                },
                else: {
                  name: 'low_value_process',
                  request: {
                    method: 'processItem',
                    params: { id: -1 },
                  },
                },
              },
            },
            else: {
              name: 'no_data_process',
              request: {
                method: 'processItem',
                params: { id: 0 },
              },
            },
          },
        },
      ],
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler, noLogger);
    const results = await executor.execute();

    expect(mockJsonRpcHandler).toHaveBeenCalledTimes(2); // getData + processItem
    const conditionResult = results.get('nested_condition');
    expect(conditionResult).toBeDefined();
    expect(conditionResult.metadata.branchTaken).toBe('then');
    expect(conditionResult.result).toEqual({
      type: 'condition',
      result: {
        type: 'request',
        result: { processed: true, itemId: -1 },
        metadata: expect.any(Object),
      },
      metadata: {
        branchTaken: 'else',
        conditionValue: false,
        condition: '${get_data.result.items[0].value} > 150',
        timestamp: expect.any(String),
      },
    });
  });

  it('handles transform operation errors gracefully', async () => {
    const flow: Flow = {
      name: 'Transform Error Test',
      description: 'Test transform error handling',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {},
          },
        },
        {
          name: 'transform_with_error',
          transform: {
            input: '${get_data.result.items}',
            operations: [
              {
                type: 'map',
                using: '${item.nonexistent.property}',
              },
            ],
          },
        },
      ],
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler, testLogger);
    await expect(executor.execute()).rejects.toThrow();
  });

  it('handles a couple steps with their refs when the ref is a string', async () => {
    const flow: Flow = {
      name: 'Ref Test',
      description: 'Test ref handling',
      steps: [
        {
          name: 'step1',
          request: {
            method: 'return_string',
            params: {},
          },
        },
        {
          name: 'step2',
          request: {
            method: 'return_params0',
            params: {
              item: 'foo ${step1.result.result}',
            },
          },
        },
      ],
    };
    const executor = new FlowExecutor(flow, mockJsonRpcHandler, noLogger);
    const results = await executor.execute();
    console.log(results);
    expect(results.get('step1').result.result).toEqual('foo');
    expect(results.get('step2').result).toEqual({
      item: 'foo foo',
    });
  });

  it('handles a couple steps with their refs', async () => {
    const flow: Flow = {
      name: 'Ref Test',
      description: 'Test ref handling',
      steps: [
        {
          name: 'step1',
          request: {
            method: 'getData',
            params: {},
          },
        },
        {
          name: 'step2',
          request: {
            method: 'return_params0',
            params: {
              item: 'foo ${step1.result.items[0]}',
            },
          },
        },
      ],
    };
    const executor = new FlowExecutor(flow, mockJsonRpcHandler, noLogger);
    const results = await executor.execute();
    expect(results.get('step1').result).toEqual({
      items: [
        { id: 1, name: 'Item 1', value: 100 },
        { id: 2, name: 'Item 2', value: 200 },
        { id: 3, name: 'Item 3', value: 300 },
      ],
    });
    expect(results.get('step2').result).toEqual({
      item: 'foo ' + JSON.stringify({ id: 1, name: 'Item 1', value: 100 }),
    });
  });
});
