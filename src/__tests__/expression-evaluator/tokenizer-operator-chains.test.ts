import { tokenize, TokenizerError } from '../../expression-evaluator/tokenizer';
import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

/**
 * Regression tests for issue #142: the tokenizer rejected valid unspaced
 * operator chains (e.g. `1+1+1`) with
 * `TokenizerError: Invalid operator sequence: ++`.
 *
 * Root cause: `handleOperator` advances `currentIndex` past the operator
 * token before calling `validateOperatorSequence`, which then inspected
 * `expression[currentIndex + 1]` — one character too far — and mistook the
 * next operator in a valid chain for an invalid doubled sequence.
 */
describe('tokenize: unspaced operator chains (issue #142)', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  function values(expression: string): unknown[] {
    return tokenize(expression, logger).map((t) => t.value);
  }

  it('tokenizes the reported failing case: 1+1+1', () => {
    expect(values('1+1+1')).toEqual([1, '+', 1, '+', 1]);
  });

  it('tokenizes mixed unspaced chains: 2*3-4/2', () => {
    expect(values('2*3-4/2')).toEqual([2, '*', 3, '-', 4, '/', 2]);
  });

  it('tokenizes unspaced chains with identifiers: a+b', () => {
    expect(values('a+b')).toEqual(['a', '+', 'b']);
  });

  it('tokenizes unspaced chains with multi-char operators', () => {
    expect(values('1==1')).toEqual([1, '==', 1]);
    expect(values('a!=b')).toEqual(['a', '!=', 'b']);
    expect(values('x>=10')).toEqual(['x', '>=', 10]);
    expect(values('a===b')).toEqual(['a', '===', 'b']);
  });

  it('tokenizes chained comparisons: 1<2<3', () => {
    expect(values('1<2<3')).toEqual([1, '<', 2, '<', 3]);
  });

  it('tokenizes unspaced chains containing unary operators', () => {
    expect(values('-a')).toEqual(['-', 'a']);
    expect(values('!flag')).toEqual(['!', 'flag']);
    // NOTE: `5+-3` (unary minus directly after a binary operator) is rejected
    // by the tokenizer both before and after this fix — a separate pre-existing
    // limitation of the binary-operand check, not part of issue #142.
  });

  it('still tokenizes spaced expressions', () => {
    expect(values('1 + 1 + 1')).toEqual([1, '+', 1, '+', 1]);
  });

  it('still rejects genuinely invalid sequences: 1++1', () => {
    expect(() => tokenize('1++1', logger)).toThrow(TokenizerError);
    expect(() => tokenize('1++1', logger)).toThrow(/Invalid operator sequence: \+\+/);
  });

  it('still rejects an operator followed by another operator: 1+*2', () => {
    expect(() => tokenize('1+*2', logger)).toThrow(TokenizerError);
  });

  it('still rejects other genuinely invalid sequences: 1--1, 1**1', () => {
    expect(() => tokenize('1--1', logger)).toThrow(/Invalid operator sequence: --/);
    expect(() => tokenize('1**1', logger)).toThrow(/Invalid operator sequence: \*\*/);
  });

  it('still rejects an operator with a missing operand: 1+', () => {
    expect(() => tokenize('1+', logger)).toThrow(TokenizerError);
    expect(() => tokenize('1+', logger)).toThrow(/missing right operand/);
  });
});

describe('SafeExpressionEvaluator: evaluates unspaced chains (issue #142)', () => {
  let evaluator: SafeExpressionEvaluator;
  const logger = new TestLogger('TokenizerOperatorChainsTest');

  beforeEach(() => {
    const stepResults = new Map<string, unknown>();
    const context: Record<string, unknown> = {};
    const referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  it('evaluates 1+1+1', () => {
    expect(evaluator.evaluate('1+1+1', {})).toBe(3);
  });

  it('evaluates 2*3-4/2 respecting precedence', () => {
    expect(evaluator.evaluate('2*3-4/2', {})).toBe(4);
  });

  it('evaluates 1+2*3 respecting precedence', () => {
    expect(evaluator.evaluate('1+2*3', {})).toBe(7);
  });

  it('evaluates unspaced comparisons', () => {
    expect(evaluator.evaluate('5>=5', {})).toBe(true);
    expect(evaluator.evaluate('5!=3', {})).toBe(true);
  });
});
