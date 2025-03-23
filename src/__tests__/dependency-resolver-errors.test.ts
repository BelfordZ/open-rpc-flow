import { Flow } from '../types';
import { DependencyResolver } from '../dependency-resolver';
import {
  StepNotFoundError,
  UnknownDependencyError,
  CircularDependencyError,
} from '../dependency-resolver/errors';
import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';
import { TestLogger } from '../util/logger';

describe('DependencyResolver Error Classes', () => {
  let testLogger: TestLogger;
  let expressionEvaluator: SafeExpressionEvaluator;

  beforeEach(() => {
    testLogger = new TestLogger('DependencyResolverTest');
    expressionEvaluator = {
      extractReferences: jest.fn().mockImplementation((expr: string) => {
        // Simple implementation to extract references from ${...} syntax
        const refs: string[] = [];
        const matches = expr.match(/\${([^.}]+)/g);
        if (matches) {
          matches.forEach((match) => {
            const ref = match.slice(2);
            refs.push(ref);
          });
        }
        return refs;
      }),
      evaluate: jest.fn(),
    } as unknown as SafeExpressionEvaluator;
  });

  afterEach(() => {
    testLogger.clear();
  });

  describe('StepNotFoundError', () => {
    it('throws StepNotFoundError when getting dependencies for non-existent step', () => {
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

      try {
        resolver.getDependencies('nonExistentStep');
        fail('Expected StepNotFoundError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(StepNotFoundError);
        if (error instanceof StepNotFoundError) {
          expect(error.stepName).toBe('nonExistentStep');
          expect(error.availableSteps).toEqual(['getUser']);
          expect(error.message).toBe("Step 'nonExistentStep' not found in dependency graph");
        }
      }
    });
  });

  describe('UnknownDependencyError', () => {
    it('throws UnknownDependencyError when step depends on unknown step', () => {
      // Mock the extractReferences function to return a non-existent step
      expressionEvaluator.extractReferences = jest.fn().mockReturnValue(['nonExistentStep']);

      const flow: Flow = {
        name: 'Test Flow',
        description: 'Test flow with unknown dependency',
        steps: [
          {
            name: 'getUser',
            request: {
              method: 'user.get',
              params: {
                id: '${nonExistentStep.result}',
              },
            },
          },
        ],
      };

      const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);

      try {
        resolver.getExecutionOrder();
        fail('Expected UnknownDependencyError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(UnknownDependencyError);
        if (error instanceof UnknownDependencyError) {
          expect(error.dependentStep).toBe('getUser');
          expect(error.dependencyStep).toBe('nonExistentStep');
          expect(error.availableSteps).toEqual(['getUser']);
          expect(error.message).toBe("Step 'getUser' depends on unknown step 'nonExistentStep'");
        }
      }
    });
  });

  describe('CircularDependencyError', () => {
    it('throws CircularDependencyError when circular dependency is detected', () => {
      // Create a flow with circular dependency
      // step1 depends on step2, and step2 depends on step1
      expressionEvaluator.extractReferences = jest.fn().mockImplementation((expr: string) => {
        if (expr.includes('step1')) return ['step1'];
        if (expr.includes('step2')) return ['step2'];
        return [];
      });

      const flow: Flow = {
        name: 'Test Flow',
        description: 'Test flow with circular dependency',
        steps: [
          {
            name: 'step1',
            request: {
              method: 'test',
              params: {
                data: '${step2.result}',
              },
            },
          },
          {
            name: 'step2',
            request: {
              method: 'test',
              params: {
                data: '${step1.result}',
              },
            },
          },
        ],
      };

      const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);

      try {
        resolver.getExecutionOrder();
        fail('Expected CircularDependencyError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(CircularDependencyError);
        if (error instanceof CircularDependencyError) {
          expect(error.cycle).toContain('step1');
          expect(error.cycle).toContain('step2');
          expect(error.message).toContain('Circular dependency detected:');
        }
      }
    });
  });
});
