import { tokenize, Token } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Array Spread Special Cases', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  describe('Direct targeting of isSpreadOperator in handleArrayLiteral (lines 660-661)', () => {
    // This test is designed to set textBuffer content before encountering a spread operator
    it('tests spread operator with textBuffer content in array (should hit line 660)', () => {
      // Testing with textBuffer filled before encountering ...
      const result = tokenize('[abc...items]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');

      const arrayTokens = result[0].value as Token[];

      // Check what tokens were created - we should have either a combined token or separate tokens
      const tokenValues = arrayTokens.map((token) => `${token.type}:${token.value}`).join(', ');
      logger.log('Tokens created:', tokenValues);
    });

    // Try with dots as part of an identifier
    it('tests array with identifier including dots', () => {
      const result = tokenize('["test...dots"]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');

      const arrayTokens = result[0].value as Token[];
      const stringTokenIndex = arrayTokens.findIndex((token) => token.type === 'string');

      expect(stringTokenIndex).toBeGreaterThanOrEqual(0);
      expect((arrayTokens[stringTokenIndex].value as string).includes('...')).toBe(true);
    });

    // Try forcing a more direct test by using array bracket syntax
    it('should handle spread operator in nested brackets', () => {
      const result = tokenize('[[first]...rest]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');
    });

    // Test with characters that might trigger different handling
    it('should handle spread operator with special characters in array', () => {
      const results = [
        tokenize('[_...items]', logger),
        tokenize('[%...items]', logger),
        tokenize('[&...items]', logger),
        tokenize('[\\...items]', logger),
      ];

      // One of these should possibly hit the isSpreadOperator function
      for (const result of results) {
        expect(result.length).toBe(1);
        expect(result[0].type).toBe('array_literal');
      }
    });

    // Try specially constructed test case
    it('should directly test line 660-661 with specifically crafted input', () => {
      // Create an array where a spread operator follows something else
      // Create a long string that might match as something else first
      const longVar = 'x'.repeat(10);
      const testStr = `[${longVar}...items]`;

      const result = tokenize(testStr, logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');
    });

    // Try with template literal before spread
    it('should handle template literal before spread operator', () => {
      const result = tokenize('[`template`...items]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');
    });

    // Try with array of objects
    it('should handle objects before spread operator', () => {
      const result = tokenize('[{key: "value"}...items]', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');
    });
  });
});
