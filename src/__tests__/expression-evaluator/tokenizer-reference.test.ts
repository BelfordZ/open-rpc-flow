import { tokenize, TokenizerError, Token } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

function expectTokenArrayValue(
  token: Token,
  expectedType: 'array_literal' | 'reference' | 'object_literal' | 'template_literal',
): Token[] {
  expect(token.type).toBe(expectedType);
  if (token.type !== expectedType) {
    throw new Error(`Expected ${expectedType} token`);
  }
  return token.value;
}

describe('Tokenizer Reference Tests', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  // From tokenizer-reference-brace.test.ts
  describe('Nested Braces in References', () => {
    it('handles nested curly braces in references', () => {
      // The expression contains a nested curly brace that should increment the bracketCount
      const expression = '${foo{bar}}';

      const result = tokenize(expression, logger);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('reference');

      // The reference should contain both 'foo' and 'bar' as parts of its tokens
      const referenceValue = (result[0] as any).value;
      expect(referenceValue.length).toBeGreaterThan(1);

      // Check that at least one token contains 'foo' and one contains 'bar'
      const tokens = referenceValue.map((t: any) => t.value);
      const joinedTokens = tokens.join('');
      expect(joinedTokens).toContain('foo');
      expect(joinedTokens).toContain('bar');
    });

    it('handles multiple levels of nested braces in references', () => {
      // This should test the bracketCount increment multiple times
      const expression = '${foo{bar{baz}}}';

      const result = tokenize(expression, logger);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('reference');
    });

    it('handles nested braces with identifiers and operators', () => {
      // Test with braces and various tokenizable elements
      const expression = '${obj{prop: value}}';

      const result = tokenize(expression, logger);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('reference');
    });

    it('handles object literals with nested braces inside references', () => {
      // Test with object literal syntax inside a reference
      const expression = '${obj = { nested: { prop: value } }}';

      const result = tokenize(expression, logger);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('reference');
    });
  });

  // From tokenizer-reference-coverage.test.ts
  describe('Unterminated References', () => {
    it('directly tests the handleReference loop exit path', () => {
      // Let's test a reference with an unclosed bracket, should throw the right error
      const refWithUnclosedBracket = '${foo{bar';
      expect(() => tokenize(refWithUnclosedBracket, logger)).toThrow(
        new TokenizerError('Unterminated reference'),
      );
    });

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

  // From tokenizer-reference-whitespace.test.ts
  describe('Whitespace Handling in References', () => {
    it('correctly handles whitespace in a reference expression with a buffer', () => {
      // This test specifically targets lines 238-239 in tokenizer.ts
      // where whitespace is handled in a reference when textBuffer is non-empty and not in operator
      const expression = '${foo  }';

      const result = tokenize(expression, logger);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('reference');

      // Check that the reference token has the identifier 'foo'
      const refValue = expectTokenArrayValue(result[0], 'reference');
      expect(refValue).toHaveLength(1);
      expect(refValue[0].type).toBe('identifier');
      expect(refValue[0].value).toBe('foo');
    });

    it('handles whitespace between multiple identifiers in a reference', () => {
      const expression = '${foo  bar}';

      const result = tokenize(expression, logger);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('reference');

      const refValue = expectTokenArrayValue(result[0], 'reference');
      expect(refValue).toHaveLength(2);
      expect(refValue[0].type).toBe('identifier');
      expect(refValue[0].value).toBe('foo');
      expect(refValue[1].type).toBe('identifier');
      expect(refValue[1].value).toBe('bar');
    });

    it('handles whitespace after an identifier when followed by an operator', () => {
      const expression = '${foo  +bar}';

      const result = tokenize(expression, logger);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('reference');

      const refValue = expectTokenArrayValue(result[0], 'reference');
      expect(refValue).toHaveLength(3);
      expect(refValue[0].type).toBe('identifier');
      expect(refValue[0].value).toBe('foo');
      expect(refValue[1].type).toBe('operator');
      expect(refValue[1].value).toBe('+');
      expect(refValue[2].type).toBe('identifier');
      expect(refValue[2].value).toBe('bar');
    });

    it('handles multiple whitespace characters (spaces, tabs, newlines) after an identifier', () => {
      const expression = '${foo \t\n }';

      const result = tokenize(expression, logger);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('reference');

      const refValue = expectTokenArrayValue(result[0], 'reference');
      expect(refValue).toHaveLength(1);
      expect(refValue[0].type).toBe('identifier');
      expect(refValue[0].value).toBe('foo');
    });

    it('handles whitespace in a complex expression', () => {
      const expression = '${foo  .bar[baz   ] }';

      const result = tokenize(expression, logger);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('reference');

      const refValue = expectTokenArrayValue(result[0], 'reference');
      // Verify we have the expected tokens in the reference
      expect(refValue.length).toBeGreaterThan(3);

      // The important assertion here is that whitespace between tokens is properly handled
      const identifierCount = refValue.filter((t) => t.type === 'identifier').length;
      expect(identifierCount).toBe(3); // foo, bar, baz
    });

    it('flushes buffer when whitespace is encountered after an identifier', () => {
      // Test various whitespace characters after an identifier
      const expressions = [
        '${abc }', // space
        '${abc\t}', // tab
        '${abc\n}', // newline
        '${abc\r}', // carriage return
        '${abc\f}', // form feed
        '${abc\v}', // vertical tab
      ];

      for (const expression of expressions) {
        const result = tokenize(expression, logger);

        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('reference');

        const referenceValue = (result[0] as any).value;
        expect(referenceValue).toHaveLength(1);
        expect(referenceValue[0].type).toBe('identifier');
        expect(referenceValue[0].value).toBe('abc');
      }
    });

    it('preserves whitespace handling in a multi-token reference', () => {
      // Test whitespace after the first identifier in a multi-token reference
      const expression = '${abc def}';

      const result = tokenize(expression, logger);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('reference');

      const referenceValue = expectTokenArrayValue(result[0], 'reference');
      expect(referenceValue).toHaveLength(2);
      expect(referenceValue[0].type).toBe('identifier');
      expect(referenceValue[0].value).toBe('abc');
      expect(referenceValue[1].type).toBe('identifier');
      expect(referenceValue[1].value).toBe('def');
    });

    it('flushes buffer for whitespace in complex expressions', () => {
      const expressions = [
        '${abc .prop}', // whitespace before dot operator
        '${obj[ key ]}', // whitespace in brackets
        '${a + b }', // whitespace after full expression
        '${func(a, b )}', // whitespace in function call
      ];

      for (const expression of expressions) {
        const result = tokenize(expression, logger);
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('reference');
      }
    });
  });
});
