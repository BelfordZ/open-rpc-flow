import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

describe('SafeExpressionEvaluator - Debug Tests', () => {
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

  // From safe-evaluator-debug-operatorstack.test.ts
  describe('Operator Stack Debugging', () => {
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
          logger.log(
            'Testing with invalid reference + reference: ${context.value} ${context.value}',
          );
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

  // From safe-evaluator-debug-operatorstack-complex.test.ts
  describe('Complex Operator Stack Debugging', () => {
    it('tests operator stack with complex nested expressions', () => {
      // Access the private methods for testing
      const evaluatorAny = evaluator as any;

      if (
        typeof evaluatorAny.parseExpression !== 'function' ||
        typeof evaluatorAny.tokenize !== 'function'
      ) {
        logger.warn('Cannot access required private methods, skipping debug test');
        return;
      }

      // Save the original methods
      const originalParseExpression = evaluatorAny.parseExpression;
      const originalTokenize = evaluatorAny.tokenize;

      // Create a wrapper for parseExpression that logs the stack states
      evaluatorAny.parseExpression = function (tokens: any[]) {
        // This is a simplified version of the parsing algorithm used in SafeExpressionEvaluator
        // focusing on tracking the operatorStack state
        const outputQueue: any[] = [];
        const operatorStack: any[] = [];

        logger.log('Beginning complex parseExpression debug test');
        logger.log('Initial tokens:', JSON.stringify(tokens));

        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i];
          logger.log(`Processing token: ${token.type}:${token.value}`);
          logger.log(`Current operatorStack: ${JSON.stringify(operatorStack)}`);
          logger.log(`Current outputQueue: ${JSON.stringify(outputQueue)}`);

          // Just do minimal processing to track the stack states
          if (token.type === 'number' || token.type === 'string' || token.type === 'boolean') {
            outputQueue.push(token);
          } else if (token.type === 'operator') {
            if (token.value === '(') {
              operatorStack.push(token.value);
            } else if (token.value === ')') {
              let foundMatchingParenthesis = false;
              while (operatorStack.length > 0) {
                const op = operatorStack.pop();
                if (op === '(') {
                  foundMatchingParenthesis = true;
                  break;
                }
                outputQueue.push({ type: 'operator', value: op });
              }
              if (!foundMatchingParenthesis) {
                logger.error('Mismatched parentheses in complex debug test');
              }
            } else {
              // For basic operators
              operatorStack.push(token.value);
            }
          }
        }

        // Clean up remaining operators
        while (operatorStack.length > 0) {
          const op = operatorStack.pop();
          if (op === '(' || op === ')') {
            logger.error(`Unbalanced parenthesis left on stack: ${op}`);
          } else {
            outputQueue.push({ type: 'operator', value: op });
          }
        }

        logger.log('Final operatorStack (should be empty):', JSON.stringify(operatorStack));
        logger.log('Final outputQueue:', JSON.stringify(outputQueue));

        // Restore the original method and call it with the original tokens
        evaluatorAny.parseExpression = originalParseExpression;
        return originalParseExpression.call(this, tokens);
      };

      try {
        // Test a variety of complex expressions to monitor operator stack
        const expressions = [
          '1 + 2 * 3',
          '(1 + 2) * 3',
          '1 + (2 * 3)',
          '((1 + 2) * 3) / 4',
          '${context.value} + (2 * 3)',
          '(${context.value} + 2) * (3 + 4)',
        ];

        for (const expr of expressions) {
          logger.log(`-------------------------`);
          logger.log(`Testing complex expression: ${expr}`);
          try {
            const result = evaluator.evaluate(expr, {});
            logger.log(`Result: ${result}`);
          } catch (error: any) {
            logger.error(`Error evaluating "${expr}": ${error.message}`);
          }
          logger.log(`-------------------------\n`);
        }
      } finally {
        // Make sure we restore the original methods
        evaluatorAny.parseExpression = originalParseExpression;
        evaluatorAny.tokenize = originalTokenize;
      }
    });

    it('tests edge cases with nested and unbalanced expressions', () => {
      // Test a series of edge cases that might stress the operator stack
      const testCases = [
        {
          expression: '(1 + 2) * (3 + 4)',
          valid: true,
          expectedResult: 21,
        },
        {
          expression: '(1 + 2',
          valid: false,
          errorContains: 'mismatched',
        },
        {
          expression: '1 + 2)',
          valid: false,
          errorContains: 'mismatched',
        },
        {
          expression: '(((1 + 2)))',
          valid: true,
          expectedResult: 3,
        },
        {
          expression: '(1 + (2 * (3 + 4)))',
          valid: true,
          expectedResult: 15,
        },
      ];

      for (const testCase of testCases) {
        logger.log(`Testing edge case: ${testCase.expression}`);

        try {
          const result = evaluator.evaluate(testCase.expression, {});

          if (testCase.valid) {
            expect(result).toBe(testCase.expectedResult);
            logger.log(`Successfully evaluated to ${result}`);
          } else {
            fail(`Should have thrown an error for: ${testCase.expression}`);
          }
        } catch (error: any) {
          if (testCase.valid) {
            fail(`Unexpected error for valid expression: ${error.message}`);
          } else {
            expect(error.message.toLowerCase()).toContain(testCase.errorContains);
            logger.log(`Got expected error: ${error.message}`);
          }
        }
      }
    });
  });
});
