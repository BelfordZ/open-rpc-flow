import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { ValidationError } from '../../errors/base';
import { ReferenceResolver } from '../../reference-resolver';
import { TestLogger } from '../../util/logger';
import { tokenize, TokenizerError } from '../../expression-evaluator/tokenizer';

/**
 * Comprehensive tests for prefix unary operator support (`-`, `+`, `!`).
 *
 * Covers GitHub issues:
 * - #144: tokenizer rejected a unary operator immediately following a binary
 *   operator (e.g. `5 + -3` threw `Operator + missing right operand`).
 * - #149: the parser had no unary-operator handling at all (e.g. `-(2 + 3)`
 *   and `!true` threw `Unexpected operator`).
 *
 * Documented semantics:
 * - Unary operators bind tighter than any binary operator
 *   (`-2 * 3` === `(-2) * 3` === -6).
 * - `!` follows JavaScript truthiness (`!0` === true, `!"abc"` === false).
 * - Unary `-`/`+` require numeric operands (consistent with binary `-`).
 * - `--` and `++` remain invalid operator sequences even though they could be
 *   read as binary+unary (explicitly listed in INVALID_OPERATOR_SEQUENCES);
 *   the spaced forms (`5 - -3`, `1 + +1`) are accepted.
 * - `!!x` (double negation) is allowed; `!` chains with `-`/`+` are allowed
 *   (e.g. `!-+5`), but a second `-`/`+` after a unary `-`/`+` is rejected via
 *   the invalid-sequence list.
 */
