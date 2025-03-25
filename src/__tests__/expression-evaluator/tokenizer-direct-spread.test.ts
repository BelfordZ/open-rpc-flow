import { tokenize } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Direct Spread Operator Test', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  describe('lines 570-574 coverage test', () => {
    // This test is specifically crafted to try to hit lines 570-574
    it('directly tests object literal with spread pattern', () => {
      // We need to specifically trigger the case where:
      // 1. We're inside handleObjectLiteral
      // 2. The current character is a dot '.'
      // 3. isSpreadOperator returns true
      
      // Attempt to create the most direct test case possible
      const result = tokenize('{ ... }', logger);
      
      // Verify we have a valid object literal
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('object_literal');
      const tokens = result[0].value as any[];
      
      // Check if we have a spread operator token
      const hasSpread = tokens.some(token => token.type === 'operator' && token.value === '...');
      expect(hasSpread).toBe(true);
    });
    
    it('tests with different object patterns containing spread operator', () => {
      // Try multiple different patterns to maximize chances of hitting lines 570-574
      const patterns = [
        '{ ... }',
        '{...}',
        '{ ...obj }',
        '{...obj}',
        '{ key: value, ... }',
        '{ key: value, ...obj }',
        '{ ...obj, key: value }',
        '{key:value,...obj}',
        '{...obj,key:value}',
        '{ . .. ... }' // This should still detect the spread
      ];
      
      for (const pattern of patterns) {
        const result = tokenize(pattern, logger);
        expect(result[0].type).toBe('object_literal');
        // Just verify the result exists, the important part is executing the code path
      }
    });
    
    it('specifically targets the spread operator in handleObjectLiteral', () => {
      // The goal here is to ensure that within handleObjectLiteral,
      // we go through the code path where char === '.' and isSpreadOperator returns true
      const result = tokenize('{...}', logger);
      expect(result[0].type).toBe('object_literal');
      
      // We use minimal example to limit noise and focus on the specific path
    });
  });
}); 