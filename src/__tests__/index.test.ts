import { Flow, FlowExecutor, JsonRpcRequest } from '../index';

describe('FlowExecutor', () => {
  // Mock JSON-RPC handler that simulates different responses based on method
  const mockJsonRpcHandler = jest.fn(async (request: JsonRpcRequest) => {
    switch (request.method) {
      case 'getData':
        return {
          items: [
            { id: 1, name: 'Item 1', value: 100 },
            { id: 2, name: 'Item 2', value: 200 },
            { id: 3, name: 'Item 3', value: 300 },
          ]
        };
      case 'processItem':
        const params = request.params as { id: number };
        return {
          processed: true,
          itemId: params.id
        };
      default:
        return { result: 'default' };
    }
  });

  beforeEach(() => {
    mockJsonRpcHandler.mockClear();
  });

  test('executes a simple request step', async () => {
    const flow: Flow = {
      name: 'Simple Request',
      description: 'Test simple request execution',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {}
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler);
    const results = await executor.execute();

    expect(mockJsonRpcHandler).toHaveBeenCalledTimes(1);
    expect(results.get('get_data')).toEqual({
      items: [
        { id: 1, name: 'Item 1', value: 100 },
        { id: 2, name: 'Item 2', value: 200 },
        { id: 3, name: 'Item 3', value: 300 },
      ]
    });
  });

  test('executes a loop with request', async () => {
    const flow: Flow = {
      name: 'Loop Test',
      description: 'Test loop execution with requests',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {}
          }
        },
        {
          name: 'process_items',
          loop: {
            over: '${get_data.items}',
            as: 'item',
            maxIterations: 2,
            step: {
              name: 'process_item',
              request: {
                method: 'processItem',
                params: { id: '${item.id}' }
              }
            }
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler);
    const results = await executor.execute();

    expect(mockJsonRpcHandler).toHaveBeenCalledTimes(4); // 1 getData + 3 processItem (limited by maxIterations)
    const processResults = results.get('process_items');
    expect(Array.isArray(processResults.value)).toBeTruthy();
    expect(processResults.value).toHaveLength(2);
    expect(processResults.value).toEqual([
      { processed: true, itemId: undefined },
      { processed: true, itemId: undefined }
    ]);
  });

  test('executes conditional steps', async () => {
    const flow: Flow = {
      name: 'Conditional Test',
      description: 'Test conditional execution',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {}
          }
        },
        {
          name: 'check_items',
          condition: {
            if: '${get_data.items.length > 2}',
            then: {
              name: 'process_success',
              request: {
                method: 'success',
                params: {}
              }
            },
            else: {
              name: 'process_failure',
              request: {
                method: 'failure',
                params: {}
              }
            }
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler);
    const results = await executor.execute();

    expect(mockJsonRpcHandler).toHaveBeenCalledTimes(2);
    const conditionResult = results.get('check_items');
    expect(conditionResult).toBeDefined();
    expect(conditionResult.branchTaken).toBe('then');
    expect(conditionResult.value.result).toEqual({ result: 'default' });
  });

  test('executes aggregate operations', async () => {
    const flow: Flow = {
      name: 'Aggregate Test',
      description: 'Test aggregation operations',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {}
          }
        },
        {
          name: 'select_fields',
          transform: {
            input: '${get_data.items}',
            operations: [
              {
                type: 'map',
                using: '{ id: item.id, value: item.value }'
              }
            ]
          }
        },
        {
          name: 'group_by_value',
          transform: {
            input: '${get_data.items}',
            operations: [
              {
                type: 'group',
                using: 'item.value'
              },
              {
                type: 'filter',
                using: 'group.length >= 1'
              }
            ]
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler);
    const results = await executor.execute();

    expect(results.get('select_fields').value).toEqual([
      { id: 1, value: 100 },
      { id: 2, value: 200 },
      { id: 3, value: 300 }
    ]);

    const groupedResults = results.get('group_by_value').value;
    expect(Object.keys(groupedResults)).toHaveLength(3);
    expect(groupedResults['100']).toHaveLength(1);
  });

  test('executes transform operations', async () => {
    const flow: Flow = {
      name: 'Transform Test',
      description: 'Test transform operations',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {}
          }
        },
        {
          name: 'transform_data',
          transform: {
            input: '${get_data.items}',
            operations: [
              {
                type: 'filter',
                using: 'item.value > 150'
              },
              {
                type: 'map',
                using: '{ id: item.id, doubled: item.value * 2 }'
              },
              {
                type: 'sort',
                using: 'a.doubled - b.doubled'
              }
            ]
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler);
    const results = await executor.execute();

    const transformedData = results.get('transform_data');
    expect(transformedData).toHaveLength(2);
    expect(transformedData[0].doubled).toBeLessThan(transformedData[1].doubled);
    expect(transformedData.every((item: any) => item.doubled > 300)).toBeTruthy();
  });

  test('handles context variables', async () => {
    const flow: Flow = {
      name: 'Context Test',
      description: 'Test context usage',
      context: {
        threshold: 150
      },
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {}
          }
        },
        {
          name: 'filter_by_context',
          transform: {
            input: '${get_data.items}',
            operations: [
              {
                type: 'filter',
                using: 'item.value > ${context.threshold}'
              }
            ]
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler);
    const results = await executor.execute();

    const filteredData = results.get('filter_by_context');
    expect(filteredData).toHaveLength(2);
    expect(filteredData.every((item: any) => item.value > 150)).toBeTruthy();
  });

  test('handles reference resolution errors', async () => {
    const flow: Flow = {
      name: 'Error Test',
      description: 'Test error handling',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {}
          }
        },
        {
          name: 'invalid_reference',
          transform: {
            input: '${get_data.nonexistent}',
            operations: [
              {
                type: 'map',
                using: 'item'
              }
            ]
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler);
    await expect(executor.execute()).rejects.toThrow('Invalid reference: get_data.nonexistent');
  });

  test('executes nested loops', async () => {
    const flow: Flow = {
      name: 'Nested Loop Test',
      description: 'Test nested loop execution',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {}
          }
        },
        {
          name: 'nested_process',
          loop: {
            over: '${get_data.items}',
            as: 'outer_item',
            maxIterations: 2,
            step: {
              name: 'inner_loop',
              loop: {
                over: '${get_data.items}',
                as: 'inner_item',
                maxIterations: 2,
                step: {
                  name: 'process_pair',
                  request: {
                    method: 'processItem',
                    params: { 
                      outer_id: '${outer_item.id}',
                      inner_id: '${inner_item.id}'
                    }
                  }
                }
              }
            }
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler);
    const results = await executor.execute();

    expect(mockJsonRpcHandler).toHaveBeenCalledTimes(5); // 1 getData + (2 outer * 2 inner)
    const nestedResults = results.get('nested_process');
    expect(nestedResults.value).toHaveLength(2); // Limited by outer maxIterations
    expect(nestedResults.value[0].value).toHaveLength(2); // Limited by inner maxIterations
    expect(nestedResults.value[1].value).toHaveLength(2);
  });

  test('handles complex conditional nesting', async () => {
    const flow: Flow = {
      name: 'Complex Conditional Test',
      description: 'Test complex conditional nesting',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {}
          }
        },
        {
          name: 'nested_condition',
          condition: {
            if: '${get_data.items.length > 0}',
            then: {
              name: 'inner_condition',
              condition: {
                if: '${get_data.items[0].value > 150}',
                then: {
                  name: 'high_value_process',
                  request: {
                    method: 'processItem',
                    params: { id: '${get_data.items[0].id}' }
                  }
                },
                else: {
                  name: 'low_value_process',
                  request: {
                    method: 'processItem',
                    params: { id: -1 }
                  }
                }
              }
            },
            else: {
              name: 'no_data_process',
              request: {
                method: 'processItem',
                params: { id: 0 }
              }
            }
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler);
    const results = await executor.execute();

    expect(mockJsonRpcHandler).toHaveBeenCalledTimes(2); // getData + processItem
    const conditionResult = results.get('nested_condition');
    expect(conditionResult).toBeDefined();
    expect(conditionResult.branchTaken).toBe('then');
    expect(conditionResult.value.branchTaken).toBe('else'); // First item has value 100, which is <= 150
    expect(conditionResult.value.value.result).toEqual({ processed: true, itemId: -1 });
  });

  test('handles transform operation errors gracefully', async () => {
    const flow: Flow = {
      name: 'Transform Error Test',
      description: 'Test transform error handling',
      steps: [
        {
          name: 'get_data',
          request: {
            method: 'getData',
            params: {}
          }
        },
        {
          name: 'transform_with_error',
          transform: {
            input: '${get_data.items}',
            operations: [
              {
                type: 'map',
                using: 'item.nonexistent.property'
              }
            ]
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, mockJsonRpcHandler);
    await expect(executor.execute()).rejects.toThrow();
  });
}); 