import { DependencyResolver } from '../dependency-resolver';
import { Flow } from '../types';
import { TestLogger } from '../util/logger';
import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';
import { ReferenceResolver } from '../reference-resolver';
import {
  StepNotFoundError,
  UnknownDependencyError,
  CircularDependencyError,
} from '../dependency-resolver/errors';

describe('DependencyResolver', () => {
  let testLogger: TestLogger;
  let expressionEvaluator: SafeExpressionEvaluator;
  let referenceResolver: ReferenceResolver;

  beforeEach(() => {
    testLogger = new TestLogger('Test');
    referenceResolver = new ReferenceResolver(new Map(), {}, testLogger);
    expressionEvaluator = new SafeExpressionEvaluator(testLogger, referenceResolver);
  });

  afterEach(() => {
    //testLogger.print();
    testLogger.clear();
  });

  it('correctly identifies dependencies in request steps', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for request step dependencies',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: 1 },
          },
        },
        {
          name: 'getFriends',
          request: {
            method: 'user.getFriends',
            params: { userId: '${getUser.id}' },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    expect(resolver.getDependencies('getFriends')).toEqual(['getUser']);
    expect(resolver.getDependencies('getUser')).toEqual([]);
    expect(resolver.getDependents('getUser')).toEqual(['getFriends']);
  });

  it('correctly identifies dependencies in loop steps', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for loop step dependencies',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: 1 },
          },
        },
        {
          name: 'getFriends',
          request: {
            method: 'user.getFriends',
            params: { userId: '${getUser.id}' },
          },
        },
        {
          name: 'notifyFriends',
          loop: {
            over: '${getFriends}',
            as: 'friend',
            condition: '${friend.id} > ${getUser.id}',
            step: {
              name: 'sendNotification',
              request: {
                method: 'notification.send',
                params: {
                  userId: '${friend.id}',
                  message: 'Hello from ${getUser.name}!',
                },
              },
            },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    expect(resolver.getDependencies('notifyFriends')).toEqual(['getFriends', 'getUser']);
    expect(resolver.getExecutionOrder().map((s) => s.name)).toEqual([
      'getUser',
      'getFriends',
      'notifyFriends',
    ]);
  });

  it('correctly identifies dependencies in condition steps', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for condition step dependencies',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: 1 },
          },
        },
        {
          name: 'notifyIfAdmin',
          condition: {
            if: '${getUser.role} === "admin"',
            then: {
              name: 'sendNotification',
              request: {
                method: 'notification.send',
                params: { userId: '${getUser.id}' },
              },
            },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    expect(resolver.getDependencies('notifyIfAdmin')).toEqual(['getUser']);
  });

  it('detects circular dependencies', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for circular dependency detection',
      steps: [
        {
          name: 'step1',
          request: {
            method: 'test',
            params: { value: '${step2.value}' },
          },
        },
        {
          name: 'step2',
          request: {
            method: 'test',
            params: { value: '${step1.value}' },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    expect(() => resolver.getExecutionOrder()).toThrow(CircularDependencyError);
  });

  it('handles complex dependency chains', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for complex dependency chains',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: 1 },
          },
        },
        {
          name: 'getFriends',
          request: {
            method: 'user.getFriends',
            params: { userId: '${getUser.id}' },
          },
        },
        {
          name: 'filterFriends',
          transform: {
            input: '${getFriends}',
            operations: [
              {
                type: 'filter',
                using: '${item.age} > ${getUser.age}',
              },
            ],
          },
        },
        {
          name: 'notifyFriends',
          loop: {
            over: '${filterFriends}',
            as: 'friend',
            step: {
              name: 'sendNotification',
              request: {
                method: 'notification.send',
                params: { userId: '${friend.id}' },
              },
            },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    const order = resolver.getExecutionOrder().map((s) => s.name);
    expect(order).toEqual(['getUser', 'getFriends', 'filterFriends', 'notifyFriends']);
  });

  it('correctly handles loop variable dependencies', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for loop variable dependencies',
      steps: [
        {
          name: 'getFriends',
          request: {
            method: 'user.getFriends',
            params: { userId: 1 },
          },
        },
        {
          name: 'notifyFriends',
          loop: {
            over: '${getFriends}',
            as: 'friend',
            step: {
              name: 'sendNotification',
              request: {
                method: 'notification.send',
                params: {
                  userId: '${friend.id}',
                  message: 'Hello ${friend.name}!',
                },
              },
            },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    expect(resolver.getDependencies('notifyFriends')).toEqual(['getFriends']);
    expect(() => resolver.getExecutionOrder()).not.toThrow();
  });

  it('throws error when step depends on unknown step', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for unknown step dependency',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: '${nonExistentStep.id}' },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    expect(() => resolver.getExecutionOrder()).toThrow(UnknownDependencyError);
  });

  it('throws error when getting dependencies for non-existent step', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for non-existent step',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: 1 },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    expect(() => resolver.getDependencies('nonExistentStep')).toThrow(StepNotFoundError);
  });

  it('handles missing nodes gracefully in topological sort', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for topological sort with missing nodes',
      steps: [
        {
          name: 'step1',
          request: {
            method: 'test',
            params: {},
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    // Access the private methods for testing
    const graph = new Map<string, Set<string>>();
    // Add a node that depends on a non-existent node
    graph.set('step1', new Set(['nonExistentStep']));

    expect(() => resolver['topologicalSort'](graph)).not.toThrow();
  });

  it('handles transform step dependencies', () => {
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
    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    const order = resolver.getExecutionOrder().map((s) => s.name);
    expect(order).toEqual(['get_data', 'select_fields', 'group_by_value']);
    const dependencies = resolver.getDependencies('group_by_value');
    expect(dependencies).toEqual(['get_data']);
  });

  it('correctly generates dependency graph for mixed step types', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for dependency graph generation',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: 1 },
          },
        },
        {
          name: 'processUser',
          transform: {
            input: '${getUser}',
            operations: [
              {
                type: 'map',
                using: '${item.name}',
              },
            ],
          },
        },
        {
          name: 'conditionalStep',
          condition: {
            if: '${processUser.length} > 0',
            then: {
              name: 'thenStep',
              request: {
                method: 'test',
                params: {},
              },
            },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    const graph = resolver.getDependencyGraph();

    // Verify nodes
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        {
          name: 'getUser',
          type: 'request',
          dependencies: [],
          dependents: ['processUser'],
        },
        {
          name: 'processUser',
          type: 'transform',
          dependencies: ['getUser'],
          dependents: ['conditionalStep'],
        },
        {
          name: 'conditionalStep',
          type: 'condition',
          dependencies: ['processUser'],
          dependents: [],
        },
      ]),
    );

    // Verify edges
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        { from: 'getUser', to: 'processUser' },
        { from: 'processUser', to: 'conditionalStep' },
      ]),
    );
  });

  it('correctly generates dependency graph for loop steps', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for loop dependency graph',
      steps: [
        {
          name: 'getData',
          request: {
            method: 'data.get',
            params: {},
          },
        },
        {
          name: 'processItems',
          loop: {
            over: '${getData}',
            as: 'item',
            step: {
              name: 'processItem',
              request: {
                method: 'item.process',
                params: { id: '${item.id}' },
              },
            },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    const graph = resolver.getDependencyGraph();

    // Verify nodes
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        {
          name: 'getData',
          type: 'request',
          dependencies: [],
          dependents: ['processItems'],
        },
        {
          name: 'processItems',
          type: 'loop',
          dependencies: ['getData'],
          dependents: [],
        },
      ]),
    );

    // Verify edges
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges).toEqual([{ from: 'getData', to: 'processItems' }]);
  });

  it('should detect dependencies in complex expressions', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for complex expression dependencies',
      steps: [
        {
          name: 'step1',
          request: {
            method: 'test.method',
            params: { value: [1, 2, 3] },
          },
        },
        {
          name: 'step2',
          request: {
            method: 'test.method',
            params: { value: 0 },
          },
        },
        {
          name: 'step3',
          request: {
            method: 'test.method',
            params: { value: { indices: [0, 1, 2] } },
          },
        },
        {
          name: 'step4',
          transform: {
            input: '${step1.value}',
            operations: [
              {
                type: 'map',
                using: '${step1.value[${step2.value}]} + ${step3.value.indices[0]}',
              },
            ],
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    const deps = resolver.getDependencies('step4');
    expect(deps).toContain('step1');
    expect(deps).toContain('step2');
    expect(deps).toContain('step3');
  });

  it('correctly identifies dependencies in loop steps with multiple steps', () => {
    const flow: Flow = {
      name: 'Test Flow',
      description: 'Test flow for loop step dependencies with multiple steps',
      steps: [
        {
          name: 'getUser',
          request: {
            method: 'user.get',
            params: { id: 1 },
          },
        },
        {
          name: 'getFriends',
          request: {
            method: 'user.getFriends',
            params: { userId: '${getUser.id}' },
          },
        },
        {
          name: 'notifyFriends',
          loop: {
            over: '${getFriends}',
            as: 'friend',
            steps: [
              {
                name: 'validateFriend',
                request: {
                  method: 'friend.validate',
                  params: { id: '${friend.id}' },
                },
              },
              {
                name: 'sendNotification',
                request: {
                  method: 'notification.send',
                  params: {
                    userId: '${friend.id}',
                    message: 'Hello from ${getUser.name}!',
                  },
                },
              },
            ],
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    expect(resolver.getDependencies('notifyFriends')).toEqual(['getFriends', 'getUser']);
    expect(resolver.getExecutionOrder().map((s) => s.name)).toEqual([
      'getUser',
      'getFriends',
      'notifyFriends',
    ]);
  });
});
