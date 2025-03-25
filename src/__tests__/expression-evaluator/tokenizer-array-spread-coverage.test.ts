import { tokenize, Token } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Array Spread Operator Coverage', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  describe('array literal spread operator (lines 660-661)', () => {
    // Specifically targeting isSpreadOperator function in array literals
    it('directly targets isSpreadOperator check in array literals (line 660)', () => {
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

    // Test with valid special characters before spread
    it('targets isSpreadOperator with valid special characters in array', () => {
      // Use valid tokens that won't cause parser errors
      const result = tokenize('["$%&", ...arr]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');

      const arrayTokens = result[0].value as Token[];

      // Find the spread operator
      const spreadIndex = arrayTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );

      expect(spreadIndex).toBeGreaterThan(0);
    });

    // Try with a mix of tokens
    it('targets isSpreadOperator with mixed tokens before spread', () => {
      const result = tokenize('[1, "text", ...arr]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');

      const arrayTokens = result[0].value as Token[];
      const spreadIndex = arrayTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );

      expect(spreadIndex).toBeGreaterThan(0);
    });

    // Attempt to force the isSpreadOperator check with a complex edge case
    it('targets isSpreadOperator with a contrived edge case', () => {
      // Try with a sequence that will pass through other branches first
      const result = tokenize('[[1],true,...arr]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');

      const arrayTokens = result[0].value as Token[];

      // Find the spread operator
      const spreadIndex = arrayTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );

      expect(spreadIndex).toBeGreaterThan(0);
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

    // Attempt with actual dots character instead of spread
    it('handles arrays with dots that are not spread operators', () => {
      // Test with actual dots that shouldn't be interpreted as spread
      const result = tokenize('["...non-spread-dots", ...actualSpread]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');

      const arrayTokens = result[0].value as Token[];

      // Should have a string token with dots
      const stringIndex = arrayTokens.findIndex(
        (token) => token.type === 'string' && token.value.includes('...'),
      );
      expect(stringIndex).toBeGreaterThanOrEqual(0);

      // And a separate spread operator
      const spreadIndex = arrayTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );
      expect(spreadIndex).toBeGreaterThan(0);
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

    // Test for spread operator with different kinds of identifiers
    it('tokenizes array with spread operator followed by different identifiers', () => {
      const result = tokenize('[...obj.prop, ...arr["key"]]', logger);

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
