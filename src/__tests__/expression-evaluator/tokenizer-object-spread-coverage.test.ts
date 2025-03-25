import { tokenize, Token } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Object Spread Operator Coverage', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  describe('object literal spread operator (lines 557-558)', () => {
    it('tokenizes object literal with spread operator preceded by other content', () => {
      // Add content before the spread to ensure textBuffer has content to flush
      const result = tokenize('{ key: "value", ...${obj} }', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');

      // Extract the tokens inside the object literal
      const objectTokens = result[0].value as Token[];

      // Find the spread operator
      const spreadOperatorIndex = objectTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );

      expect(spreadOperatorIndex).toBeGreaterThan(0); // Should exist and not be first

      // Verify the token before it is a comma
      expect(objectTokens[spreadOperatorIndex - 1].type).toBe('punctuation');
      expect(objectTokens[spreadOperatorIndex - 1].value).toBe(',');

      // Verify the spread is correctly tokenized
      expect(objectTokens[spreadOperatorIndex].type).toBe('operator');
      expect(objectTokens[spreadOperatorIndex].value).toBe('...');
      expect(objectTokens[spreadOperatorIndex].raw).toBe('...');
    });

    it('tokenizes object literal with nested spread operators', () => {
      const result = tokenize('{ ...${obj1}, nested: { ...${obj2} } }', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');

      const objectTokens = result[0].value as Token[];

      // Find the first spread operator
      const firstSpreadIndex = objectTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );

      expect(firstSpreadIndex).toBeGreaterThanOrEqual(0);
      expect(objectTokens[firstSpreadIndex].value).toBe('...');

      // Find the nested object
      const nestedObjectIndex = objectTokens.findIndex((token) => token.type === 'object_literal');

      expect(nestedObjectIndex).toBeGreaterThan(firstSpreadIndex);

      // Check the nested object contains a spread operator as well
      const nestedObjectTokens = objectTokens[nestedObjectIndex].value as Token[];
      const nestedSpreadIndex = nestedObjectTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );

      expect(nestedSpreadIndex).toBeGreaterThanOrEqual(0);
      expect(nestedObjectTokens[nestedSpreadIndex].value).toBe('...');
    });

    it('tokenizes object literal with multiple spread operators with content between', () => {
      const result = tokenize('{ ...${obj1}, key: "value", ...${obj2} }', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');

      const objectTokens = result[0].value as Token[];

      // Find all spread operators
      const spreadIndices: number[] = [];
      objectTokens.forEach((token, index) => {
        if (token.type === 'operator' && token.value === '...') {
          spreadIndices.push(index);
        }
      });

      expect(spreadIndices.length).toBe(2);
      expect(spreadIndices[1] - spreadIndices[0]).toBeGreaterThan(1); // Ensure there's content between
    });

    it('tokenizes object literal with spread operator at the beginning of an object', () => {
      const result = tokenize('{ ...${obj} }', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');

      const objectTokens = result[0].value as Token[];

      // The first token should be a spread operator
      expect(objectTokens[0].type).toBe('operator');
      expect(objectTokens[0].value).toBe('...');
    });

    it('tokenizes object literal with spread operator followed by other content', () => {
      const result = tokenize('{ ...${obj}, key: "value" }', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');

      const objectTokens = result[0].value as Token[];

      // First token should be spread
      expect(objectTokens[0].type).toBe('operator');
      expect(objectTokens[0].value).toBe('...');

      // Should be followed by reference, comma, and key-value pair
      expect(objectTokens[1].type).toBe('reference');
      expect(objectTokens[2].type).toBe('punctuation');
      expect(objectTokens[2].value).toBe(',');
    });
  });
});
