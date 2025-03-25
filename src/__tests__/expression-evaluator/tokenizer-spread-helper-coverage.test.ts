import { tokenize, Token } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Spread Operator Helper Coverage', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  describe('isSpreadOperator function coverage for lines 557-558', () => {
    // This test case is designed to avoid the direct check for '...' and use the isSpreadOperator function
    it('handles spread operator in object with property access immediately after spread', () => {
      // Specifically crafted to hit isSpreadOperator - avoiding direct pattern match
      const result = tokenize('{ "foo": "bar", ...obj.prop }', logger);
      
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');
      
      const objectTokens = result[0].value as Token[];
      
      // Find the spread operator
      const spreadOperatorIndex = objectTokens.findIndex(token => 
        token.type === 'operator' && token.value === '...'
      );
      
      expect(spreadOperatorIndex).toBeGreaterThan(0);
      expect(objectTokens[spreadOperatorIndex].type).toBe('operator');
      expect(objectTokens[spreadOperatorIndex].value).toBe('...');
    });

    it('handles spread operator followed by a function call in object literals', () => {
      // Another case targeting isSpreadOperator without a ${}
      const result = tokenize('{ ...getObject() }', logger);
      
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');
      
      const objectTokens = result[0].value as Token[];
      
      expect(objectTokens[0].type).toBe('operator');
      expect(objectTokens[0].value).toBe('...');
    });

    it('handles spread operator with bracketed access in object literals', () => {
      // Testing with bracket notation
      const result = tokenize('{ ...obj["key"] }', logger);
      
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');
      
      const objectTokens = result[0].value as Token[];
      
      expect(objectTokens[0].type).toBe('operator');
      expect(objectTokens[0].value).toBe('...');
    });

    it('handles multiple successive spread operators in object literals', () => {
      // Testing multiple spreads without ${} references
      const result = tokenize('{ ...obj1, ...obj2 }', logger);
      
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');
      
      const objectTokens = result[0].value as Token[];
      
      const spreadIndices: number[] = [];
      objectTokens.forEach((token, index) => {
        if (token.type === 'operator' && token.value === '...') {
          spreadIndices.push(index);
        }
      });
      
      expect(spreadIndices.length).toBe(2);
    });
  });
}); 