import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

describe('SafeExpressionEvaluator Invalid Key Coverage', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  const logger = new TestLogger('SafeExpressionEvaluatorTest');

  beforeEach(() => {
    stepResults = new Map();
    context = {};
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  describe('Object literal with invalid key', () => {
    it('throws an error when an object literal has an invalid key format', () => {
      // This expression has an object with a key that's not a single token
      // It will cause the currentTokens.length !== 1 condition at line 478 to be true
      expect(() => {
        evaluator.evaluate('{ 1 + 2: "value" }', {});
      }).toThrow(ExpressionError);
      
      expect(() => {
        evaluator.evaluate('{ 1 + 2: "value" }', {});
      }).toThrow('Invalid object literal: invalid key');
    });

    it('throws an error for object with multiple tokens before colon', () => {
      // Another test case to ensure the coverage
      expect(() => {
        evaluator.evaluate('{ a b: "value" }', {});
      }).toThrow(ExpressionError);
      
      expect(() => {
        evaluator.evaluate('{ a b: "value" }', {});
      }).toThrow('Invalid object literal: invalid key');
    });
    
    it('throws an error for object with invalid key expressions', () => {
      // Test with various invalid key expressions
      expect(() => {
        evaluator.evaluate('{ (a + b): "value" }', {});
      }).toThrow('Invalid object literal: invalid key');
      
      expect(() => {
        evaluator.evaluate('{ "a" "b": "value" }', {});
      }).toThrow('Invalid object literal: invalid key');
    });
  });
}); 