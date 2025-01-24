import { FlowExecutor } from '../../flow-executor';
import { Flow } from '../../types';
import { createMockJsonRpcHandler } from '../test-utils';
//import { TestLogger } from '../../util/logger';
import { noLogger } from '../../util/logger';

describe('Flow Execution Integration', () => {
  let jsonRpcHandler: jest.Mock;
  //let testLogger: TestLogger;
  beforeEach(() => {
    jsonRpcHandler = createMockJsonRpcHandler();
    //testLogger = new TestLogger('FlowExecutionTest');
  });

  /**
  afterEach(() => {
    testLogger.print();
    testLogger.clear();
  });
  */

  it('executes a complex data processing flow', async () => {
    const flow: Flow = {
      name: 'complex-data-processing',
      description: 'Process and transform data with conditions and loops',
      context: {
        batchSize: 2,
        minValue: 10,
      },
      steps: [
        {
          name: 'getData',
          request: {
            method: 'data.fetch',
            params: { source: 'test' },
          },
        },
        {
          name: 'validateData',
          condition: {
            if: '${getData.result.length} > 0',
            then: {
              name: 'processData',
              transform: {
                input: '${getData.result}',
                operations: [
                  {
                    type: 'filter',
                    using: '${item.value} > ${context.minValue}',
                  },
                  {
                    type: 'map',
                    using: '{ ...${item}, processed: true }',
                  },
                ],
              },
            },
          },
        },
        {
          name: 'processBatches',
          loop: {
            over: '${validateData.result.result}',
            as: 'batch',
            step: {
              name: 'processBatch',
              request: {
                method: 'batch.process',
                params: {
                  data: '${batch}',
                  index: '${metadata.current.index}',
                },
              },
            },
          },
        },
        {
          name: 'aggregateResults',
          transform: {
            input: '${processBatches.result.value}',
            operations: [
              {
                type: 'reduce',
                using: '[...${acc}, ${item.result.results}]',
                initial: [],
              },
            ],
          },
        },
      ],
    };

    // Mock responses
    const mockData = [
      { id: 1, value: 5 },
      { id: 2, value: 15 },
      { id: 3, value: 20 },
    ];

    const mockBatchResults = [{ results: ['result1'] }, { results: ['result2'] }];

    jsonRpcHandler.mockImplementation((request) => {
      switch (request.method) {
        case 'data.fetch':
          return Promise.resolve(mockData);
        case 'batch.process':
          return Promise.resolve(mockBatchResults[request.params.index]);
        default:
          return Promise.resolve({});
      }
    });

    const executor = new FlowExecutor(flow, jsonRpcHandler, noLogger);
    const results = await executor.execute();

    // Verify the complete execution chain
    expect(results.get('getData').result).toEqual(mockData);
    expect(results.get('validateData').result.result).toEqual([
      { id: 2, value: 15, processed: true },
      { id: 3, value: 20, processed: true },
    ]);

    expect(
      results.get('processBatches').result.value.map((r: { result: any }) => r.result),
    ).toEqual(mockBatchResults);

    expect(results.get('aggregateResults').result).toEqual([['result1'], ['result2']]);
  });

  it('handles error conditions gracefully', async () => {
    const flow: Flow = {
      name: 'error-handling',
      description: 'Test error handling in flows',
      steps: [
        {
          name: 'getData',
          request: {
            method: 'data.fetch',
            params: { source: 'test' },
          },
        },
        {
          name: 'handleError',
          condition: {
            if: '${getData.metadata.hasError}',
            then: {
              name: 'logError',
              request: {
                method: 'error.log',
                params: {
                  message: '${getData.result.error.message}',
                },
              },
            },
            else: {
              name: 'processData',
              transform: {
                input: '${getData.items}',
                operations: [
                  {
                    type: 'map',
                    using: '${item.value}',
                  },
                ],
              },
            },
          },
        },
      ],
    };

    // Mock error response
    jsonRpcHandler.mockImplementation((request) => {
      if (request.method === 'data.fetch') {
        return Promise.resolve({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32000,
            message: 'Data fetch failed',
            data: { source: 'test' },
          },
        });
      }
      if (request.method === 'error.log') {
        return Promise.resolve({
          jsonrpc: '2.0',
          id: request.id,
          result: { logged: true },
        });
      }
      return Promise.resolve({
        jsonrpc: '2.0',
        id: request.id,
        result: {},
      });
    });

    const executor = new FlowExecutor(flow, jsonRpcHandler, noLogger);
    const results = await executor.execute();

    const getDataResult = results.get('getData').result;
    expect(getDataResult.result).toBeUndefined();
    expect(getDataResult.error).toEqual({
      code: -32000,
      message: 'Data fetch failed',
      data: { source: 'test' },
    });
    expect(jsonRpcHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'error.log',
        params: { message: 'Data fetch failed' },
      }),
    );
  });

  it('maintains variable scope in nested operations', async () => {
    const flow: Flow = {
      name: 'variable-scope',
      description: 'Test variable scoping in nested operations',
      steps: [
        {
          name: 'getTeams',
          request: {
            method: 'teams.list',
            params: {},
          },
        },
        {
          name: 'processTeams',
          loop: {
            over: '${getTeams.result}',
            as: 'team',
            step: {
              name: 'processMembers',
              loop: {
                over: '${team.members}',
                as: 'member',
                step: {
                  name: 'processMember',
                  condition: {
                    if: '${member.active}',
                    then: {
                      name: 'notifyMember',
                      request: {
                        method: 'notify',
                        params: {
                          teamId: '${team.id}',
                          memberId: '${member.id}',
                          message: 'Welcome to ${team.name}',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      ],
    };

    const mockTeams = [
      {
        id: 1,
        name: 'Team A',
        members: [
          { id: 1, active: true },
          { id: 2, active: false },
        ],
      },
      {
        id: 2,
        name: 'Team B',
        members: [{ id: 3, active: true }],
      },
    ];

    jsonRpcHandler.mockImplementation((request) => {
      if (request.method === 'teams.list') {
        return Promise.resolve(mockTeams);
      }
      return Promise.resolve({ sent: true });
    });

    const executor = new FlowExecutor(flow, jsonRpcHandler, noLogger);
    await executor.execute();

    // Should only notify active members
    expect(jsonRpcHandler).toHaveBeenCalledTimes(3); // 1 teams.list + 2 notify calls
    expect(jsonRpcHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'notify',
        params: {
          teamId: 1,
          memberId: 1,
          message: 'Welcome to Team A',
        },
      }),
    );
    expect(jsonRpcHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'notify',
        params: {
          teamId: 2,
          memberId: 3,
          message: 'Welcome to Team B',
        },
      }),
    );
  });
});
