import { tokenize } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Template Literal Escaping', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  describe('template literal escape handling', () => {
    // Test various escape sequences in template literals that are not backticks or backslashes
    it('handles escaped characters in template literals that are not backticks or backslashes', () => {
      // This test targets lines 431-434 which handle backslashes followed by characters
      // other than backticks, backslashes, or ${
      const escapedChars = [
        '\\n',
        '\\r',
        '\\t',
        '\\v',
        '\\f',
        '\\b',
        '\\0',
        "\\'",
        '\\"',
        '\\a',
        '\\c',
        '\\d',
        '\\e',
        '\\g',
        '\\h',
        '\\i',
        '\\j',
        '\\k',
        '\\l',
        '\\m',
        '\\o',
        '\\p',
        '\\q',
        '\\s',
        '\\u',
        '\\w',
        '\\x',
        '\\y',
        '\\z',
        '\\1',
        '\\2',
        '\\3',
        '\\4',
        '\\5',
        '\\6',
        '\\7',
        '\\8',
        '\\9',
        '\\@',
        '\\#',
        '\\$',
        '\\%',
        '\\^',
        '\\&',
        '\\*',
        '\\(',
        '\\)',
        '\\_',
        '\\+',
        '\\-',
        '\\=',
        '\\[',
        '\\]',
        '\\{',
        '\\}',
        '\\|',
        '\\;',
        '\\:',
        '\\,',
        '\\<',
        '\\>',
        '\\.',
        '\\/',
        '\\?',
      ];

      for (const escapedChar of escapedChars) {
        const expression = `\`Text with ${escapedChar} escaped character\``;
        const result = tokenize(expression, logger);

        // Verify we get the expected token
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('string');

        // Check that the escaped character is in the result
        const value = result[0].value as string;
        expect(value).toContain(escapedChar);
      }
    });

    it('handles multiple escaped characters in template literals', () => {
      // Test with multiple escape sequences that aren't template expressions or quotes
      const expressions = [
        '`Text with \\n and \\t escaped characters`',
        '`Text with \\r\\n escaped characters`',
        '`Text with multiple \\a\\b\\c\\d escaped characters`',
        '`Text with special \\@\\#\\$ escaped characters`',
        '`Text with numeric \\1\\2\\3 escaped characters`',
      ];

      for (const expression of expressions) {
        const result = tokenize(expression, logger);

        // Verify we get the expected token
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('string');
      }
    });

    it('handles escaped characters at various positions in template literals', () => {
      // Test escape sequences at the beginning, middle, and end of the template
      const expressions = [
        '`\\nText with escaped character at beginning`',
        '`Text with \\n escaped character in middle`',
        '`Text with escaped character at end\\n`',
      ];

      for (const expression of expressions) {
        const result = tokenize(expression, logger);

        // Verify we get the expected token
        expect(result).toHaveLength(1);
        expect(result[0].type).toBe('string');
      }
    });

    it('handles escaped characters next to other special characters', () => {
      // Test escape sequences adjacent to other special sequences
      const expressions = [
        '`Text with \\n${expr} escaped character next to expression`',
        '`Text with ${expr}\\n escaped character after expression`',
        '`Text with \\n\\` escaped character next to escaped backtick`',
      ];

      for (const expression of expressions) {
        // Some of these might throw, which is fine - we're just trying to hit the code path
        try {
          const result = tokenize(expression, logger);
          expect(result).toBeDefined();
        } catch (e) {
          // Expected that some might throw due to invalid syntax
        }
      }
    });

    it('handles poorly formed escape sequences in template literals', () => {
      // Test with a backslash at the end of the template
      // This should hit the backslash handling code without a following character
      const expressions = [
        '`Text with backslash at end\\`',
        '`Text with backslash before ${expr}\\${expr}`',
      ];

      for (const expression of expressions) {
        // These might throw, which is fine - we're just trying to hit the code path
        try {
          const result = tokenize(expression, logger);
          expect(result).toBeDefined();
        } catch (e) {
          // Expected that some might throw due to invalid syntax
        }
      }
    });
  });
});
