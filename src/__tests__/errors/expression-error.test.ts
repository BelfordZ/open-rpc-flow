import { ExpressionError } from '../../errors';
import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ReferenceResolver } from '../../reference-resolver';
import { defaultLogger } from '../../util/logger';

describe('ExpressionError scenarios', () => {
  let expressionEvaluator: SafeExpressionEvaluator;
  
  beforeEach(() => {
    const referenceResolver = new ReferenceResolver(new Map(), {}, defaultLogger);
    expressionEvaluator = new SafeExpressionEvaluator(defaultLogger, referenceResolver);
  });

  it('should throw ExpressionError for invalid property access', () => {
    const context = { validVariable: 'exists' };
    
    // Try to access a non-existent property
    expect(() => {
      expressionEvaluator.evaluate('${validVariable.nonExistentProperty}', context);
    }).toThrow(ExpressionError);
    expect(() => {
      expressionEvaluator.evaluate('${validVariable.nonExistentProperty}', context);
    }).toThrow(/Reference resolution failed/);
  });

  it('should throw ExpressionError for invalid mathematical operations', () => {
    const context = { stringValue: 'not a number' };
    
    // Try to subtract a string from a number
    expect(() => {
      expressionEvaluator.evaluate('${5 - stringValue}', context);
    }).toThrow(ExpressionError);
    expect(() => {
      expressionEvaluator.evaluate('${5 - stringValue}', context);
    }).toThrow(/Reference not found/);
  });

  it('should throw ExpressionError for syntax errors', () => {
    // Invalid expression syntax
    expect(() => {
      expressionEvaluator.evaluate('${5 +}', {});
    }).toThrow(ExpressionError);
    expect(() => {
      expressionEvaluator.evaluate('${5 +}', {});
    }).toThrow(/Reference not found/);
  });

  it('should throw ExpressionError for undefined variables', () => {
    // Try to use an undefined variable
    expect(() => {
      expressionEvaluator.evaluate('${undefinedVariable}', {});
    }).toThrow(ExpressionError);
    expect(() => {
      expressionEvaluator.evaluate('${undefinedVariable}', {});
    }).toThrow(/Reference not found/);
  });
}); 