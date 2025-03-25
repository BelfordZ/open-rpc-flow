import { tokenize, TokenizerError } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Object Literal Template Handling', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  describe('template literals within object literals', () => {
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
      const referenceToken = objectValues.find(token => 
        token.type === 'reference' && 
        token.value.some((v: any) => v.type === 'number' && v.value === 123)
      );
      expect(referenceToken).toBeDefined();
    });

    it('handles multiple template literals as values in object literals', () => {
      const result = tokenize('{ key1: `value1`, key2: `value2` }', logger);
      
      expect(result[0].type).toBe('object_literal');
      const objectValues = result[0].value as any[];
      
      // Find the key and template value pairs
      const key1Index = objectValues.findIndex(token => token.value === 'key1');
      const key2Index = objectValues.findIndex(token => token.value === 'key2');
      
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
      const referenceToken = objectValues.find(token => 
        token.type === 'reference' && 
        token.value.some((v: any) => v.type === 'operator' && v.value === '+')
      );
      expect(referenceToken).toBeDefined();
      
      // Check for the suffix part
      const suffixToken = objectValues.find(token => 
        token.type === 'string' && token.value === ' suffix'
      );
      expect(suffixToken).toBeDefined();
    });

    it('handles nested object literals with template literals', () => {
      const result = tokenize('{ outer: { inner: `template` } }', logger);
      
      expect(result[0].type).toBe('object_literal');
      const outerValues = result[0].value as any[];
      
      // Find the inner object
      const innerObjectToken = outerValues.find(token => token.type === 'object_literal');
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
}); 