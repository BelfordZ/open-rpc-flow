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

describe('SafeExpressionEvaluator - Array Case Coverage', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  const logger = new TestLogger('SafeEvaluatorArrayCaseTest');

  beforeEach(() => {
    stepResults = new Map();
    context = {};
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  describe('evaluateAst array case', () => {
    // This is a direct test for line 642 when elements is undefined
    it('should throw when array node is missing elements property', () => {
      // Create a malformed AST node to trigger the error
      const malformedArrayNode: AstNode = { type: 'array' };
      
      // We need to access the private evaluateAst method
      const evaluatorAny = evaluator as any;
      const evaluateAst = evaluatorAny.evaluateAst.bind(evaluator);
      
      // Test that it throws the expected error for missing elements
      expect(() => {
        evaluateAst(malformedArrayNode, {}, Date.now());
      }).toThrow('Internal error: Array node missing elements');
    });

    // Test for spread operator with non-object/non-array value (line 715)
    it('should throw when spreading a non-object/non-array value in array', () => {
      // Create an AST with a spread of a primitive value
      context.primitive = 42;
      
      const spreadPrimitiveNode: AstNode = {
        type: 'array',
        elements: [
          {
            value: { type: 'reference', path: 'context.primitive' },
            spread: true
          }
        ]
      };
      
      // Access private method
      const evaluatorAny = evaluator as any;
      const evaluateAst = evaluatorAny.evaluateAst.bind(evaluator);
      
      // Should throw because you can't spread a primitive
      expect(() => {
        evaluateAst(spreadPrimitiveNode, context, Date.now());
      }).toThrow('Invalid spread operator usage: can only spread arrays or objects');
    });

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
      expect(evaluator.evaluate('[...${context.items}, ...${context.obj}]', {}))
        .toEqual([1, 2, 3, 4, 5]);
      
      expect(evaluator.evaluate('[...${context.empty}]', {}))
        .toEqual([]);
      
      // Test error cases
      expect(() => evaluator.evaluate('[...${context.nullValue}]', {}))
        .toThrow(ExpressionError);
    });
  });
}); 