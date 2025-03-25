import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';
import { Token } from '../../expression-evaluator/tokenizer';

// Define the type to match the one in safe-evaluator.ts
type Operator = keyof typeof SafeExpressionEvaluator.OPERATORS;

describe('SafeExpressionEvaluator - Lines 478-480 Coverage', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  const logger = new TestLogger('SafeEvaluatorL478Test');

  beforeEach(() => {
    stepResults = new Map();
    context = {};
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  describe('parseGroupedElements - Line 478-480 Coverage', () => {
    it('should throw when object has invalid key format', () => {
      // Access the private parseGroupedElements method
      const evaluatorAny = evaluator as any;
      
      if (typeof evaluatorAny.parseGroupedElements === 'function') {
        // Define tokens that will lead to the error condition
        // Create a scenario where currentTokens.length > 1 before a colon
        const tokens: Token[] = [
          { type: 'identifier', value: 'a', raw: 'a' },
          { type: 'identifier', value: 'b', raw: 'b' },
          { type: 'operator', value: ':', raw: ':' },
          { type: 'string', value: 'value', raw: '"value"' }
        ];
        
        // This is the processor function similar to what would be passed by parseObjectProperties
        const processor = (currentTokens: Token[], isSpread: boolean, key?: string) => {
          return { key: key || '', value: currentTokens, spread: isSpread };
        };
        
        // The error should occur when currentTokens contains more than 1 token at colon
        expect(() => {
          evaluatorAny.parseGroupedElements(tokens, ',', processor);
        }).toThrow(ExpressionError);
        
        expect(() => {
          evaluatorAny.parseGroupedElements(tokens, ',', processor);
        }).toThrow('Invalid object literal: invalid key');
      } else {
        // Fallback for when we can't access the private method
        logger.warn('Could not directly access parseGroupedElements method.');
        logger.log('Attempting indirect test of lines 478-480...');
        
        // Use the public evaluate method to try to trigger the error
        expect(() => {
          evaluator.evaluate('{ a b: "value" }', {});
        }).toThrow(ExpressionError);
        
        // Don't throw a specific error since we can't confirm it hit lines 478-480
        logger.log('Test passed with an error, but cannot confirm lines 478-480 were covered directly.');
      }
    });
    
    // Try a few more variations to increase chances of hitting the line
    it('should throw for different types of invalid object keys', () => {
      // Test a variety of invalid key formats
      const invalidExpressions = [
        '{ a b: "value" }',         // Multiple tokens as key
        '{ 1 + 2: "value" }',       // Expression as key
        '{ "a" "b": "value" }',     // Multiple string tokens
        '{ a - b: "value" }',       // Expression with operator
        '{ "test" + 1: "value" }'   // Mixed expression
      ];
      
      // Try each expression, collecting any that don't throw for debugging
      const nonThrowingExpressions: string[] = [];
      
      for (const expr of invalidExpressions) {
        try {
          evaluator.evaluate(expr, {});
          nonThrowingExpressions.push(expr);
        } catch (error) {
          // We expect these to throw
          expect(error).toBeInstanceOf(ExpressionError);
          
          if (error instanceof ExpressionError) {
            // Check if the error message contains the expected text
            expect(error.message).toContain('Invalid object literal: invalid key');
          }
        }
      }
      
      // If any expressions didn't throw, log them for debugging
      if (nonThrowingExpressions.length > 0) {
        logger.warn('These expressions did not throw as expected:', nonThrowingExpressions);
      }
      
      // Assert that all expressions threw errors
      expect(nonThrowingExpressions).toHaveLength(0);
    });
  });
}); 