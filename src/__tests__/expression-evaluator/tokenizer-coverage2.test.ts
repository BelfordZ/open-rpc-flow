import { tokenize, TokenizerError, Token } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Additional Coverage', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  describe('reference handling edge cases', () => {
    it('handles nested reference with additional layers', () => {
      const result = tokenize('${foo[${bar[${baz}]}]}', logger);
      expect(result[0].type).toBe('reference');
      expect(result[0].value.length).toBeGreaterThan(0);
      expect(result[0].raw).toBe('${foo[${bar[${baz}]}]}');
    });

    it('handles references with operators', () => {
      const result = tokenize('${foo.bar}', logger);
      expect(result[0].type).toBe('reference');
      expect(result[0].value.length).toBe(3); // foo, ., and bar
      expect(result[0].value[1].type).toBe('operator');
      expect(result[0].value[1].value).toBe('.');
    });
  });

  describe('handleOperator edge cases', () => {
    it('handles longer operator sequences', () => {
      const result = tokenize('5 === 5', logger);
      expect(result[1].type).toBe('operator');
      expect(result[1].value).toBe('===');
    });

    it('handles operator at the end', () => {
      expect(() => tokenize('5 +', logger)).toThrow(TokenizerError);
    });

    it('handles the nullish coalescing operator', () => {
      const result = tokenize('${foo} ?? "default"', logger);
      expect(result[1].type).toBe('operator');
      expect(result[1].value).toBe('??');
    });
  });

  describe('template literals advanced cases', () => {
    it('handles template literals with complex expressions', () => {
      const result = tokenize('`Result: ${1 + 2 * 3}`', logger);
      expect(result[0].type).toBe('string');
      expect(result[0].value).toBe('Result: ');
      expect(result[1].type).toBe('reference');
      expect(result[1].value.length).toBe(5); // 1, +, 2, *, 3
    });

    it('handles template literals with nested expressions', () => {
      const result = tokenize('`${foo ? `${bar}` : "baz"}`', logger);
      expect(result[0].type).toBe('reference');
      // The actual structure will depend on how the tokenizer handles ternary operators
    });

    it('handles multiple expressions in template literals', () => {
      const result = tokenize('`${foo}${bar}${baz}`', logger);
      expect(result.length).toBe(3);
      expect(result[0].type).toBe('reference');
      expect(result[1].type).toBe('reference');
      expect(result[2].type).toBe('reference');
    });
  });

  describe('object literals advanced cases', () => {
    it('handles object literals with keys and values', () => {
      const result = tokenize('{ key: ${value} }', logger);
      expect(result[0].type).toBe('object_literal');
      // Check the structure contains the expected elements
      const objectElements = result[0].value as Token[];
      expect(objectElements.some((el: Token) => el.type === 'string' && el.value === 'key')).toBe(
        true,
      );
      expect(
        objectElements.some((el: Token) => el.type === 'punctuation' && el.value === ':'),
      ).toBe(true);
      expect(objectElements.some((el: Token) => el.type === 'reference')).toBe(true);
    });

    it('handles object literals with complex expressions as values', () => {
      const result = tokenize('{ key: ${value1 + value2} }', logger);
      expect(result[0].type).toBe('object_literal');
      const referenceFound = (result[0].value as Token[]).some(
        (el: Token) => el.type === 'reference',
      );
      expect(referenceFound).toBe(true);
    });

    it('handles empty object with spread', () => {
      const result = tokenize('{ ...${obj} }', logger);
      expect(result[0].type).toBe('object_literal');
      expect((result[0].value as Token[])[0].type).toBe('operator');
      expect((result[0].value as Token[])[0].value).toBe('...');
    });
  });

  describe('array literals advanced cases', () => {
    it('handles array literals with complex expressions', () => {
      const result = tokenize('[${item1}, ${item2 + item3}]', logger);
      expect(result[0].type).toBe('array_literal');
      expect((result[0].value as Token[]).length).toBe(3); // Two references and a comma
    });

    it('handles array literals with nested arrays', () => {
      const result = tokenize('[[${item1}], [${item2}]]', logger);
      expect(result[0].type).toBe('array_literal');
      expect((result[0].value as Token[])[0].type).toBe('array_literal');
      expect((result[0].value as Token[])[2].type).toBe('array_literal');
    });

    it('handles array literals with spread at beginning', () => {
      const result = tokenize('[...${items}, "additional"]', logger);
      expect(result[0].type).toBe('array_literal');
      expect((result[0].value as Token[])[0].type).toBe('operator');
      expect((result[0].value as Token[])[0].value).toBe('...');
    });

    it('handles array literals with spread at end', () => {
      const result = tokenize('["first", ...${items}]', logger);
      expect(result[0].type).toBe('array_literal');
      expect((result[0].value as Token[])[2].type).toBe('operator');
      expect((result[0].value as Token[])[2].value).toBe('...');
    });
  });

  describe('object/array literal detection complex cases', () => {
    it('correctly identifies object literals with only spread operator', () => {
      const result = tokenize('{...${obj}}', logger);
      expect(result[0].type).toBe('object_literal');
    });

    it('correctly identifies object literals with only one key-value pair', () => {
      const result = tokenize('{a:1}', logger);
      expect(result[0].type).toBe('object_literal');
    });

    it('handles object literals with quoted keys', () => {
      const result = tokenize('{ "a": 1, b: 2 }', logger);
      expect(result[0].type).toBe('object_literal');
      // Check it contains the right elements
      const values = result[0].value as Token[];
      expect(values.some((v: Token) => v.type === 'string' && v.value === 'a')).toBe(true);
      expect(values.some((v: Token) => v.type === 'string' && v.value === 'b')).toBe(true);
      // Check number values
      expect(values.some((v: Token) => v.type === 'number' && v.value === 1)).toBe(true);
      expect(values.some((v: Token) => v.type === 'number' && v.value === 2)).toBe(true);
    });
  });
});
