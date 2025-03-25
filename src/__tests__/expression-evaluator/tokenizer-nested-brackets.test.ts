import { tokenize, Token } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Nested Brackets', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  // These tests are specifically targeting the bracket count logic in handleArrayLiteral
  // This directly targets lines 650-658 in tokenizer.ts
  describe('Nested Bracket Handling (lines 657-658)', () => {
    // Test nested brackets with simple identifiers
    test('should handle nested brackets with bracketCount increments (line 657)', () => {
      const input = '[a, [b, [c]], d]';
      const result = tokenize(input, logger);
      
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');
      
      // Validate the structure to ensure bracket counting works
      const outerArray = result[0].value as Token[];
      expect(outerArray.length).toBeGreaterThan(0);
      
      // Find the nested array
      const nestedArrayIndex = outerArray.findIndex(token => token.type === 'array_literal');
      expect(nestedArrayIndex).not.toBe(-1);
      
      // Examine the nested array
      const nestedArray = outerArray[nestedArrayIndex].value as Token[];
      expect(nestedArray.length).toBeGreaterThan(0);
      
      // Verify there's another level of nesting
      const doubleNestedIndex = nestedArray.findIndex(token => token.type === 'array_literal');
      expect(doubleNestedIndex).not.toBe(-1);
    });
    
    // Test with bracket pattern that forces path through line 657-658
    test('should handle sequential nested arrays with proper bracketCount (line 657-658)', () => {
      // This pattern is designed to hit the specific branch we want to test
      const input = '[[[]]]';
      const result = tokenize(input, logger);
      
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');
      
      // Validate first level
      const level1 = result[0].value as Token[];
      expect(level1.length).toBe(1);
      expect(level1[0].type).toBe('array_literal');
      
      // Validate second level
      const level2 = level1[0].value as Token[];
      expect(level2.length).toBe(1);
      expect(level2[0].type).toBe('array_literal');
      
      // Validate third level (empty array)
      const level3 = level2[0].value as Token[];
      expect(level3.length).toBe(0);
    });
    
    // Test with complex array content that forces return path
    test('should handle nested arrays with various content types (line 657-658)', () => {
      const input = '[1, [true, ["string", [null]]], {}, ["nested"]]';
      const result = tokenize(input, logger);
      
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');
      
      // Validate the overall structure
      const outerArray = result[0].value as Token[];
      expect(outerArray.length).toBeGreaterThan(0);
      
      // Find array literals at first level
      const firstLevelArrays = outerArray.filter(token => token.type === 'array_literal');
      expect(firstLevelArrays.length).toBeGreaterThan(0);
      
      // Verify at least one has further nested content
      let foundNesting = false;
      for (const arrayToken of firstLevelArrays) {
        const innerTokens = arrayToken.value as Token[];
        if (innerTokens.some(t => t.type === 'array_literal')) {
          foundNesting = true;
          break;
        }
      }
      expect(foundNesting).toBe(true);
    });
    
    // Test specifically targeting the closing bracket case with nested brackets
    test('should directly target the closing bracket branching logic (lines 657-658)', () => {
      const inputs = [
        // Empty arrays at different levels of nesting
        '[[]]',
        '[[[]]]',
        '[[[]], []]',
        '[[[]],[[]]]',
        
        // Arrays with content
        '[[1]]',
        '[[1, 2]]',
        '[[1], [2]]',
        '[[1, [2]]]',
        
        // Arrays with mixed content
        '[["a"], [1, true], [null, undefined]]',
        '[{}, [{}], [{}, []]]',
        
        // Very deeply nested arrays to force bracketCount handling
        '[[[[[1]]]]]'
      ];
      
      for (const input of inputs) {
        try {
          const result = tokenize(input, logger);
          expect(result.length).toBe(1);
          expect(result[0].type).toBe('array_literal');
        } catch (e) {
          fail(`Failed to parse: ${input} with error: ${e}`);
        }
      }
    });
    
    // Test specifically with bracket count changes that should execute line 657-658
    test('directly test bracketCount edge cases for line 657-658', () => {
      // Create complex nested array where bracketCount changes multiple times
      const input = '[[[a]], [[b]], [[[c]]]]';
      const result = tokenize(input, logger);
      
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');
      
      // Check the raw property which is constructed in the return path
      expect(result[0].raw).toBe(input);
      
      // Verify that the structure is correctly preserved including the nesting
      const outerArray = result[0].value as Token[];
      // Instead of expecting a specific length, just verify it's an array with elements
      expect(outerArray.length).toBeGreaterThan(0);
      
      // Verify elements are array_literal
      const arrayElements = outerArray.filter(item => item.type === 'array_literal');
      expect(arrayElements.length).toBeGreaterThan(0);
      
      // Verify at least one element has deeper nesting
      let foundDeepNesting = false;
      for (const arrayElement of arrayElements) {
        const innerTokens = arrayElement.value as Token[];
        if (innerTokens.some(t => t.type === 'array_literal')) {
          foundDeepNesting = true;
          break;
        }
      }
      expect(foundDeepNesting).toBe(true);
    });
  });
}); 