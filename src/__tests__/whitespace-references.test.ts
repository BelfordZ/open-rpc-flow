import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';
import { ReferenceResolver } from '../reference-resolver';
import { DependencyResolver } from '../dependency-resolver';
import { FlowExecutor } from '../flow-executor';
import { Flow } from '../types';
import { TestLogger } from '../util/logger';

/**
 * Regression tests for issue #147: whitespace inside `${...}` must be
 * handled consistently across expression evaluation, reference extraction,
 * and reference resolution.
 *
 * Documented semantics:
 * - Only *leading/trailing* whitespace of the whole inner expression is
 *   ignored: `${ a }`, `${a }`, `${ a}`, `${\ta\n}` all mean `a`.
 * - Whitespace *inside* the expression is preserved where meaningful:
 *   quoted keys like `${ a['b c'] }` keep their inner space.
 * - Spaces around dots (`${ a . b }`) resolve the same as `a.b`,
 *   consistent with the expression evaluator's tokenizer.
 */
describe('whitespace inside ${...} references (issue #147)', () => {
  let testLogger: TestLogger;
  let referenceResolver: ReferenceResolver;
  let evaluator: SafeExpressionEvaluator;

  beforeEach(() => {
    testLogger = new TestLogger('WhitespaceRefTest');
    const stepResults = new Map<string, any>();
    stepResults.set('producer', { result: { value: 42, nested: { deep: 'x' } } });
    stepResults.set('a', { result: 1, b: 2 });
    referenceResolver = new ReferenceResolver(stepResults, {}, testLogger);
    evaluator = new SafeExpressionEvaluator(testLogger, referenceResolver);
  });

  afterEach(() => {
    testLogger.clear();
  });

  describe('extractReferences', () => {
    it.each([
      ['${ a }', ['a']],
      ['${a }', ['a']],
      ['${ a}', ['a']],
      ['${\ta\n}', ['a']],
      ['${  a  }', ['a']],
    ])('extracts the base reference from %p', (expression, expected) => {
      expect(evaluator.extractReferences(expression)).toEqual(expected);
    });

    it('extracts base reference from nested paths with whitespace', () => {
      expect(evaluator.extractReferences('${ a.b }')).toEqual(['a']);
      expect(evaluator.extractReferences('${ a . b }')).toEqual(['a']);
    });

    it('keeps inner spaces inside quoted keys', () => {
      expect(evaluator.extractReferences("${ a['b c'] }")).toEqual(['a']);
    });

    it('still finds references nested inside whitespace-padded expressions', () => {
      expect(evaluator.extractReferences('prefix ${ a } and ${b} suffix')).toEqual(['a', 'b']);
    });
  });

  describe('resolveReference', () => {
    it.each([['${ producer }'], ['${producer }'], ['${ producer}'], ['${\tproducer\n}']])(
      'resolves %p',
      (ref) => {
        expect(referenceResolver.resolveReference(ref)).toEqual({
          result: { value: 42, nested: { deep: 'x' } },
        });
      },
    );

    it('resolves nested paths with surrounding whitespace', () => {
      expect(referenceResolver.resolveReference('${ producer.result.value }')).toBe(42);
    });

    it('resolves paths with spaces around dots', () => {
      expect(referenceResolver.resolveReference('${ producer . result . value }')).toBe(42);
    });

    it('keeps inner spaces inside quoted keys', () => {
      const stepResults = new Map<string, any>();
      stepResults.set('doc', { result: { 'b c': 'spaced key' } });
      const resolver = new ReferenceResolver(stepResults, {}, testLogger);
      expect(resolver.resolveReference("${ doc.result['b c'] }")).toBe('spaced key');
    });

    it('preserves spaces around dots inside quoted keys', () => {
      const stepResults = new Map<string, any>();
      stepResults.set('doc', { result: { 'b . c': 'dotted key' } });
      const resolver = new ReferenceResolver(stepResults, {}, testLogger);
      expect(resolver.resolveReference("${ doc.result['b . c'] }")).toBe('dotted key');
    });
  });

  describe('resolveReferences (string interpolation)', () => {
    it('interpolates whitespace-padded references inside larger strings', () => {
      expect(referenceResolver.resolveReferences('value: ${ producer.result.value }!')).toBe(
        'value: 42!',
      );
    });
  });

  describe('end-to-end flow', () => {
    const buildFlow = (): Flow => ({
      name: 'Whitespace Flow',
      description: 'flow using whitespace-padded references',
      steps: [
        {
          name: 'producer',
          request: { method: 'produce', params: {} },
        },
        {
          name: 'consumer',
          request: {
            method: 'consume',
            params: { input: '${ producer }' },
          },
        },
      ],
    });

    it('creates a dependency edge for whitespace-padded references', () => {
      const flow = buildFlow();
      const expressionEvaluator = new SafeExpressionEvaluator(
        testLogger,
        new ReferenceResolver(new Map(), {}, testLogger),
      );
      const depResolver = new DependencyResolver(flow, expressionEvaluator, testLogger);
      expect(depResolver.getDependencies('consumer')).toEqual(['producer']);
    });

    it('executes a flow whose consumer uses a whitespace-padded reference', async () => {
      const flow = buildFlow();
      const handler = jest.fn().mockImplementation((request: any) => {
        if (request.method === 'produce') {
          return Promise.resolve({ value: 42 });
        }
        return Promise.resolve({ ok: true, received: request.params });
      });
      const executor = new FlowExecutor(flow, handler, { logger: testLogger });
      const results = await executor.execute();

      expect(results.get('producer')).toBeDefined();
      const consumerResult = results.get('consumer');
      expect(consumerResult).toBeDefined();
      // The consumer's params should have received the resolved producer result.
      const consumeCall = handler.mock.calls.find((c) => c[0].method === 'consume');
      expect(consumeCall?.[0].params.input.result.value).toBe(42);
    });
  });
});
