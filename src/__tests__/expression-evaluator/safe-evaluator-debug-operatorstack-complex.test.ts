import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

describe('SafeExpressionEvaluator - Complex OperatorStack Tests', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  let logger: TestLogger;

  beforeEach(() => {
    stepResults = new Map();
    context = { 
      value: 5,
      a: 10,
      b: 20,
      nested: {
        value: 30
      }
    };
    logger = new TestLogger('SafeEvaluatorComplexTest');
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  /**
   * Tests focus on cases where we have complex expressions with parentheses and operators
   * where the operatorStack should be non-empty at various points.
   * We want to see if it's possible for an operatorStack to be non-empty when processing a reference
   * with expectOperator = true.
   */ 
  it('tests operatorStack in complex expressions with erroneous reference placements', () => {
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
    let operatorStackSizesWhenExpectOperatorIsTrue: number[] = [];
    
    // Create a patched version that tracks operator stack state
    evaluatorAny.parseExpression = function(tokens: any[]) {
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
          logger.log(`[${i}] Reference token with expectOperator=${expectOperator}, stack: ${JSON.stringify(operatorStack)}`);
          
          // This is the key condition we're trying to test:
          // Is it possible for operatorStack to be non-empty when encountering a reference
          // with expectOperator = true? 
          if (expectOperator) {
            logger.log(`[${i}] Found reference with expectOperator=true, stack size: ${operatorStack.length}`);
            operatorStackSizesWhenExpectOperatorIsTrue.push(operatorStack.length);
            
            if (operatorStack.length > 0) {
              foundNonEmptyStackWithExpectOperator = true;
              logger.log(`[${i}] FOUND NON-EMPTY OPERATOR STACK (${operatorStack.length}) WHEN HANDLING REFERENCE WITH expectOperator=true`);
            }
          }
          
          expectOperator = true;
        }
        // For operator tokens
        else if (token.type === 'operator' || ['+', '-', '*', '/', '&&', '||'].includes(token.value)) {
          operatorStack.push(token.value);
          logger.log(`[${i}] Pushed operator ${token.value}, stack: ${JSON.stringify(operatorStack)}`);
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
        logger.log('\nTest 4: Complex valid expression: (${context.a} + (${context.b} * ${context.nested.value})) / 2');
        const result = evaluator.evaluate('(${context.a} + (${context.b} * ${context.nested.value})) / 2', {});
        logger.log(`Result: ${result}`);
      } catch (error: any) {
        logger.error(`Unexpected error: ${error.message}`);
      }
      
      // Test 5: Complex invalid expression
      try {
        logger.log('\nTest 5: Complex invalid expression: (${context.a} + (${context.b} ${context.nested.value})) / 2');
        evaluator.evaluate('(${context.a} + (${context.b} ${context.nested.value})) / 2', {});
        logger.error('Error: Should have thrown but did not');
      } catch (error: any) {
        logger.log(`Got expected error: ${error.message}`);
      }
      
      // Report findings
      logger.log('\n=== Test Results ===');
      logger.log(`Found non-empty operator stack when expectOperator is true: ${foundNonEmptyStackWithExpectOperator}`);
      logger.log(`Operator stack sizes when expectOperator is true: ${operatorStackSizesWhenExpectOperatorIsTrue}`);
      
      if (foundNonEmptyStackWithExpectOperator) {
        logger.log('CONCLUSION: The hypothesis is FALSE. It is possible for the operator stack to be non-empty when handling a reference with expectOperator=true.');
      } else {
        logger.log('CONCLUSION: The hypothesis is TRUE. The operator stack is always empty when handling a reference with expectOperator=true.');
        logger.log('This suggests that lines 383-391 in safe-evaluator.ts may indeed be dead code.');
      }
      
    } finally {
      // Always restore the original method
      evaluatorAny.parseExpression = originalParseExpression;
    }
  });
}); 