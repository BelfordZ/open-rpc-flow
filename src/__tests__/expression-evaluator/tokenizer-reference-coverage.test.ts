import { tokenize, TokenizerError } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Reference Handling Coverage', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  describe('unterminated references (lines 222-226)', () => {
    // Specifically targeting bracketCount path and line 222-226
    it('directly tests the handleReference loop exit path', () => {
      // Let's test a reference with an unclosed bracket, should throw the right error
      const refWithUnclosedBracket = '${foo{bar';
      expect(() => tokenize(refWithUnclosedBracket, logger)).toThrow(
        new TokenizerError('Unterminated reference'),
      );
    });

    // This test directly targets the exact line where the error is thrown (line 222-226)
    // by creating a condition where all other paths in the handleReference function are avoided
    it('throws error for truly edge case unterminated reference', () => {
      // Empty reference - just "${" with nothing else, forces immediate loop exit and error
      expect(() => tokenize('${', logger)).toThrow(new TokenizerError('Unterminated reference'));
    });

    it('throws error for simple unterminated reference', () => {
      expect(() => tokenize('${foo', logger)).toThrow(new TokenizerError('Unterminated reference'));
    });

    it('throws error for unterminated reference with content ending in bracket', () => {
      expect(() => tokenize('${foo[', logger)).toThrow(
        new TokenizerError('Unterminated reference'),
      );
    });

    it('throws error for unterminated reference with content after nested reference', () => {
      expect(() => tokenize('${foo${bar}.baz', logger)).toThrow(
        new TokenizerError('Unterminated reference'),
      );
    });

    it('throws error for unterminated reference with operators', () => {
      expect(() => tokenize('${foo + bar', logger)).toThrow(
        new TokenizerError('Unterminated reference'),
      );
    });

    it('throws error for unterminated reference with complex mixed content', () => {
      expect(() => tokenize('${foo && bar[${baz}].prop', logger)).toThrow(
        new TokenizerError('Unterminated reference'),
      );
    });

    it('throws error for unterminated nested reference with complete outer reference', () => {
      // This is a case where we have ${foo[${bar]} - inner reference is complete but outer is not
      expect(() => tokenize('${foo[${bar}]', logger)).toThrow(
        new TokenizerError('Unterminated reference'),
      );
    });

    it('throws error when whitespace follows an opening brace without closing', () => {
      expect(() => tokenize('${ ', logger)).toThrow(new TokenizerError('Unterminated reference'));
    });

    it('throws error when unterminated reference is at end of string', () => {
      // This forces the tokenizer to reach the end of the string while inside a reference
      const longUnclosedRef =
        '${something.very.long.that.will.definitely.reach.the.end.of.the.string';
      expect(() => tokenize(longUnclosedRef, logger)).toThrow(
        new TokenizerError('Unterminated reference'),
      );
    });

    it('throws error when unterminated reference continues past expected end', () => {
      // Test with complex structure to ensure we go through many iterations
      const complexExpression = '${a.b.c[d].e.f.g + h - i * j / k}';
      // Truncate the closing brace
      const truncatedExpression = complexExpression.substring(0, complexExpression.length - 1);
      expect(() => tokenize(truncatedExpression, logger)).toThrow(
        new TokenizerError('Unterminated reference'),
      );
    });

    it('throws error with complex reference structure that exhausts the reference handler', () => {
      // Create an expression that attempts to exercise all branches in the handleReference function
      // but with no closing brace
      const complexRef = '${a[0].b[${c}][${d.e}] + f.g * h - ${i.j}}';

      // Remove the closing brace to make it unterminated
      const unterminated = complexRef.substring(0, complexRef.length - 1);

      expect(() => tokenize(unterminated, logger)).toThrow(
        new TokenizerError('Unterminated reference'),
      );
    });

    it('throws error with alternating operators and nested refs', () => {
      const alternatingExpr = '${a + ${b} - ${c} * ${d} / ${e}';
      expect(() => tokenize(alternatingExpr, logger)).toThrow(
        new TokenizerError('Unterminated reference'),
      );
    });

    it('throws error for reference with multiple nested references with mismatched braces', () => {
      expect(() => tokenize('${foo[${bar${baz}]', logger)).toThrow();
    });

    it('throws error for long reference chain ending abruptly', () => {
      // Create a very long property chain with no closing
      let expr = '${obj';
      for (let i = 0; i < 100; i++) {
        expr += `.prop${i}`;
      }
      expect(() => tokenize(expr, logger)).toThrow(new TokenizerError('Unterminated reference'));
    });

    it('throws error for extremely complex unterminated reference', () => {
      // Mixing different types of expressions and nested content
      const expr = '${a.b[c].d[${e.f[${g.h[${i.j}].k}]}].l[m[${n.o}]]}';
      // Without closing brace
      const unclosed = expr.slice(0, -1);
      expect(() => tokenize(unclosed, logger)).toThrow(
        new TokenizerError('Unterminated reference'),
      );
    });

    it('throws error for reference with invalid operator sequence', () => {
      expect(() => tokenize('${foo + + bar', logger)).toThrow();
    });

    it('throws error for reference with unterminated string inside', () => {
      expect(() => tokenize('${foo + "unterminated string', logger)).toThrow();
    });
  });
});
