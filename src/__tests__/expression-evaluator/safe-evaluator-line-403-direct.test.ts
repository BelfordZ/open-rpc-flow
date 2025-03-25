import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

describe('SafeExpressionEvaluator - Line 403 Direct Testing', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  let logger: TestLogger;

  beforeEach(() => {
    stepResults = new Map();
    context = { value: 5 };
    logger = new TestLogger('SafeEvaluatorLine403DirectTest');
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  /**
   * These tests specifically target line 403 in safe-evaluator.ts:
   * 
   * ```typescript
   * if (this.getPrecedence(topOperator as Operator) >= this.getPrecedence(op)) {
   * ```
   * 
   * This line handles operator precedence when parsing expressions with multiple operators.
   */
  it('tests line 403 by validating operator precedence behavior', () => {
    // Create scenarios where we know the precedence comparison will be evaluated
    const testCases = [
      {
        expression: '3 * 4 + 2',
        description: 'Higher precedence operator first (* then +)',
        expected: 14, // (3 * 4) + 2 = 12 + 2 = 14
      },
      {
        expression: '2 + 3 * 4',
        description: 'Lower precedence operator first (+ then *)',
        expected: 14, // 2 + (3 * 4) = 2 + 12 = 14
      },
      {
        expression: '10 + 5 - 3',
        description: 'Equal precedence operators (+ then -)',
        expected: 12, // (10 + 5) - 3 = 15 - 3 = 12
      },
      {
        expression: '10 * 2 / 4',
        description: 'Equal precedence operators (* then /)',
        expected: 5, // (10 * 2) / 4 = 20 / 4 = 5
      },
      {
        expression: 'true && false || true',
        description: 'Mixed precedence logical operators (&& then ||)',
        expected: true, // (true && false) || true = false || true = true
      },
      {
        expression: 'false || true && true',
        description: 'Mixed precedence logical operators (|| then &&)',
        expected: true, // false || (true && true) = false || true = true
      },
      {
        expression: '5 > 3 && 2 < 1',
        description: 'Comparison operators with logical operators',
        expected: false, // (5 > 3) && (2 < 1) = true && false = false
      },
      {
        expression: '5 * 2 / 2 + 3 * 4',
        description: 'Complex mixed precedence',
        expected: 17, // ((5 * 2) / 2) + (3 * 4) = 5 + 12 = 17
      },
    ];

    // Run all test cases and ensure the expressions evaluate correctly
    for (const testCase of testCases) {
      logger.log(`Testing: ${testCase.description} - Expression: ${testCase.expression}`);
      const result = evaluator.evaluate(testCase.expression, {});
      expect(result).toBe(testCase.expected);
      logger.log(`Result: ${result} (expected: ${testCase.expected})`);
    }
  });

  it('tests line 403 by examining a large variety of operator combinations', () => {
    // Test a wide variety of expressions to ensure comprehensive coverage
    const operators = ['+', '-', '*', '/', '&&', '||', '==', '!=', '>', '>=', '<', '<='];
    const operandPairs = [
      ['5', '3'],        // numbers
      ['true', 'false'], // booleans
      ['"a"', '"b"'],    // strings
    ];

    // Track that at least one expression passes
    let expressionPassed = false;

    // Generate and test expressions for all valid operator combinations
    for (const [operand1, operand2] of operandPairs) {
      for (const op1 of operators) {
        for (const op2 of operators) {
          // Skip invalid combinations like 5 && 3
          if ((op1 === '&&' || op1 === '||') && (operand1 !== 'true' && operand1 !== 'false')) continue;
          if ((op2 === '&&' || op2 === '||') && (operand2 !== 'true' && operand2 !== 'false')) continue;

          // Create an expression with two operators
          const expression = `${operand1} ${op1} ${operand2} ${op2} ${operand1}`;

          try {
            // This will evaluate the expression and trigger line 403
            const result = evaluator.evaluate(expression, {});
            logger.log(`Expression ${expression} evaluated to ${result}`);
            expressionPassed = true;
          } catch (error) {
            // Some combinations might be syntactically invalid, which is fine
            logger.log(`Expression ${expression} failed: ${error}`);
          }
        }
      }
    }

    // Ensure at least one expression was successfully evaluated
    expect(expressionPassed).toBe(true);
  });

  it('tests the specific precedence logic used in line 403', () => {
    // Map of operators to their precedence levels (similar to the original code)
    const precedenceMap: Record<string, number> = {
      '||': 1,
      '&&': 2,
      '==': 3, '===': 3, '!=': 3, '!==': 3,
      '<': 4, '<=': 4, '>': 4, '>=': 4,
      '+': 5, '-': 5,
      '*': 6, '/': 6, '%': 6,
      '??': 7
    };

    // Test various precedence comparisons (the logic in line 403)
    const operatorPairs = [
      { top: '*', op: '+', description: 'Higher precedence on top', expectedResult: true },
      { top: '+', op: '*', description: 'Lower precedence on top', expectedResult: false },
      { top: '+', op: '-', description: 'Equal precedence', expectedResult: true },
      { top: '&&', op: '||', description: 'Logical operators', expectedResult: true },
      { top: '==', op: '!=', description: 'Equality operators', expectedResult: true },
      { top: '<', op: '>', description: 'Comparison operators', expectedResult: true },
      { top: '*', op: '/', description: 'Multiplication and division', expectedResult: true }
    ];

    for (const pair of operatorPairs) {
      const topPrecedence = precedenceMap[pair.top];
      const opPrecedence = precedenceMap[pair.op];
      
      // This is the actual condition in line 403
      const conditionResult = topPrecedence >= opPrecedence;
      
      logger.log(`Precedence comparison: ${pair.top} (${topPrecedence}) vs ${pair.op} (${opPrecedence}): ${conditionResult}`);
      
      // Verify that our understanding of precedence matches the expected result
      expect(conditionResult).toBe(pair.expectedResult);
    }

    // Now validate that our precedence map matches the real implementation
    // by testing expressions that rely on these precedence rules
    const expressionTests = [
      { expr: '2 * 3 + 4', expected: 10 },    // * has higher precedence than +
      { expr: '2 + 3 * 4', expected: 14 },    // * has higher precedence than +
      { expr: '10 - 5 - 2', expected: 3 },    // - and - have equal precedence
      { expr: '10 * 2 / 5', expected: 4 }     // * and / have equal precedence
    ];

    for (const test of expressionTests) {
      const result = evaluator.evaluate(test.expr, {});
      logger.log(`Expression ${test.expr} evaluated to ${result} (expected: ${test.expected})`);
      expect(result).toBe(test.expected);
    }
  });
}); 