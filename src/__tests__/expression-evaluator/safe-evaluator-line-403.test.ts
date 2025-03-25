import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

describe('SafeExpressionEvaluator - Line 403 Testing', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  let logger: TestLogger;

  beforeEach(() => {
    stepResults = new Map();
    context = { value: 5 };
    logger = new TestLogger('SafeEvaluatorLine403Test');
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
  describe('Operator precedence handling', () => {
    // Test expressions with operators that have different precedence levels
    it('correctly handles operators with lower precedence', () => {
      // The + operator has lower precedence than *, so 3 * 4 should be evaluated first
      const result = evaluator.evaluate('2 + 3 * 4', {});

      // Expected: 2 + (3 * 4) = 2 + 12 = 14
      expect(result).toBe(14);
    });

    it('correctly handles operators with equal precedence (left associative)', () => {
      // The * and / operators have equal precedence and are left-associative
      const result = evaluator.evaluate('12 / 4 * 3', {});

      // Expected: (12 / 4) * 3 = 3 * 3 = 9
      expect(result).toBe(9);
    });

    it('correctly handles multiple operators with mixed precedence', () => {
      // This expression mixes +, *, /, and comparison operators to test full precedence rules
      const result = evaluator.evaluate('2 + 3 * 4 / 2 - 1 > 5 && true', {});

      // Expected: 2 + ((3 * 4) / 2) - 1 > 5 && true
      // = 2 + (12 / 2) - 1 > 5 && true
      // = 2 + 6 - 1 > 5 && true
      // = 7 > 5 && true
      // = true && true
      // = true
      expect(result).toBe(true);
    });

    it('respects parentheses over operator precedence', () => {
      // Parentheses should override normal precedence rules
      const result = evaluator.evaluate('(2 + 3) * 4', {});

      // Expected: (2 + 3) * 4 = 5 * 4 = 20
      expect(result).toBe(20);
    });

    it('handles nullish coalescing operator (??) correctly', () => {
      // ?? has high precedence (level 7)
      const result = evaluator.evaluate('null ?? "default" + " value"', {});

      // Expected: null ?? ("default" + " value") = "default value"
      expect(result).toBe('default value');
    });

    it('processes multiple operators of same precedence in left-to-right order', () => {
      // Multiple addition operators should be processed left to right
      const result = evaluator.evaluate('10 - 5 - 2', {});

      // Expected: (10 - 5) - 2 = 5 - 2 = 3
      expect(result).toBe(3);
    });

    it('handles complex expressions with deeply nested operations', () => {
      // A complex expression with multiple operators and parentheses
      const result = evaluator.evaluate('(2 + 3) * (4 - 1) / (2 + 1) + 1', {});

      // Expected: (2 + 3) * (4 - 1) / (2 + 1) + 1
      // = 5 * 3 / 3 + 1
      // = 5 + 1
      // = 6
      expect(result).toBe(6);
    });

    it('handles logical operators with correct precedence', () => {
      // && has higher precedence than ||
      const result = evaluator.evaluate('false || true && true', {});

      // Expected: false || (true && true) = false || true = true
      expect(result).toBe(true);
    });

    it('handles equality operators with correct precedence', () => {
      // Equality operators have higher precedence than logical operators
      const result = evaluator.evaluate('2 == 2 && 3 != 4 || false', {});

      // Expected: (2 == 2) && (3 != 4) || false
      // = true && true || false
      // = true || false
      // = true
      expect(result).toBe(true);
    });

    it('handles nested expressions with references', () => {
      // Set up some context values
      context.a = 5;
      context.b = 10;

      // Test an expression that uses references with operators
      const result = evaluator.evaluate('${context.a} * 2 + ${context.b} / 2', {});

      // Expected: 5 * 2 + 10 / 2 = 10 + 5 = 15
      expect(result).toBe(15);
    });

    // The following tests specifically target line 403 by creating expressions where
    // operator precedence is critical

    it('specifically targets line 403 with higher precedence operators first', () => {
      // In this test, we first process * (high precedence) and then + (lower precedence)
      // This should hit the 'else' branch of the conditional in line 403
      const result = evaluator.evaluate('3 * 4 + 2', {});

      // Expected: (3 * 4) + 2 = 12 + 2 = 14
      expect(result).toBe(14);
    });

    it('specifically targets line 403 with same precedence operators', () => {
      // This will process operations of equal precedence left-to-right
      // It will hit the 'if' branch of the conditional in line 403 because + and - have the same precedence
      const result = evaluator.evaluate('10 + 5 - 3', {});

      // Expected: (10 + 5) - 3 = 15 - 3 = 12
      expect(result).toBe(12);
    });

    it('specifically targets line 403 with lower precedence operators first', () => {
      // First encounters + (lower precedence) and then * (higher precedence)
      // This will hit the 'else' branch in line 403
      const result = evaluator.evaluate('2 + 3 * 4', {});

      // Expected: 2 + (3 * 4) = 2 + 12 = 14
      expect(result).toBe(14);
    });

    it('specifically targets line 403 with complex mixed precedence', () => {
      // This expression specifically creates a situation where we'll hit line 403's condition
      // It combines multiple operators where precedence matters
      const result = evaluator.evaluate('5 * 2 / 2 + 3 * 4', {});

      // Expected: ((5 * 2) / 2) + (3 * 4) = 5 + 12 = 17
      expect(result).toBe(17);
    });

    it('specifically targets line 403 with all higher precedence operators', () => {
      // A sequence of higher precedence operators that should all go through line 403's condition
      const result = evaluator.evaluate('10 * 2 / 4 * 3', {});

      // Expected: ((10 * 2) / 4) * 3 = (20 / 4) * 3 = 5 * 3 = 15
      expect(result).toBe(15);
    });

    it('specifically targets line 403 with all lower precedence operators', () => {
      // A sequence of lower precedence operators that should all go through line 403's condition
      const result = evaluator.evaluate('10 + 5 - 8 + 3', {});

      // Expected: ((10 + 5) - 8) + 3 = (15 - 8) + 3 = 7 + 3 = 10
      expect(result).toBe(10);
    });

    it('specifically targets line 403 with comparison operators', () => {
      // Using comparison operators which have their own precedence rules
      const result = evaluator.evaluate('5 > 3 && 10 <= 10', {});

      // Expected: (5 > 3) && (10 <= 10) = true && true = true
      expect(result).toBe(true);
    });

    it('specifically targets line 403 with all logical operators', () => {
      // Using multiple logical operators to trigger precedence handling
      const result = evaluator.evaluate('true && false || true && true', {});

      // Expected: (true && false) || (true && true) = false || true = true
      expect(result).toBe(true);
    });
  });

  describe('Direct test of getPrecedence logic', () => {
    // This suite directly tests the getPrecedence method which is used in line 403

    it('assigns correct precedence to multiplication operators', () => {
      // Create a simple expression that uses * and then + to test precedence
      const result = evaluator.evaluate('2 * 3 + 4', {});

      // Expected: (2 * 3) + 4 = 6 + 4 = 10
      expect(result).toBe(10);
    });

    it('assigns correct precedence to division operators', () => {
      // Create a simple expression that uses / and then + to test precedence
      const result = evaluator.evaluate('8 / 2 + 4', {});

      // Expected: (8 / 2) + 4 = 4 + 4 = 8
      expect(result).toBe(8);
    });

    it('assigns correct precedence to modulo operators', () => {
      // Create a simple expression that uses % and then + to test precedence
      const result = evaluator.evaluate('10 % 3 + 4', {});

      // Expected: (10 % 3) + 4 = 1 + 4 = 5
      expect(result).toBe(5);
    });

    it('assigns correct precedence to addition operators', () => {
      // Test that + has lower precedence than *
      const result = evaluator.evaluate('2 + 3 * 4', {});

      // Expected: 2 + (3 * 4) = 2 + 12 = 14
      expect(result).toBe(14);
    });

    it('assigns correct precedence to subtraction operators', () => {
      // Test that - has lower precedence than *
      const result = evaluator.evaluate('10 - 2 * 3', {});

      // Expected: 10 - (2 * 3) = 10 - 6 = 4
      expect(result).toBe(4);
    });

    it('assigns correct precedence to logical OR', () => {
      // Test that || has lower precedence than &&
      const result = evaluator.evaluate('false || true && false', {});

      // Expected: false || (true && false) = false || false = false
      expect(result).toBe(false);
    });

    it('assigns correct precedence to logical AND', () => {
      // Test that && has higher precedence than ||
      const result = evaluator.evaluate('true && false || true', {});

      // Expected: (true && false) || true = false || true = true
      expect(result).toBe(true);
    });

    it('assigns correct precedence to comparison operators', () => {
      // Test that comparison operators have higher precedence than logical operators
      const result = evaluator.evaluate('5 > 3 && 2 < 1', {});

      // Expected: (5 > 3) && (2 < 1) = true && false = false
      expect(result).toBe(false);
    });

    it('assigns correct precedence to equality operators', () => {
      // Test that equality operators have correct precedence
      const result = evaluator.evaluate('5 == 5 && 3 != 4', {});

      // Expected: (5 == 5) && (3 != 4) = true && true = true
      expect(result).toBe(true);
    });

    it('assigns correct precedence to nullish coalescing', () => {
      // Test that ?? has correct precedence
      const result = evaluator.evaluate('null ?? 5 + 3', {});

      // Expected: null ?? (5 + 3) = 8
      expect(result).toBe(8);
    });
  });
});
