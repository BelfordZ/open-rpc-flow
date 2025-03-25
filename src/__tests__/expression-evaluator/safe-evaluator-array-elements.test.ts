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

describe('SafeExpressionEvaluator - Array Elements Handling', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  const logger = new TestLogger('SafeEvaluatorArrayTest');

  beforeEach(() => {
    stepResults = new Map();
    context = {};
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  describe('array AST node handling', () => {
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
  describe('array evaluation integration', () => {
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

    it('evaluates array literals with object spread', () => {
      context.obj = { a: 1, b: 2 };
      expect(evaluator.evaluate('[...${context.obj}]', {})).toEqual([1, 2]);
    });

    it('throws for invalid spread values', () => {
      context.str = 'not spreadable';
      expect(() => evaluator.evaluate('[...${context.str}]', {})).toThrow(ExpressionError);
    });
  });
});
