import { tokenize, TokenizerError } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Array Literal Error Handling', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  describe('unterminated array literals', () => {
    it('throws error for basic unterminated array literal', () => {
      expect(() => tokenize('[1, 2, 3', logger)).toThrow(
        new TokenizerError('Unterminated array literal')
      );
    });

    it('throws error for unterminated array with nested content', () => {
      expect(() => tokenize('[1, [2, 3], 4', logger)).toThrow(
        new TokenizerError('Unterminated array literal')
      );
    });

    it('throws error for array with correct brackets but missing bracket at end', () => {
      expect(() => tokenize('[1, 2, [3, 4]', logger)).toThrow(
        new TokenizerError('Unterminated array literal')
      );
    });

    it('throws error for array with empty elements and missing closing bracket', () => {
      expect(() => tokenize('[,,,', logger)).toThrow(
        new TokenizerError('Unterminated array literal')
      );
    });

    it('throws error for array with spread operator and missing closing bracket', () => {
      expect(() => tokenize('[...${items}', logger)).toThrow(
        new TokenizerError('Unterminated array literal')
      );
    });

    it('throws error for array with object literal and missing closing bracket', () => {
      expect(() => tokenize('[{a: 1}', logger)).toThrow(
        new TokenizerError('Unterminated array literal')
      );
    });

    it('throws error for array with references and missing closing bracket', () => {
      expect(() => tokenize('[${a}, ${b}', logger)).toThrow(
        new TokenizerError('Unterminated array literal')
      );
    });

    it('throws error for array with string literals and missing closing bracket', () => {
      expect(() => tokenize('["a", "b"', logger)).toThrow(
        new TokenizerError('Unterminated array literal')
      );
    });
    
    // Add test with a longer input that ensures we reach the end of the expression
    it('throws error for complex array with expression ending without closing bracket', () => {
      const longExpression = '[1, 2, "test", ${a}, ...${b}, {c: "d"}, [1, 2, 3]';
      expect(() => tokenize(longExpression, logger)).toThrow(
        new TokenizerError('Unterminated array literal')
      );
    });
    
    // Add test with whitespace handling
    it('throws error for array with whitespace at the end', () => {
      expect(() => tokenize('[1, 2, 3  ', logger)).toThrow(
        new TokenizerError('Unterminated array literal')
      );
    });
    
    // Add test with quoted text buffer
    it('throws error for array with text buffer containing identifier', () => {
      expect(() => tokenize('[1, 2, someVar', logger)).toThrow(
        new TokenizerError('Unterminated array literal')
      );
    });
  });
}); 