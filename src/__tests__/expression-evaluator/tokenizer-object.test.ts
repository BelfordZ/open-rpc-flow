import { tokenize, TokenizerError, Token } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Object Tests', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  // From tokenizer-object-coverage.test.ts
  describe('Object Literal Template Handling', () => {
    it('handles template literals as values in object literals', () => {
      const result = tokenize('{ key: `template value` }', logger);

      expect(result[0].type).toBe('object_literal');
      const objectValues = result[0].value as any[];

      expect(objectValues).toHaveLength(3); // key, :, and template value
      expect(objectValues[0].value).toBe('key');
      expect(objectValues[1].value).toBe(':');
      expect(objectValues[2].value).toBe('template value');
      expect(objectValues[2].raw).toBe('template value');
    });

    it('handles template literals with expressions as values in object literals', () => {
      const result = tokenize('{ key: `value ${123}` }', logger);

      expect(result[0].type).toBe('object_literal');
      const objectValues = result[0].value as any[];

      // Should have key, :, string part, and reference part
      expect(objectValues.length).toBeGreaterThan(3);
      expect(objectValues[0].value).toBe('key');
      expect(objectValues[1].value).toBe(':');
      expect(objectValues[2].value).toBe('value ');

      // Verify that the reference part contains the number 123
      const referenceToken = objectValues.find(
        (token) =>
          token.type === 'reference' &&
          token.value.some((v: any) => v.type === 'number' && v.value === 123),
      );
      expect(referenceToken).toBeDefined();
    });

    it('handles multiple template literals as values in object literals', () => {
      const result = tokenize('{ key1: `value1`, key2: `value2` }', logger);

      expect(result[0].type).toBe('object_literal');
      const objectValues = result[0].value as any[];

      // Find the key and template value pairs
      const key1Index = objectValues.findIndex((token) => token.value === 'key1');
      const key2Index = objectValues.findIndex((token) => token.value === 'key2');

      expect(key1Index).toBeGreaterThanOrEqual(0);
      expect(key2Index).toBeGreaterThanOrEqual(0);

      // Verify the template values follow their respective keys and colons
      expect(objectValues[key1Index + 2].value).toBe('value1');
      expect(objectValues[key2Index + 2].value).toBe('value2');
    });

    it('handles complex template expressions in object literals', () => {
      const result = tokenize('{ key: `prefix ${a + b} suffix` }', logger);

      expect(result[0].type).toBe('object_literal');
      const objectValues = result[0].value as any[];

      // Verify key and colon
      expect(objectValues[0].value).toBe('key');
      expect(objectValues[1].value).toBe(':');

      // Verify the template parts
      expect(objectValues[2].value).toBe('prefix ');

      // Find the reference token with the expression
      const referenceToken = objectValues.find(
        (token) =>
          token.type === 'reference' &&
          token.value.some((v: any) => v.type === 'operator' && v.value === '+'),
      );
      expect(referenceToken).toBeDefined();

      // Check for the suffix part
      const suffixToken = objectValues.find(
        (token) => token.type === 'string' && token.value === ' suffix',
      );
      expect(suffixToken).toBeDefined();
    });

    it('handles nested object literals with template literals', () => {
      const result = tokenize('{ outer: { inner: `template` } }', logger);

      expect(result[0].type).toBe('object_literal');
      const outerValues = result[0].value as any[];

      // Find the inner object
      const innerObjectToken = outerValues.find((token) => token.type === 'object_literal');
      expect(innerObjectToken).toBeDefined();

      // Verify the inner object has the template literal
      const innerValues = innerObjectToken.value;
      expect(innerValues[0].value).toBe('inner');
      expect(innerValues[1].value).toBe(':');
      expect(innerValues[2].value).toBe('template');
    });

    it('handles unterminated template literals in object literals', () => {
      expect(() => tokenize('{ key: `unterminated }', logger)).toThrow(TokenizerError);
    });

    it('handles multiline template literals in object literals', () => {
      const result = tokenize('{ key: `line1\nline2` }', logger);

      expect(result[0].type).toBe('object_literal');
      const objectValues = result[0].value as any[];

      expect(objectValues[0].value).toBe('key');
      expect(objectValues[1].value).toBe(':');
      expect(objectValues[2].value).toBe('line1\nline2');
    });
  });

  // From tokenizer-object-spread-coverage.test.ts
  describe('Object Spread Operator', () => {
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

  // From tokenizer-object-spread-special.test.ts
  describe('Object Spread Special Cases', () => {
    // Direct test targeting the second spread operator check at lines 557-558
    it('directly targets isSpreadOperator with a string buffer before the spread', () => {
      // Attempt to create a situation where textBuffer has content before encountering a spread operator
      // This should force the code to take the isSpreadOperator path at line 557
      const result = tokenize('{ ${"hello"}...obj }', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');
    });

    // Attempt with a character right before the spread
    it('directly targets isSpreadOperator with a character before the spread', () => {
      const result = tokenize('{ x...obj }', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');

      const objectTokens = result[0].value as Token[];

      // Find x token and spread token
      const xIndex = objectTokens.findIndex(
        (token) =>
          (token.type === 'string' || token.type === 'identifier') &&
          (token.value === 'x' || token.value.includes('x')),
      );

      // Find spread operator
      const spreadIndex = objectTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );

      // Either one or both should exist
      expect(xIndex >= 0 || spreadIndex >= 0).toBe(true);
    });

    it('handles mixed dots and spread operators in object literals', () => {
      // This test tries to have dots in various places to avoid the first check pattern
      // but hit the isSpreadOperator function
      const result = tokenize('{ a.b: "value", ...obj }', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');

      const objectTokens = result[0].value as Token[];

      // Find the spread operator
      const spreadIndex = objectTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );
      expect(spreadIndex).toBeGreaterThan(0);
    });

    it('handles spread operator after special character patterns', () => {
      // Another test case trying to hit the isSpreadOperator function
      const result = tokenize('{ "$%^": true, "...": false, ...obj }', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');

      const objectTokens = result[0].value as Token[];

      // Find the spread operator
      const spreadIndex = objectTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );
      expect(spreadIndex).toBeGreaterThanOrEqual(0);
    });
  });
});
