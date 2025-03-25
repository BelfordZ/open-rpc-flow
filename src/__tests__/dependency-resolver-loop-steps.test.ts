import { DependencyResolver } from '../dependency-resolver';
import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';
import { Flow, Step as _Step } from '../types';
import { TestLogger } from '../util/logger';
import { ReferenceResolver } from '../reference-resolver';

describe('DependencyResolver - Loop Steps with Multiple SubSteps', () => {
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

  it('correctly identifies dependencies in loop steps with multiple substeps', () => {
    // This test specifically targets lines 154-165 of resolver.ts
    const flow: Flow = {
      name: 'Test Flow with Loop Steps',
      description: 'Test flow for loop step with multiple substeps',
      steps: [
        {
          name: 'getUsers',
          request: {
            method: 'users.list',
            params: {},
          },
        },
        {
          name: 'getPermissions',
          request: {
            method: 'permissions.get',
            params: {},
          },
        },
        {
          name: 'processUsers',
          loop: {
            over: '${getUsers}',
            as: 'user',
            steps: [
              {
                name: 'validateUser',
                request: {
                  method: 'user.validate',
                  params: {
                    id: '${user.id}',
                  },
                },
              },
              {
                name: 'checkPermissions',
                request: {
                  method: 'user.checkPermissions',
                  params: {
                    userId: '${user.id}',
                    permissions: '${getPermissions}',
                  },
                },
              },
              {
                name: 'logActivity',
                request: {
                  method: 'log.activity',
                  params: {
                    action: 'user_processed',
                    details: {
                      userId: '${user.id}',
                      timestamp: Date.now(),
                    },
                  },
                },
              },
            ],
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);

    // Test getDependencies for the loop step
    const dependencies = resolver.getDependencies('processUsers');

    // Verify dependencies from the loop's "over" expression
    expect(dependencies).toContain('getUsers');

    // Verify dependencies from the loop's substeps
    expect(dependencies).toContain('getPermissions');

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
          name: 'getPermissions',
          type: 'request',
          dependencies: [],
          dependents: ['processUsers'],
        },
        {
          name: 'processUsers',
          type: 'loop',
          dependencies: expect.arrayContaining(['getUsers', 'getPermissions']),
          dependents: [],
        },
      ]),
    );

    // Verify edges
    expect(graph.edges).toContainEqual({ from: 'getUsers', to: 'processUsers' });
    expect(graph.edges).toContainEqual({ from: 'getPermissions', to: 'processUsers' });
  });

  it('correctly processes nested dependencies in loop steps with substeps', () => {
    const flow: Flow = {
      name: 'Test Flow with Nested Dependencies',
      description: 'Test flow for loop step with nested dependencies in substeps',
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
          name: 'getTemplates',
          request: {
            method: 'templates.get',
            params: {
              configId: '${getConfig.id}',
            },
          },
        },
        {
          name: 'processItems',
          loop: {
            over: '${getData.items}',
            as: 'item',
            steps: [
              {
                name: 'transformItem',
                transform: {
                  input: '${item}',
                  operations: [
                    {
                      type: 'map',
                      using: '{ ...${item}, configVersion: ${getConfig.version} }',
                    },
                  ],
                },
              },
              {
                name: 'renderTemplate',
                request: {
                  method: 'template.render',
                  params: {
                    templateId: '${getTemplates[${item.type}].id}',
                    data: '${item}',
                  },
                },
              },
            ],
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);

    // Test that all dependencies are correctly identified
    const dependencies = resolver.getDependencies('processItems');

    expect(dependencies).toContain('getData');
    expect(dependencies).toContain('getConfig');
    expect(dependencies).toContain('getTemplates');

    // Verify the dependency tree is correct
    expect(resolver.getDependencies('getTemplates')).toContain('getConfig');

    // The dependency graph should reflect this correctly
    const graph = resolver.getDependencyGraph();

    // Verify the ordering in the graph
    const templateNode = graph.nodes.find((node) => node.name === 'getTemplates');
    expect(templateNode?.dependencies).toContain('getConfig');

    // Check that processItems depends on all necessary steps
    const processNode = graph.nodes.find((node) => node.name === 'processItems');
    expect(processNode?.dependencies).toEqual(
      expect.arrayContaining(['getData', 'getConfig', 'getTemplates']),
    );
  });
});
