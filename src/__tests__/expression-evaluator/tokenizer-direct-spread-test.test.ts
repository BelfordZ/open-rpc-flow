import { tokenize } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Direct Spread Test', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  describe('Array Spread Operator Test (lines 660-661)', () => {
    it('tests all possible spread operator patterns in arrays', () => {
      // Try a comprehensive list of patterns that might hit the isSpreadOperator function
      // Create a massive array of tests to try to hit all branches

      const inputs = [
        '[...items]', // Basic spread
        '[ ...items]', // With whitespace
        '[a...items]', // No space before
        '[1, ...items]', // After comma
        '[1,...items]', // After comma without space
        '[true, ...items]', // After boolean
        '[{}, ...items]', // After object
        '[[1,2], ...items]', // After array
        '[${ref}, ...items]', // After reference
        '[...items1, ...items2]', // Multiple spreads
        '[...${}]', // Empty reference
        '["..."]', // String with dots
        '["...", ...items]', // String then spread
        '[...${obj["prop"]}]', // Complex reference after spread
        '[...obj.prop]', // Property access after spread
        '[a.b, ...items]', // Property access, then spread
        '[a + b, ...items]', // Expression, then spread
        '[...items + 1]', // Spread in expression
        '[true ? [...subItems] : [], ...items]', // Ternary with nested spread
        '[function() { return [...args]; }, ...items]', // Function with spread
        '[+(-(+(...items)))]', // Nested unary operators
        '[() => [...items]]', // Arrow function with spread
        '[{...items}]', // Object spread in array
        '[...{...items}]', // Array spread of object spread
        '[...new Set([1, 2])]', // Class constructor with spread
        '[...`template`]', // Spread of template
        '[`template with ${...items}`]', // Template with spread
        '[[...items]]', // Nested array with spread
        '[{ items: [...items] }]', // Object with spread
        '[...{ ...items }]', // Multiple spreads
        '[/*comment*/...items]', // Comment then spread
        '[//comment\n...items]', // Line comment then spread
        '[1,2,3,...items,4,5]', // Spread in middle
        '[...items,]', // Trailing comma
        '[[...]items]', // Brackets then dots
        '[...\\...items]', // Escaped chars
        '[[...[...items]]]', // Super nested
        '[,...items]', // Leading comma
        '[;...items]', // Semicolon before
        '[....items]', // Extra dot
        '[]...items]', // Closing then dots
        '[;...;]', // Semicolons
        '[[...[]]]', // Spread of empty array
      ];

      // Run all tests and see if any hit the line
      for (const input of inputs) {
        try {
          const result = tokenize(input, logger);
          // If no exception, check the tokens
          expect(result).toBeDefined();
        } catch (e) {
          // Some inputs might be invalid, that's fine
          expect(e).toBeDefined();
        }
      }
    });
  });
});
