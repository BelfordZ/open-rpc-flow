import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

describe('SafeExpressionEvaluator - Debugging OperatorStack', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  let logger: TestLogger;

  beforeEach(() => {
    stepResults = new Map();
    context = { value: 5 };
    logger = new TestLogger('SafeEvaluatorDebugTest');
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  it('tests if operatorStack is always empty when processing references', () => {
    // First, let's modify the parse method to log the operator stack state
    const evaluatorAny = evaluator as any;

    if (typeof evaluatorAny.parseExpression !== 'function') {
      logger.warn('Cannot access parseExpression method, skipping detailed debug test');
      return;
    }

    // Save the original method
    const originalParseExpression = evaluatorAny.parseExpression;

    // Replace with our debugging version
    evaluatorAny.parseExpression = function (tokens: any[]) {
      const operatorStack: any[] = [];
      const outputQueue: any[] = [];
      let expectOperator = false;

      for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        // Handle parentheses first
        if (token.value === '(') {
          operatorStack.push('(');
          continue;
        }

        if (token.value === ')') {
          let foundMatching = false;
          while (operatorStack.length > 0) {
            const op = operatorStack.pop();
            if (op === '(') {
              foundMatching = true;
              break;
            }
          }
          if (!foundMatching) {
            logger.error('Mismatched parentheses!');
          }
          continue;
        }

        // Check for reference tokens specifically
        if (token.type === 'reference') {
          if (expectOperator) {
            // Directly test our hypothesis: is operatorStack always empty here?
            if (operatorStack.length !== 0) {
              logger.error('OperatorStack should be empty but is not');
            }
            throw new ExpressionError('Unexpected reference');
          }
          expectOperator = true;
        }
        // For simplicity, handle basic operators
        else if (
          token.type === 'operator' ||
          ['&&', '||', '+', '-', '*', '/'].includes(token.value)
        ) {
          if (!expectOperator) {
            throw new ExpressionError('Unexpected operator');
          }

          operatorStack.push(token.value);
          expectOperator = false;
        }
        // For all other tokens (numbers, strings, etc.)
        else {
          if (expectOperator) {
            throw new ExpressionError('Unexpected token');
          }
          outputQueue.push({ type: 'literal', value: token.value });
          expectOperator = true;
        }
      }

      // Restore the original method and call it
      evaluatorAny.parseExpression = originalParseExpression;
      return originalParseExpression.call(this, tokens);
    };

    try {
      // 1. Test with valid reference usage
      try {
        logger.log('Testing with valid reference: ${context.value}');
        evaluator.evaluate('${context.value}', {});
      } catch (error: any) {
        logger.error(`Unexpected error with valid reference: ${error}`);
      }

      // 2. Test with reference + operator (valid)
      try {
        logger.log('Testing with valid reference + operator: ${context.value} + 3');
        evaluator.evaluate('${context.value} + 3', {});
      } catch (error: any) {
        logger.error(`Unexpected error with valid reference + operator: ${error}`);
      }

      // 3. Test with operator + reference (valid)
      try {
        logger.log('Testing with valid operator + reference: 3 + ${context.value}');
        evaluator.evaluate('3 + ${context.value}', {});
      } catch (error: any) {
        logger.error(`Unexpected error with valid operator + reference: ${error}`);
      }

      // 4. Test with reference + reference (should trigger error)
      try {
        logger.log('Testing with invalid reference + reference: ${context.value} ${context.value}');
        evaluator.evaluate('${context.value} ${context.value}', {});
        logger.error('Error: Should have thrown but did not');
      } catch (error: any) {
        logger.log(`Got expected error with reference + reference: ${error.message}`);
      }

      // 5. Test with number + reference (should trigger error)
      try {
        logger.log('Testing with invalid number + reference: 5 ${context.value}');
        evaluator.evaluate('5 ${context.value}', {});
        logger.error('Error: Should have thrown but did not');
      } catch (error: any) {
        logger.log(`Got expected error with number + reference: ${error.message}`);
      }

      // 6. Test with parenthesized expression to see if operatorStack gets populated
      try {
        logger.log('Testing with parenthesized expression: (${context.value} + 3) * 2');
        evaluator.evaluate('(${context.value} + 3) * 2', {});
      } catch (error: any) {
        logger.error(`Unexpected error with parenthesized expression: ${error}`);
      }
    } finally {
      // Make sure we restore the original method
      evaluatorAny.parseExpression = originalParseExpression;
    }
  });
});
