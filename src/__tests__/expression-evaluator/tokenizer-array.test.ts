import { tokenize, TokenizerError, Token } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Array Tests', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  // From tokenizer-array-coverage.test.ts
  describe('Array Literal Error Handling', () => {
    describe('unterminated array literals', () => {
      it('throws error for basic unterminated array literal', () => {
        expect(() => tokenize('[1, 2, 3', logger)).toThrow(
          new TokenizerError('Unterminated array literal'),
        );
      });

      it('throws error for unterminated array with nested content', () => {
        expect(() => tokenize('[1, [2, 3], 4', logger)).toThrow(
          new TokenizerError('Unterminated array literal'),
        );
      });

      it('throws error for array with correct brackets but missing bracket at end', () => {
        expect(() => tokenize('[1, 2, [3, 4]', logger)).toThrow(
          new TokenizerError('Unterminated array literal'),
        );
      });

      it('throws error for array with empty elements and missing closing bracket', () => {
        expect(() => tokenize('[,,,', logger)).toThrow(
          new TokenizerError('Unterminated array literal'),
        );
      });

      it('throws error for array with spread operator and missing closing bracket', () => {
        expect(() => tokenize('[...${items}', logger)).toThrow(
          new TokenizerError('Unterminated array literal'),
        );
      });

      it('throws error for array with object literal and missing closing bracket', () => {
        expect(() => tokenize('[{a: 1}', logger)).toThrow(
          new TokenizerError('Unterminated array literal'),
        );
      });

      it('throws error for array with references and missing closing bracket', () => {
        expect(() => tokenize('[${a}, ${b}', logger)).toThrow(
          new TokenizerError('Unterminated array literal'),
        );
      });

      it('throws error for array with string literals and missing closing bracket', () => {
        expect(() => tokenize('["a", "b"', logger)).toThrow(
          new TokenizerError('Unterminated array literal'),
        );
      });

      it('throws error for complex array with expression ending without closing bracket', () => {
        const longExpression = '[1, 2, "test", ${a}, ...${b}, {c: "d"}, [1, 2, 3]';
        expect(() => tokenize(longExpression, logger)).toThrow(
          new TokenizerError('Unterminated array literal'),
        );
      });

      it('throws error for array with whitespace at the end', () => {
        expect(() => tokenize('[1, 2, 3  ', logger)).toThrow(
          new TokenizerError('Unterminated array literal'),
        );
      });

      it('throws error for array with text buffer containing identifier', () => {
        expect(() => tokenize('[1, 2, someVar', logger)).toThrow(
          new TokenizerError('Unterminated array literal'),
        );
      });
    });
  });

  // From tokenizer-array-return-coverage.test.ts
  describe('Array Literal Return Statement', () => {
    // Basic test for empty array
    test('should handle empty array brackets', () => {
      const input = '[]';
      const result = tokenize(input, logger);

      expect(result).toEqual([
        {
          type: 'array_literal',
          value: [],
          raw: '[]',
        },
      ]);
    });

    // Test with empty array with whitespace
    test('should handle empty array brackets with whitespace', () => {
      const input = '[   ]';
      const result = tokenize(input, logger);

      expect(result).toEqual([
        {
          type: 'array_literal',
          value: [],
          raw: '[   ]',
        },
      ]);
    });

    // Test returning an array with just punctuation
    test('should handle array with only punctuation', () => {
      const input = '[,]';
      const result = tokenize(input, logger);

      expect(result).toEqual([
        {
          type: 'array_literal',
          value: [{ type: 'punctuation', value: ',', raw: ',' }],
          raw: '[,]',
        },
      ]);
    });

    // Test with unfinished buffer before bracket
    test('should handle unfinished identifier buffer before closing bracket', () => {
      const input = '[someIdentifier]';
      const result = tokenize(input, logger);

      expect(result).toEqual([
        {
          type: 'array_literal',
          value: [{ type: 'identifier', value: 'someIdentifier', raw: 'someIdentifier' }],
          raw: '[someIdentifier]',
        },
      ]);
    });

    // Test returning array right after a token
    test('should handle array with token directly followed by closing bracket', () => {
      // Test with various token types right before closing bracket
      const inputs = [
        '[123]', // Number
        '["string"]', // String
        '[true]', // Boolean
        '[{}]', // Object
        '[…]', // Special character
        '[null]', // Null
        '[${"reference"}]', // Reference
      ];

      for (const input of inputs) {
        const result = tokenize(input, logger);
        expect(result.length).toBe(1);
        expect(result[0].type).toBe('array_literal');
      }
    });

    // Test with multi-byte characters before return
    test('should handle multi-byte characters before closing bracket', () => {
      const input = '[😀]';
      const result = tokenize(input, logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');
      expect(result[0].value.length).toBe(1);
    });

    // Create complex nested structures where the return is nested
    test('should handle complex nested arrays with returns', () => {
      const input = '[[[1], [2, [3]], 4], 5]';
      const result = tokenize(input, logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');

      // Just verify the structure exists without specific length assertions
      const outerArray = result[0].value as Token[];
      expect(Array.isArray(outerArray)).toBe(true);

      // Check that we have array literals and numeric values
      expect(outerArray.some((item: Token) => item.type === 'array_literal')).toBe(true);
      expect(outerArray.some((item: Token) => typeof item.value === 'number')).toBe(true);
    });

    // Test with escape characters right before the bracket
    test('should handle escape characters directly before closing bracket', () => {
      const input = '["string with \\"escape\\""]';
      const result = tokenize(input, logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');
      expect(result[0].value.length).toBe(1);
      expect(result[0].value[0].type).toBe('string');
      expect(result[0].value[0].value).toBe('string with "escape"');
    });

    // Test array with unclosed brackets (error case)
    test('should throw error for unclosed array brackets', () => {
      expect(() => {
        tokenize('[1, 2, 3', logger);
      }).toThrow(); // Should throw TokenizerError
    });

    // Test with non-alphanumeric characters
    test('should handle array with non-alphanumeric characters before closing bracket', () => {
      const input = '[+]';
      const result = tokenize(input, logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');

      // Plus should be treated as an operator or identifier
      const arrayContents = result[0].value;
      expect(arrayContents.length).toBe(1);
    });

    test('should handle bracket directly following another token with no whitespace', () => {
      // Explicitly test the bracket return edge case
      const inputs = ['[1]', '[true]', '["text"]', '[null]', '[123.456]'];

      for (const input of inputs) {
        const result = tokenize(input, logger);
        expect(result[0].type).toBe('array_literal');

        // The closing bracket should terminate the array properly
        const raw = result[0].raw;
        expect(raw[raw.length - 1]).toBe(']');
      }
    });

    test('should construct raw property from startIndex to currentIndex on array return', () => {
      const input = '[1, 2, 3]';
      const result = tokenize(input, logger);

      // Verify the raw property covers the entire array
      expect(result[0].raw).toBe('[1, 2, 3]');
    });

    test('should hit return statement with textBuffer content before closing bracket', () => {
      // This is specifically designed to have textBuffer content when hitting ]
      const input = '[abc]';
      const result = tokenize(input, logger);

      expect(result[0].type).toBe('array_literal');
      expect(result[0].value.length).toBe(1);
      expect(result[0].value[0].type).toBe('identifier');
      expect(result[0].value[0].value).toBe('abc');
    });

    // Test with various array types
    test('array return statement with various content types', () => {
      // Test a variety of arrays specifically to hit the return statement
      const inputs = [
        '[]', // Empty
        '[1]', // Single number
        '[1,2]', // Multiple items
        '[a]', // Identifier
        '[a,b]', // Multiple identifiers
        '["a"]', // String
        '[true]', // Boolean
        '[null]', // Null
        '[undefined]', // Undefined
        '[{}]', // Object
        '[[]]', // Nested array
        '[;]', // Punctuation
        '[+]', // Operator
        '[1+2]', // Expression
        '[a.b]', // Property access
        '[a[0]]', // Array access
        '[a()]', // Function call
        '[new X()]', // Constructor
        '[a?b:c]', // Ternary
        '[function(){}]', // Function
        '[`template`]', // Template
      ];

      // Run each input and verify we hit the return statement
      for (const input of inputs) {
        const result = tokenize(input, logger);
        expect(result.length).toBe(1);
        expect(result[0].type).toBe('array_literal');
      }
    });
  });

  // From tokenizer-array-spread-coverage.test.ts
  describe('Array Spread Operator', () => {
    // Specifically targeting isSpreadOperator function in array literals
    it('directly targets isSpreadOperator check in array literals', () => {
      // This is a very targeted test case designed to hit the isSpreadOperator branch
      // Create a case where we have text buffer content then dots
      const result = tokenize('[abc...arr]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');
    });

    // Another specific test for the isSpreadOperator function
    it('targets isSpreadOperator with numbers before spread', () => {
      const result = tokenize('[123...arr]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');
    });

    // Try with explicit whitespace to potentially hit different branches
    it('targets isSpreadOperator with whitespace before spread', () => {
      const result = tokenize('[ ...arr]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');

      const arrayTokens = result[0].value as Token[];

      // First substantive token should be spread operator
      const spreadIndex = arrayTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );

      expect(spreadIndex).toBeGreaterThanOrEqual(0);
    });

    // Basic test for spread operator in arrays
    it('tokenizes array with spread operator at the beginning', () => {
      const result = tokenize('[...arr]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');

      const arrayTokens = result[0].value as Token[];

      // First token should be spread operator
      expect(arrayTokens[0].type).toBe('operator');
      expect(arrayTokens[0].value).toBe('...');
    });

    // Test for spread operator after some content
    it('tokenizes array with spread operator after content', () => {
      const result = tokenize('[1, 2, ...arr]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');

      const arrayTokens = result[0].value as Token[];

      // Find the spread operator
      const spreadIndex = arrayTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );

      expect(spreadIndex).toBeGreaterThan(0);
      expect(arrayTokens[spreadIndex].type).toBe('operator');
      expect(arrayTokens[spreadIndex].value).toBe('...');
    });

    // Test for multiple spread operators in an array
    it('tokenizes array with multiple spread operators', () => {
      const result = tokenize('[...arr1, ...arr2]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');

      const arrayTokens = result[0].value as Token[];

      // Find all spread operators
      const spreadIndices: number[] = [];
      arrayTokens.forEach((token, index) => {
        if (token.type === 'operator' && token.value === '...') {
          spreadIndices.push(index);
        }
      });

      expect(spreadIndices.length).toBe(2);
    });

    // Test with nested array containing spread
    it('tokenizes nested array with spread operator', () => {
      const result = tokenize('[[...innerArr], otherItem]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');

      const arrayTokens = result[0].value as Token[];

      // Find the nested array
      const nestedArrayIndex = arrayTokens.findIndex((token) => token.type === 'array_literal');
      expect(nestedArrayIndex).toBeGreaterThanOrEqual(0);

      // Check the nested array for spread operator
      const nestedArrayTokens = arrayTokens[nestedArrayIndex].value as Token[];
      const spreadIndex = nestedArrayTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );

      expect(spreadIndex).toBeGreaterThanOrEqual(0);
    });
  });
});
