import { DependencyResolver } from '../dependency-resolver';
import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';
import { Flow } from '../types';
import { TestLogger, noLogger } from '../util/logger';
import { ReferenceResolver } from '../reference-resolver';
import { FlowExecutor } from '../flow-executor';
import { UnknownDependencyError } from '../dependency-resolver/errors';

/**
 * Regression tests for issue #185: references to sibling steps nested inside
 * a loop's `steps` (or a switch case array) were hoisted as top-level
 * dependencies of the enclosing step, failing graph build with
 * UnknownDependencyError even though the executors run those inner steps
 * sequentially with access to each other's results.
 */
describe('DependencyResolver - sibling references in nested steps (#185)', () => {
  let expressionEvaluator: SafeExpressionEvaluator;
  let testLogger: TestLogger;

  beforeEach(() => {
    testLogger = new TestLogger();
    const referenceResolver = new ReferenceResolver(new Map(), {}, testLogger);
    expressionEvaluator = new SafeExpressionEvaluator(testLogger, referenceResolver);
  });

  afterEach(() => {
    testLogger.clear();
  });

  const loopFlow: Flow = {
    name: 'Sibling Loop Flow',
    description: 'Loop whose later inner step references an earlier inner step',
    steps: [
      {
        name: 'fetchUsers',
        request: { method: 'listUsers', params: {} },
      },
      {
        name: 'syncEach',
        loop: {
          over: '${fetchUsers.result}',
          as: 'user',
          steps: [
            {
              name: 'fetchDetail',
              request: {
                method: 'getUserDetail',
                params: { id: '${user.id}' },
              },
            },
            {
              name: 'saveDetail',
              request: {
                method: 'saveDetail',
                params: { detail: '${fetchDetail.result}' },
              },
            },
          ],
        },
      },
    ],
  };

  const loopHandler = async (request: { method: string; params?: unknown }) => {
    const params = (request.params ?? {}) as Record<string, unknown>;
    if (request.method === 'listUsers') {
      return [{ id: 1 }];
    }
    if (request.method === 'getUserDetail') {
      return { id: params.id };
    }
    if (request.method === 'saveDetail') {
      return { saved: params.detail };
    }
    throw new Error(`unknown method ${request.method}`);
  };

  it('builds the graph when a later loop sub-step references an earlier sibling', () => {
    const resolver = new DependencyResolver(loopFlow, expressionEvaluator, testLogger);

    const dependencies = resolver.getDependencies('syncEach');

    // Outer step referenced by the loop's `over` expression is still a dependency.
    expect(dependencies).toContain('fetchUsers');
    // Inner sibling names must not leak into the enclosing step's dependencies.
    expect(dependencies).not.toContain('fetchDetail');
    expect(dependencies).not.toContain('saveDetail');

    const order = resolver.getExecutionOrder().map((step) => step.name);
    expect(order.indexOf('fetchUsers')).toBeLessThan(order.indexOf('syncEach'));
  });

  it('executes the loop flow end-to-end with sibling references', async () => {
    const handler = jest.fn(loopHandler);
    const executor = new FlowExecutor(loopFlow, handler as never, {
      logger: noLogger,
    });

    const results = await executor.execute();

    expect(results.get('syncEach')).toBeDefined();
    // The sibling reference ${fetchDetail.result} resolved against the
    // earlier inner step's result.
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'saveDetail',
        params: { detail: { id: 1 } },
      }),
      expect.anything(),
    );
  });

  it('builds the graph when a switch case-array step references an earlier sibling', async () => {
    const flow: Flow = {
      name: 'Sibling Switch Flow',
      description: 'Switch case array whose later step references an earlier sibling',
      steps: [
        {
          name: 'getUser',
          request: { method: 'user.get', params: {} },
        },
        {
          name: 'route',
          condition: {
            switch: '${getUser.result.tier}',
            cases: {
              silver: [
                {
                  name: 'silverA',
                  request: { method: 'a.get', params: {} },
                },
                {
                  name: 'silverB',
                  request: {
                    method: 'b.save',
                    params: { what: '${silverA.result}' },
                  },
                },
              ],
            },
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);

    const dependencies = resolver.getDependencies('route');
    expect(dependencies).toContain('getUser');
    expect(dependencies).not.toContain('silverA');
    expect(dependencies).not.toContain('silverB');

    // The branch still runs and the sibling reference resolves at runtime.
    const handler = jest.fn(async (request: { method: string }) => {
      if (request.method === 'user.get') {
        return { tier: 'silver' };
      }
      if (request.method === 'a.get') {
        return { value: 42 };
      }
      if (request.method === 'b.save') {
        return { ok: true };
      }
      throw new Error(`unknown method ${request.method}`);
    });
    const executor = new FlowExecutor(flow, handler as never, { logger: noLogger });
    const results = await executor.execute();

    expect(results.get('route')).toBeDefined();
    // silverB's ${silverA.result} param resolved against silverA's result.
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'b.save',
        params: { what: { value: 42 } },
      }),
      expect.anything(),
    );
  });

  it('still throws UnknownDependencyError for genuinely unknown references in nested steps', () => {
    const flow: Flow = {
      name: 'Unknown Nested Ref Flow',
      description: 'Loop sub-step referencing a step that does not exist anywhere',
      steps: [
        {
          name: 'fetchUsers',
          request: { method: 'listUsers', params: {} },
        },
        {
          name: 'syncEach',
          loop: {
            over: '${fetchUsers.result}',
            as: 'user',
            steps: [
              {
                name: 'saveDetail',
                request: {
                  method: 'saveDetail',
                  params: { detail: '${doesNotExist.result}' },
                },
              },
            ],
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
    expect(() => resolver.getExecutionOrder()).toThrow(UnknownDependencyError);
    expect(() => resolver.getExecutionOrder()).toThrow(
      "Step 'syncEach' depends on unknown step 'doesNotExist'",
    );
  });

  it('orders inner steps that reference outer steps after those outer steps', () => {
    const flow: Flow = {
      name: 'Inner Outer Ref Flow',
      description: 'Loop sub-step referencing a top-level step keeps the ordering edge',
      steps: [
        {
          name: 'fetchConfig',
          request: { method: 'config.get', params: {} },
        },
        {
          name: 'fetchUsers',
          request: { method: 'listUsers', params: {} },
        },
        {
          name: 'syncEach',
          loop: {
            over: '${fetchUsers.result}',
            as: 'user',
            steps: [
              {
                name: 'applyConfig',
                request: {
                  method: 'config.apply',
                  params: {
                    user: '${user.id}',
                    config: '${fetchConfig.result}',
                  },
                },
              },
            ],
          },
        },
      ],
    };

    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);

    const dependencies = resolver.getDependencies('syncEach');
    expect(dependencies).toEqual(expect.arrayContaining(['fetchConfig', 'fetchUsers']));

    const order = resolver.getExecutionOrder().map((step) => step.name);
    expect(order.indexOf('fetchConfig')).toBeLessThan(order.indexOf('syncEach'));
    expect(order.indexOf('fetchUsers')).toBeLessThan(order.indexOf('syncEach'));
  });

  it('keeps sibling results visible when a bare stop (#188) terminates the same branch', async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const handler = async (request: { method: string; params?: unknown }) => {
      calls.push({ method: request.method, params: request.params });
      if (request.method === 'getUserDetail') {
        return { id: (request.params as { id: number }).id };
      }
      if (request.method === 'saveDetail') {
        return { saved: (request.params as { detail: unknown }).detail };
      }
      throw new Error(`unknown method ${request.method}`);
    };
    const flow: Flow = {
      name: 'Sibling Stop Flow',
      description: 'sibling ref resolves before a bare stop terminates the branch',
      steps: [
        {
          name: 'route',
          condition: {
            switch: '${context.tier}',
            cases: {
              gold: [
                {
                  name: 'fetchDetail',
                  request: { method: 'getUserDetail', params: { id: 1 } },
                },
                {
                  name: 'saveDetail',
                  request: {
                    method: 'saveDetail',
                    params: { detail: '${fetchDetail.result}' },
                  },
                },
                { name: 'halt', stop: {} },
                {
                  name: 'neverRuns',
                  request: { method: 'saveDetail', params: {} },
                },
              ],
            },
          },
        },
        {
          name: 'after',
          request: {
            method: 'saveDetail',
            // Reference the switch so `after` runs after `route` completes.
            params: { detail: 'done', routeResult: '${route.result}' },
          },
        },
      ],
      context: { tier: 'gold' },
    };

    const executor = new FlowExecutor(flow, handler as never, { logger: noLogger });
    await executor.execute();

    const methods = calls.map((c) => c.method);
    // Sibling result resolved before the stop...
    expect(methods).toEqual(['getUserDetail', 'saveDetail', 'saveDetail']);
    expect((calls[1].params as { detail: unknown }).detail).toEqual({ id: 1 });
    // ...the stop skipped the rest of the case, and the flow continued after.
    expect((calls[2].params as { detail: unknown }).detail).toEqual('done');
  });
});
