import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

// Define the type to match the one in safe-evaluator.ts
type Operator = keyof typeof SafeExpressionEvaluator.OPERATORS;

// Define AstNode interface to match the one in safe-evaluator.ts
interface AstNode {
  type: 'literal' | 'reference' | 'operation' | 'object' | 'array';
  value?: any;
  path?: string;
  operator?: Operator;
  left?: AstNode;
  right?: AstNode;
  properties?: { key: string; value: AstNode; spread?: boolean }[];
  elements?: { value: AstNode; spread?: boolean }[];
}

/**
 * This is a consolidated test file for array-related tests in the SafeExpressionEvaluator.
 * It combines tests from:
 * - safe-evaluator-array-elements.test.ts
 * - safe-evaluator-array-case-coverage.test.ts
 */
describe('SafeExpressionEvaluator - Arrays', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  const logger = new TestLogger('SafeEvaluatorArraysTest');

  beforeEach(() => {
    stepResults = new Map();
    context = {};
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  // Tests from safe-evaluator-array-elements.test.ts
  describe('Array AST Node Handling', () => {
    // This is the core test that directly targets line 642
    it('throws when evaluating an array AST node with missing elements', () => {
      // Create a malformed AST node by accessing evaluator's private evaluateAst method directly
      const malformedAst: AstNode = { type: 'array' };

      // We need to use a little trick to access the private method and test it
      // @ts-ignore - Ignore TypeScript errors for accessing private methods in tests
      const evaluateAst = evaluator['evaluateAst'].bind(evaluator);

      // Test that it throws the expected error
      expect(() => {
        evaluateAst(malformedAst, {}, Date.now());
      }).toThrow(ExpressionError);

      expect(() => {
        evaluateAst(malformedAst, {}, Date.now());
      }).toThrow('Internal error: Array node missing elements');
    });

    // Test with an empty array elements property
    it('handles array AST node with empty elements array', () => {
      const emptyElementsAst: AstNode = {
        type: 'array',
        elements: [],
      };

      // @ts-ignore - Ignore TypeScript errors for accessing private methods in tests
      const evaluateAst = evaluator['evaluateAst'].bind(evaluator);

      // Should not throw, should return an empty array
      const result = evaluateAst(emptyElementsAst, {}, Date.now());
      expect(result).toEqual([]);
    });

    // Test with valid array elements
    it('evaluates array AST node with valid elements', () => {
      const validElementsAst: AstNode = {
        type: 'array',
        elements: [
          {
            value: { type: 'literal', value: 1 },
            spread: false,
          },
          {
            value: { type: 'literal', value: 2 },
            spread: false,
          },
        ],
      };

      // @ts-ignore - Ignore TypeScript errors for accessing private methods in tests
      const evaluateAst = evaluator['evaluateAst'].bind(evaluator);

      const result = evaluateAst(validElementsAst, {}, Date.now());
      expect(result).toEqual([1, 2]);
    });

    // Test with spread operator in array elements
    it('handles spread operator in array elements', () => {
      context.arr = [3, 4, 5];

      const spreadElementsAst: AstNode = {
        type: 'array',
        elements: [
          {
            value: { type: 'literal', value: 1 },
            spread: false,
          },
          {
            value: { type: 'literal', value: 2 },
            spread: false,
          },
          {
            value: { type: 'reference', path: 'context.arr' },
            spread: true,
          },
        ],
      };

      // @ts-ignore - Ignore TypeScript errors for accessing private methods in tests
      const evaluateAst = evaluator['evaluateAst'].bind(evaluator);

      const result = evaluateAst(spreadElementsAst, context, Date.now());
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    // Test spreading non-array values
    it('handles spreading non-array object values', () => {
      context.obj = { a: 1, b: 2 };

      const spreadObjectAst: AstNode = {
        type: 'array',
        elements: [
          {
            value: { type: 'reference', path: 'context.obj' },
            spread: true,
          },
        ],
      };

      // @ts-ignore - Ignore TypeScript errors for accessing private methods in tests
      const evaluateAst = evaluator['evaluateAst'].bind(evaluator);

      const result = evaluateAst(spreadObjectAst, context, Date.now());
      expect(result).toEqual([1, 2]); // Should be Object.values(obj)
    });

    // Test spreading invalid values (not array or object)
    it('throws when spreading invalid values', () => {
      context.str = 'not spreadable';

      const invalidSpreadAst: AstNode = {
        type: 'array',
        elements: [
          {
            value: { type: 'reference', path: 'context.str' },
            spread: true,
          },
        ],
      };

      // @ts-ignore - Ignore TypeScript errors for accessing private methods in tests
      const evaluateAst = evaluator['evaluateAst'].bind(evaluator);

      expect(() => {
        evaluateAst(invalidSpreadAst, context, Date.now());
      }).toThrow(ExpressionError);

      expect(() => {
        evaluateAst(invalidSpreadAst, context, Date.now());
      }).toThrow('Invalid spread operator usage: can only spread arrays or objects');
    });

    // Test with null and undefined spread
    it('handles null and undefined spread attempts correctly', () => {
      context.nullVal = null;
      context.undefinedVal = undefined;

      const nullSpreadAst: AstNode = {
        type: 'array',
        elements: [
          {
            value: { type: 'reference', path: 'context.nullVal' },
            spread: true,
          },
        ],
      };

      const undefinedSpreadAst: AstNode = {
        type: 'array',
        elements: [
          {
            value: { type: 'reference', path: 'context.undefinedVal' },
            spread: true,
          },
        ],
      };

      // @ts-ignore - Ignore TypeScript errors for accessing private methods in tests
      const evaluateAst = evaluator['evaluateAst'].bind(evaluator);

      // Both should throw since they're not arrays or valid objects
      expect(() => {
        evaluateAst(nullSpreadAst, context, Date.now());
      }).toThrow(ExpressionError);

      expect(() => {
        evaluateAst(undefinedSpreadAst, context, Date.now());
      }).toThrow(ExpressionError);
    });
  });

  // Integration tests that use the evaluate method directly
  describe('Array Evaluation Integration', () => {
    it('evaluates simple array literals', () => {
      expect(evaluator.evaluate('[1, 2, 3]', {})).toEqual([1, 2, 3]);
      expect(evaluator.evaluate('[]', {})).toEqual([]);
    });

    it('evaluates nested array literals', () => {
      expect(evaluator.evaluate('[[1, 2], [3, 4]]', {})).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });

    it('evaluates array literals with computed values', () => {
      // The expression syntax needs to be different - expressions need to be separate references or literals
      context.val1 = 3;
      context.val2 = 12;
      expect(evaluator.evaluate('[${context.val1}, ${context.val2}]', {})).toEqual([3, 12]);
    });

    it('evaluates array literals with references', () => {
      context.a = 1;
      context.b = 2;
      expect(evaluator.evaluate('[${context.a}, ${context.b}]', {})).toEqual([1, 2]);
    });

    it('evaluates array literals with spread operator', () => {
      context.arr = [2, 3, 4];
      expect(evaluator.evaluate('[1, ...${context.arr}, 5]', {})).toEqual([1, 2, 3, 4, 5]);
    });

    it('evaluates array literals with multiple spread operators', () => {
      context.arr1 = [2, 3];
      context.arr2 = [4, 5];
      expect(evaluator.evaluate('[1, ...${context.arr1}, ...${context.arr2}, 6]', {})).toEqual([
        1, 2, 3, 4, 5, 6,
      ]);
    });

    it('handles spreading objects in array literals', () => {
      context.obj = { a: 7, b: 8 };
      expect(evaluator.evaluate('[1, ...${context.obj}]', {})).toEqual([1, 7, 8]);
    });

    it('throws when spreading non-spreadable values', () => {
      context.nonSpreadable = 42;
      expect(() => evaluator.evaluate('[...${context.nonSpreadable}]', {})).toThrow(ExpressionError);
    });
  });

  // Tests from safe-evaluator-array-case-coverage.test.ts
  describe('Reference Extraction and Special Cases', () => {
    // Test extractReferences method (line 741)
    it('should extract references from template literals', () => {
      // Template literal with context reference (context is a special variable but should still be found)
      const expression = '`Hello ${user.name} from ${user.location}!`';
      const references = evaluator.extractReferences(expression);

      // Should extract 'user'
      expect(references).toContain('user');
      expect(references.length).toBe(1); // Should have only 'user'
    });

    // Test extractReferences with invalid expressions
    it('should handle errors in extractReferences gracefully', () => {
      // This is an invalid expression (unclosed template literal)
      const invalidExpression = '`This is an unclosed template literal with ${something';

      // Should return empty array when there's a parsing error
      const references = evaluator.extractReferences(invalidExpression);
      expect(Array.isArray(references)).toBe(true);
      // The actual behavior might find a partial reference, we're just testing it doesn't throw
    });

    // Test extractReferences with nested references
    it('should extract nested references correctly', () => {
      // Template with nested references
      const nestedExpression = '`${user.address.${city}.zipcode}`';

      const references = evaluator.extractReferences(nestedExpression);
      expect(references).toContain('user');
      expect(references).toContain('city');
    });

    // Test special variable handling in extractReferences
    it('should ignore special variable names in extractReferences', () => {
      const specialVarsExpression = '`Loop variables ${item} and ${acc} and ${context}`';

      const references = evaluator.extractReferences(specialVarsExpression);

      // Special variables (item, acc, context) shouldn't be included
      expect(references).not.toContain('item');
      expect(references).not.toContain('acc');
      expect(references).not.toContain('context');
      expect(references.length).toBe(0);
    });

    // Integration test with array-related expressions
    it('should evaluate complex array operations correctly', () => {
      // Set up test data
      context.items = [1, 2, 3];
      context.obj = { a: 4, b: 5 };
      context.empty = [];
      context.nullValue = null;

      // Test various array cases
      expect(evaluator.evaluate('[...${context.items}, ...${context.obj}]', {})).toEqual([
        1, 2, 3, 4, 5,
      ]);

      expect(evaluator.evaluate('[...${context.empty}]', {})).toEqual([]);

      // Test error cases
      expect(() => evaluator.evaluate('[...${context.nullValue}]', {})).toThrow(ExpressionError);
    });
  });
}); 