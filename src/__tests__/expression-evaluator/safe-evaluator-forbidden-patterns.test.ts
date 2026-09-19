import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

/**
 * Regression tests for issue #148: the dangerous-pattern filter was a blunt
 * substring match (`expression.includes(pattern)`), rejecting innocent
 * expressions like `"evaluation"`, `${myFunctions}`, or `doc.retrieval`.
 *
 * The filter is now token-aware: only actual `identifier` tokens are compared
 * against the forbidden set (recursing into nested token arrays), and string
 * literals are skipped. Real threats must still be rejected.
 */
describe('SafeExpressionEvaluator forbidden-pattern filter (issue #148)', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  const logger = new TestLogger('ForbiddenPatternsTest');

  beforeEach(() => {
    stepResults = new Map<string, any>([
      ['myFunctions', 42],
      ['doc', { retrieval: 'done' }],
    ]);
    const referenceResolver = new ReferenceResolver(stepResults, {}, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  describe('innocent expressions are accepted', () => {
    it('accepts string literals containing forbidden substrings', () => {
      expect(evaluator.evaluate('"evaluation"', {})).toBe('evaluation');
      expect(evaluator.evaluate('"retrieval interval"', {})).toBe('retrieval interval');
      expect(evaluator.evaluate('`the evaluation is complete`', {})).toBe(
        'the evaluation is complete',
      );
    });

    it('accepts references whose names contain forbidden substrings', () => {
      expect(evaluator.evaluate('${myFunctions}', {})).toBe(42);
      expect(evaluator.evaluate('${doc.retrieval}', {})).toBe('done');
    });

    it('accepts object keys containing forbidden substrings', () => {
      expect(evaluator.evaluate('{evaluation: 1}', {})).toEqual({ evaluation: 1 });
    });
  });

  describe('real threats are still rejected', () => {
    it('rejects eval and Function as identifiers', () => {
      expect(() => evaluator.evaluate('eval("alert(1)")', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('eval("alert(1)")', {})).toThrow(
        'Expression contains forbidden pattern: eval',
      );
      expect(() => evaluator.evaluate('Function("return 1")', {})).toThrow(
        'Expression contains forbidden pattern: Function',
      );
    });

    it('rejects constructor/__proto__/prototype as identifiers', () => {
      expect(() => evaluator.evaluate('something.constructor', {})).toThrow(
        'Expression contains forbidden pattern: constructor',
      );
      expect(() => evaluator.evaluate('something.__proto__', {})).toThrow(
        'Expression contains forbidden pattern: __proto__',
      );
      expect(() => evaluator.evaluate('something.prototype', {})).toThrow(
        'Expression contains forbidden pattern: prototype',
      );
    });

    it('rejects forbidden identifiers inside ${...} references', () => {
      expect(() => evaluator.evaluate('${constructor}', {})).toThrow(
        'Expression contains forbidden pattern: constructor',
      );
      expect(() => evaluator.evaluate('${x.__proto__}', {})).toThrow(
        'Expression contains forbidden pattern: __proto__',
      );
      expect(() => evaluator.evaluate('${prototype}', {})).toThrow(
        'Expression contains forbidden pattern: prototype',
      );
    });
  });
});
