import { tokenize, TokenizerError } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Coverage Improvements', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  describe('binary operators validation', () => {
    it('handles various operator scenarios', () => {
      expect(() => tokenize('5 + ', logger)).toThrow(TokenizerError);
      expect(() => tokenize('5 * ', logger)).toThrow(TokenizerError);
    });

    it('throws error when binary operator is missing right operand', () => {
      expect(() => tokenize('5 +', logger)).toThrow(TokenizerError);
    });

    it('throws error for other binary operators without operands', () => {
      expect(() => tokenize('5 /', logger)).toThrow(TokenizerError);
      expect(() => tokenize('5 <', logger)).toThrow(TokenizerError);
    });
  });

  describe('empty expressions', () => {
    it('throws error for empty string', () => {
      expect(() => tokenize('', logger)).toThrow(new TokenizerError('Expression cannot be empty'));
    });

    it('throws error for whitespace-only string', () => {
      expect(() => tokenize('   ', logger)).toThrow(
        new TokenizerError('Expression cannot be empty'),
      );
    });
  });

  describe('string literals with escape sequences', () => {
    it('tokenizes strings with escaped quotes', () => {
      const result = tokenize('"Hello\\"World"', logger);
      expect(result).toEqual([{ type: 'string', value: 'Hello"World', raw: '"Hello\\"World"' }]);
    });

    it('tokenizes strings with escaped backslashes', () => {
      const result = tokenize('"Hello\\\\World"', logger);
      expect(result).toEqual([{ type: 'string', value: 'Hello\\World', raw: '"Hello\\\\World"' }]);
    });

    it('handles single backslash in string', () => {
      const result = tokenize('"Hello\\World"', logger);
      expect(result).toEqual([{ type: 'string', value: 'Hello\\World', raw: '"Hello\\World"' }]);
    });

    it('throws error for unterminated string literal', () => {
      expect(() => tokenize('"Hello', logger)).toThrow(
        new TokenizerError('Unterminated string literal'),
      );
    });
  });

  describe('template literals with escape sequences', () => {
    it('tokenizes template literals with escaped expressions', () => {
      const result = tokenize('`Hello \\${world}`', logger);
      expect(result).toEqual([
        { type: 'string', value: 'Hello ${world}', raw: 'Hello \\${world}' },
      ]);
    });

    it('tokenizes template literals with escaped backticks', () => {
      const result = tokenize('`Hello \\` World`', logger);
      expect(result).toEqual([{ type: 'string', value: 'Hello ` World', raw: 'Hello \\` World' }]);
    });

    it('tokenizes template literals with escaped backslashes', () => {
      const result = tokenize('`Hello \\\\ World`', logger);
      expect(result).toEqual([
        { type: 'string', value: 'Hello \\ World', raw: 'Hello \\\\ World' },
      ]);
    });

    it('throws error for unterminated template literal', () => {
      expect(() => tokenize('`Hello ${world', logger)).toThrow(TokenizerError);
    });
  });

  describe('reference handling', () => {
    it('throws error for unterminated reference', () => {
      expect(() => tokenize('${foo', logger)).toThrow(new TokenizerError('Unterminated reference'));
    });

    it('handles nested references correctly', () => {
      const result = tokenize('${foo[${bar}]}', logger);
      expect(result).toEqual([
        {
          type: 'reference',
          value: [
            { type: 'identifier', value: 'foo', raw: 'foo' },
            { type: 'punctuation', value: '[', raw: '[' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'bar', raw: 'bar' }],
              raw: '${bar}',
            },
            { type: 'punctuation', value: ']', raw: ']' },
          ],
          raw: '${foo[${bar}]}',
        },
      ]);
    });

    it('throws error for nested references with unterminated inner reference', () => {
      expect(() => tokenize('${foo[${bar]}', logger)).toThrow(TokenizerError);
    });
  });

  describe('object literals with spread operator', () => {
    it('tokenizes object literals with spread operator', () => {
      const result = tokenize('{ ...${foo} }', logger);
      expect(result).toEqual([
        {
          type: 'object_literal',
          value: [
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
              raw: '${foo}',
            },
          ],
          raw: '{ ...${foo} }',
        },
      ]);
    });

    it('tokenizes object literals with multiple spread operators', () => {
      const result = tokenize('{ ...${foo}, ...${bar} }', logger);
      expect(result).toEqual([
        {
          type: 'object_literal',
          value: [
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
              raw: '${foo}',
            },
            { type: 'punctuation', value: ',', raw: ',' },
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'bar', raw: 'bar' }],
              raw: '${bar}',
            },
          ],
          raw: '{ ...${foo}, ...${bar} }',
        },
      ]);
    });
  });

  describe('array literals with spread operator', () => {
    it('tokenizes array literals with spread operator', () => {
      const result = tokenize('[...${foo}]', logger);
      expect(result).toEqual([
        {
          type: 'array_literal',
          value: [
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
              raw: '${foo}',
            },
          ],
          raw: '[...${foo}]',
        },
      ]);
    });

    it('tokenizes array literals with multiple spread operators', () => {
      const result = tokenize('[...${foo}, ...${bar}]', logger);
      expect(result).toEqual([
        {
          type: 'array_literal',
          value: [
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
              raw: '${foo}',
            },
            { type: 'punctuation', value: ',', raw: ',' },
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'bar', raw: 'bar' }],
              raw: '${bar}',
            },
          ],
          raw: '[...${foo}, ...${bar}]',
        },
      ]);
    });
  });

  describe('object/array literal detection', () => {
    it('handles empty braces as punctuation', () => {
      const result = tokenize('{}', logger);
      expect(result).toEqual([
        { type: 'punctuation', value: '{', raw: '{' },
        { type: 'punctuation', value: '}', raw: '}' },
      ]);
    });

    it('detects object literals with key-value pairs', () => {
      const result = tokenize('{ a: 1 }', logger);
      expect(result).toEqual([
        {
          type: 'object_literal',
          value: [
            { type: 'string', value: 'a', raw: 'a' },
            { type: 'punctuation', value: ':', raw: ':' },
            { type: 'number', value: 1, raw: '1' },
          ],
          raw: '{ a: 1 }',
        },
      ]);
    });

    it('handles non-object braces correctly', () => {
      const result = tokenize('{ a }', logger);
      expect(result).toEqual([
        { type: 'punctuation', value: '{', raw: '{' },
        { type: 'string', value: ' a ', raw: ' a ' },
        { type: 'punctuation', value: '}', raw: '}' },
      ]);
    });
  });
});
