import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

describe('SafeExpressionEvaluator - Debug Tests (Consolidated)', () => {
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
  describe('Operator Stack - Basic Tests', () => {
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
  describe('Operator Stack - Complex Tests', () => {
    it('tests operatorStack in complex expressions with erroneous reference placements', () => {
      context.a = 10;
      context.b = 20;
      context.nested = { value: 30 };
      
      const evaluatorAny = evaluator as any;

      // Skip test if we can't access the parseExpression method
      if (typeof evaluatorAny.parseExpression !== 'function') {
        logger.warn('Cannot access parseExpression method, skipping test');
        return;
      }

      // Save the original parseExpression method
      const originalParseExpression = evaluatorAny.parseExpression;

      // Tracking variables
      let foundNonEmptyStackWithExpectOperator = false;
      const operatorStackSizesWhenExpectOperatorIsTrue: number[] = [];

      // Create a patched version that tracks operator stack state
      evaluatorAny.parseExpression = function (tokens: any[]) {
        logger.log('Tokens to parse:', JSON.stringify(tokens));

        const operatorStack: any[] = [];
        let expectOperator = false;

        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i];
          logger.log(`[${i}] Processing token: ${JSON.stringify(token)}`);
          logger.log(`[${i}] Current operatorStack: ${JSON.stringify(operatorStack)}`);
          logger.log(`[${i}] expectOperator: ${expectOperator}`);

          // Handle parentheses first
          if (token.value === '(') {
            operatorStack.push('(');
            logger.log(`[${i}] Pushed opening paren, stack: ${JSON.stringify(operatorStack)}`);
            continue;
          }

          if (token.value === ')') {
            let foundParen = false;
            while (operatorStack.length > 0) {
              const op = operatorStack.pop();
              if (op === '(') {
                foundParen = true;
                break;
              }
            }
            logger.log(`[${i}] After closing paren, stack: ${JSON.stringify(operatorStack)}`);
            continue;
          }

          // For reference tokens
          if (token.type === 'reference') {
            logger.log(
              `[${i}] Reference token with expectOperator=${expectOperator}, stack: ${JSON.stringify(operatorStack)}`,
            );

            // This is the key condition we're trying to test:
            // Is it possible for operatorStack to be non-empty when encountering a reference
            // with expectOperator = true?
            if (expectOperator) {
              logger.log(
                `[${i}] Found reference with expectOperator=true, stack size: ${operatorStack.length}`,
              );
              operatorStackSizesWhenExpectOperatorIsTrue.push(operatorStack.length);

              if (operatorStack.length > 0) {
                foundNonEmptyStackWithExpectOperator = true;
                logger.log(
                  `[${i}] FOUND NON-EMPTY OPERATOR STACK (${operatorStack.length}) WHEN HANDLING REFERENCE WITH expectOperator=true`,
                );
              }
            }

            expectOperator = true;
          }
          // For operator tokens
          else if (
            token.type === 'operator' ||
            ['+', '-', '*', '/', '&&', '||'].includes(token.value)
          ) {
            operatorStack.push(token.value);
            logger.log(
              `[${i}] Pushed operator ${token.value}, stack: ${JSON.stringify(operatorStack)}`,
            );
            expectOperator = false;
          }
          // For any other tokens
          else {
            logger.log(`[${i}] Regular token, setting expectOperator=true`);
            expectOperator = true;
          }
        }

        logger.log(`Final operatorStack: ${JSON.stringify(operatorStack)}`);

        // Restore and call original
        evaluatorAny.parseExpression = originalParseExpression;
        return originalParseExpression.call(this, tokens);
      };

      try {
        // Test 1: Valid parenthesized expression
        try {
          logger.log('\nTest 1: Valid expression: (${context.a} + ${context.b}) * 2');
          const result = evaluator.evaluate('(${context.a} + ${context.b}) * 2', {});
          logger.log(`Result: ${result}`);
        } catch (error: any) {
          logger.error(`Unexpected error: ${error.message}`);
        }

        // Test 2: Invalid expression with reference where operator is expected in parentheses
        try {
          logger.log('\nTest 2: Invalid expression: (${context.a} ${context.b}) * 2');
          evaluator.evaluate('(${context.a} ${context.b}) * 2', {});
          logger.error('Error: Should have thrown but did not');
        } catch (error: any) {
          logger.log(`Got expected error: ${error.message}`);
        }

        // Test 3: Invalid expression with reference right after opening parenthesis and another reference
        try {
          logger.log('\nTest 3: Invalid expression: (${context.a}) ${context.b} * 2');
          evaluator.evaluate('(${context.a}) ${context.b} * 2', {});
          logger.error('Error: Should have thrown but did not');
        } catch (error: any) {
          logger.log(`Got expected error: ${error.message}`);
        }

        // Test 4: Very complex expression to maximize chances of a non-empty stack
        try {
          logger.log(
            '\nTest 4: Complex valid expression: (${context.a} + (${context.b} * ${context.nested.value})) / 2',
          );
          const result = evaluator.evaluate(
            '(${context.a} + (${context.b} * ${context.nested.value})) / 2',
            {},
          );
          logger.log(`Result: ${result}`);
        } catch (error: any) {
          logger.error(`Unexpected error: ${error.message}`);
        }

        // Test 5: Complex invalid expression
        try {
          logger.log(
            '\nTest 5: Complex invalid expression: (${context.a} + (${context.b} ${context.nested.value})) / 2',
          );
          evaluator.evaluate('(${context.a} + (${context.b} ${context.nested.value})) / 2', {});
          logger.error('Error: Should have thrown but did not');
        } catch (error: any) {
          logger.log(`Got expected error: ${error.message}`);
        }

        // Report findings
        logger.log('\n=== Test Results ===');
        logger.log(
          `Found non-empty operator stack when expectOperator is true: ${foundNonEmptyStackWithExpectOperator}`,
        );
        logger.log(
          `Operator stack sizes when expectOperator is true: ${operatorStackSizesWhenExpectOperatorIsTrue}`,
        );

        if (foundNonEmptyStackWithExpectOperator) {
          logger.log(
            'CONCLUSION: The hypothesis is FALSE. It is possible for the operator stack to be non-empty when handling a reference with expectOperator=true.',
          );
        } else {
          logger.log(
            'CONCLUSION: The hypothesis is TRUE. The operator stack is always empty when handling a reference with expectOperator=true.',
          );
          logger.log(
            'This suggests that lines 383-391 in safe-evaluator.ts may indeed be dead code.',
          );
        }
      } finally {
        // Always restore the original method
        evaluatorAny.parseExpression = originalParseExpression;
      }
    });
  });

  // From safe-evaluator-debug.test.ts additional tests
  describe('Complex Expression Parsing', () => {
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
          '(${context.value} + 3) * 2',
          '${context.value} > 3 ? true : false',
        ];

        for (const expr of expressions) {
          logger.log(`\nTesting expression: ${expr}`);
          try {
            const result = evaluator.evaluate(expr, {});
            logger.log(`Result: ${result}`);
          } catch (error: any) {
            logger.error(`Error evaluating ${expr}: ${error.message}`);
          }
        }
      } finally {
        // Restore original methods
        evaluatorAny.parseExpression = originalParseExpression;
        evaluatorAny.tokenize = originalTokenize;
      }
    });

    it('traces token processing through complex expressions', () => {
      const evaluatorAny = evaluator as any;
      
      if (typeof evaluatorAny.parse !== 'function') {
        logger.warn('Cannot access parse method, skipping trace test');
        return;
      }

      // Save original methods we'll be overriding
      const originalParse = evaluatorAny.parse;

      // Replace with a tracing version
      evaluatorAny.parse = function (tokens: any[]) {
        logger.log('Tracing parse call with tokens:', JSON.stringify(tokens));
        
        // Track token processing
        for (let i = 0; i < tokens.length; i++) {
          const token = tokens[i];
          logger.log(`Token ${i}: ${token.type}:${token.value}`);
        }

        return originalParse.call(this, tokens);
      };

      try {
        // Test cases with different types of expressions
        const expressions = [
          '1 + 2 * 3',
          '${context.value} + 3',
          '!true',
          '"a" + "b"',
          '(1 + 2) * 3',
          '{key: 1 + 2}',
          '[1, 2, 3]',
          'null ?? "default"'
        ];

        for (const expr of expressions) {
          logger.log(`\nTracing expression: ${expr}`);
          try {
            const result = evaluator.evaluate(expr, {});
            logger.log(`=> ${result}`);
          } catch (error: any) {
            logger.error(`Error: ${error.message}`);
          }
        }
      } finally {
        // Restore original methods
        evaluatorAny.parse = originalParse;
      }
    });
  });
}); 