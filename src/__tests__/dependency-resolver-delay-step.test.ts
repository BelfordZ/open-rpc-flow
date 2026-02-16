import { DependencyResolver } from '../dependency-resolver';
import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';
import { TestLogger } from '../util/logger';
import { Flow } from '../types';
import { StepType } from '../step-executors/types';

describe('DependencyResolver - Delay Steps', () => {
  let testLogger: TestLogger;
  let expressionEvaluator: SafeExpressionEvaluator;

  beforeEach(() => {
    testLogger = new TestLogger('DependencyResolverDelayTest');
    expressionEvaluator = {
      extractReferences: jest.fn().mockImplementation((expr: string) => {
        const refs: string[] = [];
        const matches = expr.match(/\${([^.}]+)/g);
        if (matches) {
          matches.forEach((match) => refs.push(match.slice(2)));
        }
        return refs;
      }),
      evaluate: jest.fn(),
    } as unknown as SafeExpressionEvaluator;
  });

  afterEach(() => {
    testLogger.clear();
  });

  it('collects dependencies from nested delay steps', () => {
    const flow: Flow = {
      name: 'DelayFlow',
      description: 'delay step dependencies',
      steps: [
        {
          name: 'getUser',
          request: { method: 'user.get', params: { id: 1 } },
        },
        {
          name: 'delayedStep',
          delay: {
            duration: 10,
            step: {
              name: 'delayedRequest',
              request: { method: 'user.update', params: { id: '${getUser.result.id}' } },
            },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    const deps = resolver.getDependencies('delayedStep');

    expect(deps).toContain('getUser');
  });

  it('reports delay steps in the dependency graph', () => {
    const flow: Flow = {
      name: 'DelayFlow',
      description: 'delay step graph',
      steps: [
        {
          name: 'wait',
          delay: {
            duration: 5,
            step: { name: 'inner', request: { method: 'm', params: {} } },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    const graph = resolver.getDependencyGraph();
    const delayNode = graph.nodes.find((node) => node.name === 'wait');

    expect(delayNode?.type).toBe(StepType.Delay);
  });
});
