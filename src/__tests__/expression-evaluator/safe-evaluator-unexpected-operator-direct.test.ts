import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';
import { Token } from '../../expression-evaluator/tokenizer';

// Create a custom test version of the evaluator that allows us to directly test internal methods
class TestableExpressionEvaluator extends SafeExpressionEvaluator {
  public testParseExpression(tokens: Token[]): any {
    return this['parseExpression'](tokens);
  }
}

describe('SafeExpressionEvaluator - Direct Test for Unexpected Operator', () => {
  let evaluator: TestableExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  let logger: TestLogger;

  beforeEach(() => {
    stepResults = new Map();
    context = {};
    logger = new TestLogger('UnexpectedOperatorDirectTest');
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new TestableExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  /**
   * These tests specifically target the conditions where we check for unexpected operators
   * at lines ~378 and ~402 in safe-evaluator.ts:
   * 
   * if (!expectOperator) {
   *   throw new ExpressionError('Unexpected operator');
   * }
   */
  it('throws Unexpected operator when operator is in wrong position', () => {
    // Create a token sequence that will trigger the unexpected operator condition
    // We need to have a token sequence where an operator appears when expectOperator is false
    // First token will be an operator, which should trigger the check
    const tokens: Token[] = [
      { type: 'operator', value: '+', raw: '+' },
      { type: 'number', value: '1', raw: '1' }
    ];

    try {
      // This should throw an Unexpected operator error
      evaluator.testParseExpression(tokens);
      fail('Expected an error but none was thrown');
    } catch (error) {
      // Check that we got the specific error we're looking for
      expect(error).toBeInstanceOf(ExpressionError);
      expect((error as ExpressionError).message).toContain('Unexpected operator');
    }
  });

  it('throws Unexpected operator after valid token when another operator is found', () => {
    // Create another scenario that triggers the check
    // This time after we've had a literal value (so expectOperator would be true),
    // then an operator (which will flip expectOperator to false), 
    // then another operator which should trigger the error
    const tokens: Token[] = [
      { type: 'number', value: '1', raw: '1' }, // number - expectOperator becomes true
      { type: 'operator', value: '+', raw: '+' }, // operator - expectOperator becomes false
      { type: 'operator', value: '*', raw: '*' } // another operator when expectOperator is false - should error
    ];

    try {
      evaluator.testParseExpression(tokens);
      fail('Expected an error but none was thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionError);
      expect((error as ExpressionError).message).toContain('Unexpected operator');
    }
  });

  it('throws Unexpected operator when a reference is followed by another reference', () => {
    const tokens: Token[] = [
      { type: 'reference', value: [{ type: 'identifier', value: 'a', raw: 'a' }], raw: '${a}' },
      // After a reference, expectOperator is true, so another reference should throw
      { type: 'reference', value: [{ type: 'identifier', value: 'b', raw: 'b' }], raw: '${b}' }
    ];

    try {
      evaluator.testParseExpression(tokens);
      fail('Expected an error but none was thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionError);
      // This could throw "Unexpected reference" rather than "Unexpected operator"
      expect((error as ExpressionError).message).toMatch(/Unexpected (reference|operator)/);
    }
  });

  // This test specifically targets line 378 - when an identifier that's also an operator is encountered
  // when expectOperator is false
  it('throws Unexpected operator when identifier that matches operator appears in wrong position', () => {
    // Create a token sequence with an identifier token that happens to match an operator symbol
    // when expectOperator is false
    const tokens: Token[] = [
      { type: 'identifier', value: '+', raw: '+' }, // This should trigger the error at line 378
      { type: 'number', value: '1', raw: '1' }
    ];

    try {
      evaluator.testParseExpression(tokens);
      fail('Expected an error but none was thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionError);
      expect((error as ExpressionError).message).toContain('Unexpected operator');
    }
  });

  // This test targets line 387 - when an identifier appears in wrong position (when expectOperator is true)
  it('throws Unexpected identifier when identifier appears after another value', () => {
    // Create a token sequence with an identifier that appears when expectOperator is true
    const tokens: Token[] = [
      { type: 'number', value: '1', raw: '1' }, // number - expectOperator becomes true
      { type: 'identifier', value: 'foo', raw: 'foo' } // identifier when expectOperator is true - should error
    ];

    try {
      evaluator.testParseExpression(tokens);
      fail('Expected an error but none was thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExpressionError);
      expect((error as ExpressionError).message).toContain('Unexpected identifier');
    }
  });

  // This test specifically checks that valid operator sequences don't throw errors
  it('correctly handles valid operator positions', () => {
    // A valid token sequence should not throw
    const validTokens: Token[] = [
      { type: 'number', value: '1', raw: '1' }, // number - expectOperator becomes true
      { type: 'operator', value: '+', raw: '+' }, // operator - expectOperator becomes false
      { type: 'number', value: '2', raw: '2' } // number - valid after operator
    ];

    // This should not throw
    const result = evaluator.testParseExpression(validTokens);
    expect(result).toBeDefined();
  });
}); 