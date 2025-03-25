import { DependencyResolver } from '../dependency-resolver';
import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';
import { Flow, Step } from '../types';
import { TestLogger } from '../util/logger';
import { ReferenceResolver } from '../reference-resolver';

describe('DependencyResolver - Loop Steps with Conditions', () => {
  let expressionEvaluator: SafeExpressionEvaluator;
  let testLogger: TestLogger;
  let referenceResolver: ReferenceResolver;

  beforeEach(() => {
    testLogger = new TestLogger();
    referenceResolver = new ReferenceResolver(new Map(), {}, testLogger);
    expressionEvaluator = new SafeExpressionEvaluator(testLogger, referenceResolver);
  });

  afterEach(() => {
    testLogger.clear();
  });

  it('correctly identifies dependencies in loop steps with condition', () => {
    // This test specifically targets lines 124-136 of resolver.ts
    const flow: Flow = {
      name: 'Test Flow with Loop Condition',
      description: 'Test flow for loop step with condition',
      steps: [
        {
          name: 'getUsers',
          request: {
            method: 'users.list',
            params: {},
          },
        },
        {
          name: 'getFlag',
          request: {
            method: 'flags.get',
            params: { name: 'processInactive' },
          },
        },
        {
          name: 'processUsers',
          loop: {
            over: '${getUsers}',
            as: 'user',
            condition: '${getFlag} === true || ${user.isActive} === true',
            step: {
              name: 'processUser',
              request: {
                method: 'user.process',
                params: { 
                  id: '${user.id}',
                  action: '${getFlag} ? "full" : "partial"' 
                },
              },
            },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    
    // Test getDependencies for the loop step
    const dependencies = resolver.getDependencies('processUsers');
    
    // Verify dependencies from the loop
    expect(dependencies).toContain('getUsers');
    
    // Verify dependencies from the condition
    expect(dependencies).toContain('getFlag');
    
    // Make sure we don't include loop variables as dependencies
    expect(dependencies).not.toContain('user');
    
    // Test the dependency graph
    const graph = resolver.getDependencyGraph();
    
    // Verify nodes
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        {
          name: 'getUsers',
          type: 'request',
          dependencies: [],
          dependents: ['processUsers'],
        },
        {
          name: 'getFlag',
          type: 'request',
          dependencies: [],
          dependents: ['processUsers'],
        },
        {
          name: 'processUsers',
          type: 'loop',
          dependencies: expect.arrayContaining(['getUsers', 'getFlag']),
          dependents: [],
        },
      ]),
    );
    
    // Verify edges
    expect(graph.edges).toContainEqual({ from: 'getUsers', to: 'processUsers' });
    expect(graph.edges).toContainEqual({ from: 'getFlag', to: 'processUsers' });
  });

  it('correctly handles complex conditions in loop steps', () => {
    const flow: Flow = {
      name: 'Test Flow with Complex Loop Condition',
      description: 'Test flow for loop step with complex condition',
      steps: [
        {
          name: 'getData',
          request: {
            method: 'data.get',
            params: {},
          },
        },
        {
          name: 'getConfig',
          request: {
            method: 'config.get',
            params: {},
          },
        },
        {
          name: 'getSettings',
          request: {
            method: 'settings.get',
            params: {},
          },
        },
        {
          name: 'processData',
          loop: {
            over: '${getData.items}',
            as: 'item',
            condition: '${item.value} > ${getConfig.threshold} && ${getSettings.enabled}',
            step: {
              name: 'processItem',
              transform: {
                input: '${item}',
                operations: [
                  {
                    type: 'map',
                    using: '${item.id} + ${getConfig.prefix}',
                  },
                ],
              },
            },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    
    // Test getDependencies for the processData step
    const dependencies = resolver.getDependencies('processData');
    
    // Verify dependencies
    expect(dependencies).toEqual(expect.arrayContaining(['getData', 'getConfig', 'getSettings']));
    
    // Verify that loop variables are not included
    expect(dependencies).not.toContain('item');
  });
}); 