describe('Unary operators', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  const logger = new TestLogger('UnaryOperatorsTest');

  beforeEach(() => {
    stepResults = new Map();
    context = {};
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  describe('tokenizer: unary operator after binary operator (issue #144)', () => {
    it('tokenizes `5 + -3` (spaced)', () => {
      const tokens = tokenize('5 + -3', logger);
      expect(tokens.map((t) => t.value)).toEqual([5, '+', '-', 3]);
      expect(tokens.map((t) => t.type)).toEqual(['number', 'operator', 'operator', 'number']);
    });

    it('tokenizes `5+-3` (unspaced)', () => {
      expect(tokenize('5+-3', logger).map((t) => t.value)).toEqual([5, '+', '-', 3]);
    });

    it('tokenizes unary minus after `*` and `/`', () => {
      expect(tokenize('10 * -2', logger).map((t) => t.value)).toEqual([10, '*', '-', 2]);
      expect(tokenize('10/-2', logger).map((t) => t.value)).toEqual([10, '/', '-', 2]);
    });

    it('tokenizes spaced double minus as binary minus + unary minus', () => {
      expect(tokenize('5 - -3', logger).map((t) => t.value)).toEqual([5, '-', '-', 3]);
    });

    it('tokenizes unary plus after a binary operator', () => {
      expect(tokenize('2 * +3', logger).map((t) => t.value)).toEqual([2, '*', '+', 3]);
    });

    it('tokenizes leading unary operators', () => {
      expect(tokenize('!true', logger).map((t) => t.value)).toEqual(['!', 'true']);
      expect(tokenize('-(2 + 3)', logger).map((t) => t.value)).toEqual(['-', '(', 2, '+', 3, ')']);
      expect(tokenize('- 5', logger).map((t) => t.value)).toEqual(['-', 5]);
    });

    it('tokenizes chained unary `!` operators', () => {
      expect(tokenize('!!true', logger).map((t) => t.value)).toEqual(['!', '!', 'true']);
    });

    it('still rejects `--` and `++` as invalid operator sequences', () => {
      expect(() => tokenize('--5', logger)).toThrow(TokenizerError);
      expect(() => tokenize('--5', logger)).toThrow('Invalid operator sequence: --');
      expect(() => tokenize('1++1', logger)).toThrow('Invalid operator sequence: ++');
      expect(() => tokenize('1--1', logger)).toThrow('Invalid operator sequence: --');
      expect(() => tokenize('5--3', logger)).toThrow('Invalid operator sequence: --');
      expect(() => tokenize('1**1', logger)).toThrow('Invalid operator sequence: **');
    });

    it('still rejects non-unary operators after a binary operator', () => {
      expect(() => tokenize('1+*2', logger)).toThrow(TokenizerError);
      expect(() => tokenize('1+*2', logger)).toThrow('Operator + missing right operand');
      expect(() => tokenize('2 + * 3', logger)).toThrow('Operator + missing right operand');
    });

    it('still rejects a dangling unary operator with no operand', () => {
      expect(() => tokenize('5 + -', logger)).toThrow('Unary operator - missing operand');
      expect(() => tokenize('!', logger)).toThrow('Unary operator ! missing operand');
      expect(() => tokenize('-', logger)).toThrow('Unary operator - missing operand');
      expect(() => tokenize('!*x', logger)).toThrow('Unary operator ! missing operand');
    });
  });

  describe('parser/evaluator: unary operators (issue #149)', () => {
    it('evaluates unary minus/plus after a binary operator', () => {
      expect(evaluator.evaluate('1 + -5', {})).toBe(-4);
      expect(evaluator.evaluate('5 + -3', {})).toBe(2);
      expect(evaluator.evaluate('5+-3', {})).toBe(2);
      expect(evaluator.evaluate('10 * -2', {})).toBe(-20);
      expect(evaluator.evaluate('10 / -2', {})).toBe(-5);
      expect(evaluator.evaluate('5 - -3', {})).toBe(8);
      expect(evaluator.evaluate('2 * +3', {})).toBe(6);
      expect(evaluator.evaluate('1 + +1', {})).toBe(2);
    });

    it('evaluates standalone prefix unary operators', () => {
      expect(evaluator.evaluate('-(2 + 3)', {})).toBe(-5);
      expect(evaluator.evaluate('!true', {})).toBe(false);
      expect(evaluator.evaluate('!false', {})).toBe(true);
      expect(evaluator.evaluate('(-5)', {})).toBe(-5);
      expect(evaluator.evaluate('- 5', {})).toBe(-5);
      expect(evaluator.evaluate('+ 2', {})).toBe(2);
      expect(evaluator.evaluate('-(2 + 3) * 2', {})).toBe(-10);
    });

    it('gives unary operators higher precedence than binary operators', () => {
      // Unary binds tighter than `*`/`/`/`%`, which bind tighter than `+`/`-`.
      expect(evaluator.evaluate('-2 * 3', {})).toBe(-6);
      expect(evaluator.evaluate('2 * -3', {})).toBe(-6);
      expect(evaluator.evaluate('1 + -2 * 3', {})).toBe(-5);
      expect(evaluator.evaluate('2 * -3 + 1', {})).toBe(-5);
      expect(evaluator.evaluate('!true && false', {})).toBe(false);
      expect(evaluator.evaluate('!false || false', {})).toBe(true);
      expect(evaluator.evaluate('!(true && false)', {})).toBe(true);
    });

    it('evaluates chained unary operators', () => {
      expect(evaluator.evaluate('!!true', {})).toBe(true);
      expect(evaluator.evaluate('!!false', {})).toBe(false);
      expect(evaluator.evaluate('!!0', {})).toBe(false);
      expect(evaluator.evaluate('+-5', {})).toBe(-5);
      expect(evaluator.evaluate('-+5', {})).toBe(-5);
    });

    it('applies JavaScript truthiness rules for `!`', () => {
      expect(evaluator.evaluate('!0', {})).toBe(true);
      expect(evaluator.evaluate('!1', {})).toBe(false);
      expect(evaluator.evaluate('!""', {})).toBe(true);
      expect(evaluator.evaluate('!"abc"', {})).toBe(false);
      expect(evaluator.evaluate('!null', {})).toBe(true);
    });

    it('evaluates unary operators applied to references', () => {
      expect(evaluator.evaluate('${x} + -${y}', { x: 10, y: 3 })).toBe(7);
      expect(evaluator.evaluate('!${flag}', { flag: false })).toBe(true);
      expect(evaluator.evaluate('-${amount}', { amount: 42 })).toBe(-42);
      expect(evaluator.evaluate('!!${flag}', { flag: 0 })).toBe(false);
    });

    it('evaluates unary operators inside function call arguments', () => {
      expect(evaluator.evaluate('Number(-5)', {})).toBe(-5);
    });

    it('throws ExpressionError for unary minus/plus on non-numeric values', () => {
      expect(() => evaluator.evaluate('-"abc"', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('+"abc"', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('-"abc"', {})).toThrow(/non-numeric/);
    });

    it('still rejects invalid operator sequences at evaluate time', () => {
      expect(() => evaluator.evaluate('1++1', {})).toThrow(/Invalid operator sequence: \+\+/);
      expect(() => evaluator.evaluate('--5', {})).toThrow(/Invalid operator sequence: --/);
      expect(() => evaluator.evaluate('1+*2', {})).toThrow(/missing right operand/);
      expect(() => evaluator.evaluate('5 + -', {})).toThrow(/Unary operator - missing operand/);
    });

    it('throws ExpressionError for a unary operator with a missing operand', () => {
      // Defensive: the tokenizer rejects these, but a malformed token stream
      // (e.g. inside a function call) must still fail cleanly.
      expect(() => evaluator.evaluate('Number(-)', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('Number(-)', {})).toThrow(/Invalid unary operation node/);
    });

    it('enforces the recursion depth limit on deep unary chains', () => {
      // A chain longer than MAX_RECURSION_DEPTH must trip the depth guard
      // (ValidationError), not recurse without bound. Must stay under
      // MAX_EXPRESSION_LENGTH (1000) to reach evaluation.
      const deep = '!'.repeat(SafeExpressionEvaluator.MAX_RECURSION_DEPTH + 50) + 'true';
      expect(deep.length).toBeLessThan(1000);
      expect(() => evaluator.evaluate(deep, {})).toThrow(ValidationError);
      expect(() => evaluator.evaluate(deep, {})).toThrow(/Maximum expression nesting depth/);

      // Shallow chains still evaluate normally (even count -> true)
      expect(evaluator.evaluate('!'.repeat(10) + 'true', {})).toBe(true);
    });
  });
});
