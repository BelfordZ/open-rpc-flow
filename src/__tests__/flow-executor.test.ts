import { FlowExecutor } from '../flow-executor';
import { Flow, JsonRpcRequest } from '../types';
import { createMockJsonRpcHandler } from './test-utils';

type MockResponses = {
  [key: string]: unknown;
  'user.get': { id: number; name: string; role: string };
  'user.getPermissions': string[];
  'user.getFriends': Array<{ id: number; name: string }>;
  'notification.send': { success: boolean };
}

describe('FlowExecutor', () => {
  const mockResponses: MockResponses = {
    'user.get': { id: 1, name: 'Alice', role: 'admin' },
    'user.getPermissions': ['read', 'write', 'admin'],
    'user.getFriends': [
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Charlie' }
    ],
    'notification.send': { success: true }
  };

  let jsonRpcHandler: jest.Mock;

  beforeEach(() => {
    jsonRpcHandler = createMockJsonRpcHandler(mockResponses);
  });

  it('executes a simple request step', async () => {
    const flow: Flow = {
      name: 'Simple Request Flow',
      description: 'Get user data',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: 1 }
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, jsonRpcHandler);
    const results = await executor.execute();

    expect(results.get('getUser')).toEqual(mockResponses['user.get']);
    expect(jsonRpcHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'user.get',
        params: { id: 1 }
      })
    );
  });

  it('executes steps in sequence with dependencies', async () => {
    const flow: Flow = {
      name: 'Sequential Flow',
      description: 'Get user and their permissions',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: 1 }
          }
        },
        {
          name: 'getPermissions',
          request: {
            method: 'user.getPermissions',
            params: {
              userId: '${getUser.id}',
              role: '${getUser.role}'
            }
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, jsonRpcHandler);
    const results = await executor.execute();

    expect(results.get('getUser')).toEqual(mockResponses['user.get']);
    expect(results.get('getPermissions')).toEqual(mockResponses['user.getPermissions']);
    expect(jsonRpcHandler).toHaveBeenCalledTimes(2);
  });

  it('executes conditional steps', async () => {
    const flow: Flow = {
      name: 'Conditional Flow',
      description: 'Send notification if user is admin',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: 1 }
          }
        },
        {
          name: 'notifyIfAdmin',
          condition: {
            if: '${getUser.role} === "admin"',
            then: {
              name: 'sendNotification',
              request: {
                method: 'notification.send',
                params: { userId: '${getUser.id}' }
              }
            }
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, jsonRpcHandler);
    const results = await executor.execute();

    expect(results.get('sendNotification')).toEqual({
      result: mockResponses['notification.send'],
      type: 'request',
      metadata: expect.objectContaining({
        method: 'notification.send',
        requestId: expect.any(Number)
      })
    });
    expect(jsonRpcHandler).toHaveBeenCalledTimes(2);
  });

  it('executes loop steps', async () => {
    const flow: Flow = {
      name: 'Loop Flow',
      description: 'Get user friends and send notifications',
      steps: [
        {
          name: 'getFriends',
          request: {
            method: 'user.getFriends',
            params: { userId: 1 }
          }
        },
        {
          name: 'notifyFriends',
          loop: {
            over: '${getFriends}',
            as: 'friend',
            condition: '${friend.id} > 1',
            step: {
              name: 'sendNotification',
              request: {
                method: 'notification.send',
                params: {
                  userId: '${friend.id}',
                  message: 'Hello ${friend.name}!'
                }
              }
            }
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, jsonRpcHandler);
    const results = await executor.execute();

    expect(results.get('getFriends')).toEqual(mockResponses['user.getFriends']);
    expect(jsonRpcHandler).toHaveBeenCalledTimes(3); // 1 getFriends + 2 notifications
  });

  it('executes transform steps', async () => {
    const flow: Flow = {
      name: 'Transform Flow',
      description: 'Get and transform user data',
      steps: [
        {
          name: 'getFriends',
          request: {
            method: 'user.getFriends',
            params: { userId: 1 }
          }
        },
        {
          name: 'friendNames',
          transform: {
            input: '${getFriends}',
            operations: [
              {
                type: 'map',
                using: '${item.name}',
                as: 'names'
              },
              {
                type: 'join',
                using: ', '
              }
            ]
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, jsonRpcHandler);
    const results = await executor.execute();

    expect(results.get('friendNames')).toBe('Bob, Charlie');
  });

  it('handles errors in steps', async () => {
    const errorHandler = jest.fn().mockRejectedValue(new Error('RPC Error'));
    const flow: Flow = {
      name: 'Error Flow',
      description: 'Flow that will fail',
      steps: [
        {
          name: 'failingStep',
          request: {
            method: 'will.fail',
            params: {}
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, errorHandler);
    await expect(executor.execute()).rejects.toThrow('Failed to execute step failingStep');
  });

  it('uses flow context in steps', async () => {
    const flow: Flow = {
      name: 'Context Flow',
      description: 'Flow using context',
      context: {
        userId: 1,
        settings: { notify: true }
      },
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: '${context.userId}' }
          }
        },
        {
          name: 'notifyUser',
          condition: {
            if: '${context.settings.notify}',
            then: {
              name: 'sendNotification',
              request: {
                method: 'notification.send',
                params: { userId: '${getUser.id}' }
              }
            }
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, jsonRpcHandler);
    await executor.execute();

    expect(jsonRpcHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'user.get',
        params: { id: 1 }
      })
    );
    expect(jsonRpcHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'notification.send',
        params: { userId: 1 }
      })
    );
  });

  it('maintains step execution order', async () => {
    const executionOrder: string[] = [];
    const trackingHandler = jest.fn().mockImplementation((request: JsonRpcRequest) => {
      executionOrder.push(request.method);
      return Promise.resolve(mockResponses[request.method]);
    });

    const flow: Flow = {
      name: 'Order Flow',
      description: 'Flow testing execution order',
      steps: [
        {
          name: 'step1',
          request: { method: 'user.get', params: {} }
        },
        {
          name: 'step2',
          request: { method: 'user.getPermissions', params: {} }
        },
        {
          name: 'step3',
          request: { method: 'user.getFriends', params: {} }
        }
      ]
    };

    const executor = new FlowExecutor(flow, trackingHandler);
    await executor.execute();

    expect(executionOrder).toEqual([
      'user.get',
      'user.getPermissions',
      'user.getFriends'
    ]);
  });

  it('executes steps in dependency order', async () => {
    const flow: Flow = {
      name: 'dependency-test',
      description: 'Tests dependency-based execution order',
      steps: [
        {
          name: 'step3',
          request: {
            method: 'test3',
            params: {
              value1: '${step1.value}',
              value2: '${step2.value}'
            }
          }
        },
        {
          name: 'step1',
          request: {
            method: 'test1',
            params: { id: 1 }
          }
        },
        {
          name: 'step2',
          request: {
            method: 'test2',
            params: {
              previousValue: '${step1.value}'
            }
          }
        }
      ]
    };

    const mockResponses = {
      'step1': { value: 10 },
      'step2': { value: 20 },
      'step3': { value: 30 }
    };

    jsonRpcHandler.mockImplementation((request: JsonRpcRequest) => {
      if (request.method === 'test1') {
        return Promise.resolve(mockResponses['step1']);
      }
      if (request.method === 'test2') {
        return Promise.resolve(mockResponses['step2']);
      }
      if (request.method === 'test3') {
        return Promise.resolve(mockResponses['step3']);
      }
      return Promise.resolve({});
    });

    const executor = new FlowExecutor(flow, jsonRpcHandler);
    const results = await executor.execute();

    // Verify execution order through jsonRpcHandler calls
    expect(jsonRpcHandler).toHaveBeenCalledTimes(3);
    expect(jsonRpcHandler.mock.calls[0][0].params).toEqual({ id: 1 }); // step1
    expect(jsonRpcHandler.mock.calls[1][0].params).toEqual({ previousValue: 10 }); // step2
    expect(jsonRpcHandler.mock.calls[2][0].params).toEqual({ value1: 10, value2: 20 }); // step3
  });

  it('executes nested steps in correct order', async () => {
    const flow: Flow = {
      name: 'nested-dependency-test',
      description: 'Tests nested step execution order',
      steps: [
        {
          name: 'getData',
          request: {
            method: 'data.get',
            params: { id: 1 }
          }
        },
        {
          name: 'processData',
          condition: {
            if: '${getData.valid}',
            then: {
              name: 'transform',
              transform: {
                input: '${getData.items}',
                operations: [
                  {
                    type: 'map',
                    using: '${item}'
                  }
                ]
              }
            }
          }
        },
        {
          name: 'useResults',
          request: {
            method: 'results.save',
            params: {
              data: '${processData.value}'
            }
          }
        }
      ]
    };

    jsonRpcHandler.mockImplementation((request: JsonRpcRequest) => {
      if (request.method === 'data.get') {
        return Promise.resolve({ valid: true, items: [1, 2, 3] });
      }
      if (request.method === 'results.save') {
        return Promise.resolve({ success: true });
      }
      return Promise.resolve({});
    });

    const executor = new FlowExecutor(flow, jsonRpcHandler);
    await executor.execute();

    // Verify execution order
    expect(jsonRpcHandler).toHaveBeenCalledTimes(2);
    expect(jsonRpcHandler.mock.calls[0][0].method).toBe('data.get');
    expect(jsonRpcHandler.mock.calls[1][0].method).toBe('results.save');
  });

  it('handles circular dependencies', async () => {
    const flow: Flow = {
      name: 'circular-dependency-test',
      description: 'Tests circular dependency detection',
      steps: [
        {
          name: 'step1',
          request: {
            method: 'test',
            params: { value: '${step2.value}' }
          }
        },
        {
          name: 'step2',
          request: {
            method: 'test',
            params: { value: '${step1.value}' }
          }
        }
      ]
    };

    const executor = new FlowExecutor(flow, jsonRpcHandler);
    await expect(executor.execute()).rejects.toThrow('Circular dependency');
  });

  it('executes independent steps in parallel', async () => {
    const flow: Flow = {
      name: 'parallel-test',
      description: 'Tests parallel execution of independent steps',
      steps: [
        {
          name: 'step1',
          request: {
            method: 'test1',
            params: { id: 1 }
          }
        },
        {
          name: 'step2',
          request: {
            method: 'test2',
            params: { id: 2 }
          }
        },
        {
          name: 'step3',
          request: {
            method: 'test3',
            params: { id: 3 }
          }
        }
      ]
    };

    const mockResponses = {
      'step1': { value: 10 },
      'step2': { value: 20 },
      'step3': { value: 30 }
    };

    jsonRpcHandler.mockImplementation((request: JsonRpcRequest) => {
      if (request.method === 'test1') {
        return Promise.resolve(mockResponses['step1']);
      }
      if (request.method === 'test2') {
        return Promise.resolve(mockResponses['step2']);
      }
      if (request.method === 'test3') {
        return Promise.resolve(mockResponses['step3']);
      }
      return Promise.resolve({});
    });

    const executor = new FlowExecutor(flow, jsonRpcHandler);
    const results = await executor.execute();

    // Verify all steps were executed
    expect(jsonRpcHandler).toHaveBeenCalledTimes(3);
    expect(results.get('step1')).toEqual(mockResponses['step1']);
    expect(results.get('step2')).toEqual(mockResponses['step2']);
    expect(results.get('step3')).toEqual(mockResponses['step3']);
  });
}); 