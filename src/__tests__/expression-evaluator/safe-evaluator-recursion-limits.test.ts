import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { FlowError, ValidationError } from '../../errors/base';
import { ErrorCode } from '../../errors/codes';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

/**
 * Regression tests for issue #47: the SafeExpressionEvaluator must not die
 * with a raw stack overflow on deeply nested input. Instead it enforces a
 * configurable maximum recursion depth and throws a structured
 * ValidationError when the limit is exceeded.
 */
describe('SafeExpressionEvaluator recursion limits (issue #47)', () => {
  let evaluator: SafeExpressionEvaluator;
  const logger = new TestLogger('SafeExpressionEvaluatorRecursionTest');

  const nest = (open: string, close: string, depth: number, leaf = '1'): string =>
    open.repeat(depth) + leaf + close.repeat(depth);

  beforeEach(() => {
    const stepResults = new Map<string, any>();
    const context: Record<string, any> = {};
    const referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  describe('extractReferences', () => {
    it('throws a structured ValidationError for deeply nested template literals', () => {
      const deep = nest('${', '}', SafeExpressionEvaluator.MAX_RECURSION_DEPTH + 50, 'x');

      let caught: unknown;
      try {
        evaluator.extractReferences(deep);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught).toBeInstanceOf(FlowError);
      const err = caught as ValidationError;
      expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(err.message).toContain('Maximum expression nesting depth');
      expect(err.context.maxDepth).toBe(SafeExpressionEvaluator.MAX_RECURSION_DEPTH);
      expect(err.context.operation).toBe('reference extraction');
    });

    it('still extracts references from moderately nested expressions', () => {
      const refs = evaluator.extractReferences('${a.${b.${c}}} and ${d}');
      expect(refs).toContain('a');
      expect(refs).toContain('b');
      expect(refs).toContain('c');
      expect(refs).toContain('d');
    });

    it('still returns an empty array for malformed references', () => {
      expect(evaluator.extractReferences('${unclosed')).toEqual([]);
      expect(evaluator.extractReferences('no references here')).toEqual([]);
    });
  });

  describe('evaluate - parsing', () => {
    it('throws a structured ValidationError for deeply nested array literals', () => {
      const deep = nest('[', ']', SafeExpressionEvaluator.MAX_RECURSION_DEPTH + 50);

      let caught: unknown;
      try {
        evaluator.evaluate(deep, {});
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      expect(caught).toBeInstanceOf(FlowError);
      const err = caught as ValidationError;
      expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(err.message).toContain('Maximum expression nesting depth');
      expect(err.context.operation).toBe('expression parsing');
    });

    it('throws a structured ValidationError for deeply nested object literals', () => {
      const deep = nest('{a:', '}', SafeExpressionEvaluator.MAX_RECURSION_DEPTH + 50);

      expect(() => evaluator.evaluate(deep, {})).toThrow(ValidationError);
      try {
        evaluator.evaluate(deep, {});
      } catch (error) {
        expect((error as ValidationError).code).toBe(ErrorCode.VALIDATION_ERROR);
      }
    });

    it('evaluates normally nested arrays and objects', () => {
      expect(evaluator.evaluate('[1, 2, [3, 4]]', {})).toEqual([1, 2, [3, 4]]);
      expect(evaluator.evaluate('{a: {b: 1}}', {})).toEqual({ a: { b: 1 } });
      expect(evaluator.evaluate('2 + 3 * 4', {})).toBe(14);
    });
  });

  describe('evaluate - AST evaluation', () => {
    it('throws a structured ValidationError for very long operator chains', () => {
      // A long left-associative chain builds a deep AST without deep parse
      // recursion, so this exercises the evaluateAst depth guard. (Note:
      // operators need surrounding spaces due to a separate pre-existing
      // tokenizer quirk with unspaced chains like `1+1+1`.)
      const chain = '1 + '.repeat(SafeExpressionEvaluator.MAX_RECURSION_DEPTH + 50) + '1';

      let caught: unknown;
      try {
        evaluator.evaluate(chain, {});
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ValidationError);
      const err = caught as ValidationError;
      expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(err.context.operation).toBe('expression evaluation');
    });

    it('evaluates normal operator chains', () => {
      expect(evaluator.evaluate('1 + 2 + 3 + 4', {})).toBe(10);
    });
  });

  describe('configurable depth limit', () => {
    it('honors a custom maxRecursionDepth from the constructor', () => {
      const stepResults = new Map<string, any>();
      const referenceResolver = new ReferenceResolver(stepResults, {}, logger);
      const strict = new SafeExpressionEvaluator(logger, referenceResolver, undefined, 5);

      // Exactly at the limit: fine
      expect(strict.evaluate(nest('[', ']', 5), {})).toEqual([[[[[1]]]]]);
      // One past the limit: structured error
      expect(() => strict.evaluate(nest('[', ']', 6), {})).toThrow(ValidationError);
      try {
        strict.evaluate(nest('[', ']', 6), {});
      } catch (error) {
        expect((error as ValidationError).context.maxDepth).toBe(5);
      }
    });

    it('enforces the limit on nested function calls', () => {
      const stepResults = new Map<string, any>();
      const referenceResolver = new ReferenceResolver(stepResults, {}, logger);
      const strict = new SafeExpressionEvaluator(logger, referenceResolver, undefined, 5);

      const nestedCall = (depth: number) => 'Number('.repeat(depth) + '1' + ')'.repeat(depth);
      expect(strict.evaluate(nestedCall(5), {})).toBe(1);
      expect(() => strict.evaluate(nestedCall(6), {})).toThrow(ValidationError);
    });

    it('exposes the default limit as a named constant', () => {
      expect(SafeExpressionEvaluator.MAX_RECURSION_DEPTH).toBe(100);
    });
  });
});
