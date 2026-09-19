import { DependencyResolver } from '../dependency-resolver';
import { Flow } from '../types';
import { TestLogger, Logger } from '../util/logger';
import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';
import { ReferenceResolver } from '../reference-resolver';
import { UnknownDependencyError } from '../dependency-resolver/errors';

describe('DependencyResolver graph cache', () => {
  let testLogger: TestLogger;
  let expressionEvaluator: SafeExpressionEvaluator;

  const makeFlow = (): Flow => ({
    name: 'Cache Flow',
    description: 'Flow for graph cache tests',
    steps: [
      {
        name: 'getUser',
        request: { method: 'user.get', params: { id: 1 } },
      },
      {
        name: 'getFriends',
        request: { method: 'user.getFriends', params: { userId: '${getUser.id}' } },
      },
    ],
  });

  const buildSpy = (resolver: DependencyResolver) =>
    jest.spyOn(
      resolver as unknown as {
        buildDependencyGraph: (logger: Logger) => Map<string, Set<string>>;
      },
      'buildDependencyGraph',
    );

  beforeEach(() => {
    testLogger = new TestLogger('Test');
    const referenceResolver = new ReferenceResolver(new Map(), {}, testLogger);
    expressionEvaluator = new SafeExpressionEvaluator(testLogger, referenceResolver);
  });

  afterEach(() => {
    testLogger.clear();
  });

  it('initializes the cache as empty', () => {
    const resolver = new DependencyResolver(makeFlow(), expressionEvaluator, testLogger);
    expect(
      (resolver as unknown as { dependencyGraph: Map<string, Set<string>> | null }).dependencyGraph,
    ).toBeNull();
  });

  it('builds the graph once across repeated consumer calls', () => {
    const resolver = new DependencyResolver(makeFlow(), expressionEvaluator, testLogger);
    const spy = buildSpy(resolver);

    expect(resolver.getExecutionOrder().map((s) => s.name)).toEqual(['getUser', 'getFriends']);
    expect(resolver.getDependencies('getFriends')).toEqual(['getUser']);
    expect(resolver.getDependents('getUser')).toEqual(['getFriends']);
    const uiGraph = resolver.getDependencyGraph();
    expect(uiGraph.nodes.map((n) => n.name)).toEqual(['getUser', 'getFriends']);
    expect(uiGraph.edges).toEqual([{ from: 'getUser', to: 'getFriends' }]);
    // And again, for good measure.
    resolver.getExecutionOrder();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('rebuilds the graph after invalidateCache()', () => {
    const resolver = new DependencyResolver(makeFlow(), expressionEvaluator, testLogger);
    const spy = buildSpy(resolver);

    resolver.getExecutionOrder();
    expect(spy).toHaveBeenCalledTimes(1);

    resolver.invalidateCache();
    expect(resolver.getExecutionOrder().map((s) => s.name)).toEqual(['getUser', 'getFriends']);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed build', () => {
    const flow = makeFlow();
    // Point getFriends at a step that does not exist.
    (flow.steps[1] as { request: { params: Record<string, unknown> } }).request.params = {
      userId: '${ghost.id}',
    };
    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);

    expect(() => resolver.getExecutionOrder()).toThrow(UnknownDependencyError);

    // Fix the flow; the next call must rebuild (not replay the stale failure).
    (flow.steps[1] as { request: { params: Record<string, unknown> } }).request.params = {
      userId: '${getUser.id}',
    };
    expect(resolver.getExecutionOrder().map((s) => s.name)).toEqual(['getUser', 'getFriends']);
  });

  it('serves the cached graph until invalidated when the flow is mutated', () => {
    const flow = makeFlow();
    const resolver = new DependencyResolver(flow, expressionEvaluator, testLogger);

    expect(resolver.getExecutionOrder().map((s) => s.name)).toEqual(['getUser', 'getFriends']);

    // Mutate the flow behind the resolver's back: add a step depending on getFriends.
    flow.steps.push({
      name: 'getPhotos',
      request: { method: 'user.getPhotos', params: { userId: '${getFriends.id}' } },
    });

    // Without invalidation the resolver keeps serving the stale graph.
    expect(resolver.getExecutionOrder().map((s) => s.name)).toEqual(['getUser', 'getFriends']);

    resolver.invalidateCache();
    expect(resolver.getExecutionOrder().map((s) => s.name)).toEqual([
      'getUser',
      'getFriends',
      'getPhotos',
    ]);
  });
});
