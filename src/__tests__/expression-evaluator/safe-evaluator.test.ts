import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { noLogger } from '../../util/logger';

describe('SafeExpressionEvaluator', () => {
  let evaluator: SafeExpressionEvaluator;

  beforeEach(() => {
    evaluator = new SafeExpressionEvaluator(noLogger);
  });

  describe('evaluate', () => {
    it('evaluates simple arithmetic expressions', () => {
      expect(evaluator.evaluate('2 + 2', {})).toBe(4);
      expect(evaluator.evaluate('10 - 5', {})).toBe(5);
      expect(evaluator.evaluate('3 * 4', {})).toBe(12);
      expect(evaluator.evaluate('15 / 3', {})).toBe(5);
      expect(evaluator.evaluate('7 % 3', {})).toBe(1);
    });

    it('evaluates comparison expressions', () => {
      expect(evaluator.evaluate('5 > 3', {})).toBe(true);
      expect(evaluator.evaluate('5 < 3', {})).toBe(false);
      expect(evaluator.evaluate('5 >= 5', {})).toBe(true);
      expect(evaluator.evaluate('5 <= 3', {})).toBe(false);
      expect(evaluator.evaluate('5 == 5', {})).toBe(true);
      expect(evaluator.evaluate('5 != 3', {})).toBe(true);
    });

    it('evaluates logical expressions', () => {
      expect(evaluator.evaluate('true && true', {})).toBe(true);
      expect(evaluator.evaluate('true && false', {})).toBe(false);
      expect(evaluator.evaluate('false || true', {})).toBe(true);
      expect(evaluator.evaluate('false || false', {})).toBe(false);
    });

    it('evaluates nullish coalescing', () => {
      expect(evaluator.evaluate('null ?? "default"', {})).toBe('default');
      expect(evaluator.evaluate('undefined ?? "default"', {})).toBe('default');
      expect(evaluator.evaluate('0 ?? "default"', {})).toBe(0);
      expect(evaluator.evaluate('false ?? "default"', {})).toBe(false);
    });

    it('evaluates references from context', () => {
      const context = {
        user: {
          name: 'John',
          age: 30,
        },
        settings: {
          enabled: true,
        },
      };

      expect(evaluator.evaluate('user.name', context)).toBe('John');
      expect(evaluator.evaluate('user.age > 25', context)).toBe(true);
      expect(evaluator.evaluate('settings.enabled', context)).toBe(true);
    });

    it('handles literals correctly', () => {
      expect(evaluator.evaluate('42', {})).toBe(42);
      expect(evaluator.evaluate('-42', {})).toBe(-42);
      expect(evaluator.evaluate('3.14', {})).toBe(3.14);
      expect(evaluator.evaluate('"hello"', {})).toBe('hello');
      expect(evaluator.evaluate('true', {})).toBe(true);
      expect(evaluator.evaluate('false', {})).toBe(false);
      expect(evaluator.evaluate('null', {})).toBe(null);
      expect(evaluator.evaluate('undefined', {})).toBe(undefined);
    });
  });

  describe('error handling', () => {
    it('throws on invalid expressions', () => {
      expect(() => evaluator.evaluate('', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('invalid expression', {})).toThrow(ExpressionError);
    });

    it('throws on unknown operators', () => {
      expect(() => evaluator.evaluate('a @ b', {})).toThrow('Unknown operator: @');
    });

    it('throws on invalid references', () => {
      expect(() => evaluator.evaluate('nonexistent.property', {})).toThrow(
        "Property 'nonexistent' not found in context",
      );
    });

    it('throws on null/undefined property access', () => {
      const context = { obj: null };
      expect(() => evaluator.evaluate('obj.property', context)).toThrow(
        "Cannot access property 'property' of null",
      );
    });

    it('throws on dangerous patterns', () => {
      expect(() => evaluator.evaluate('constructor', {})).toThrow(
        'Expression contains forbidden pattern: constructor',
      );
      expect(() => evaluator.evaluate('__proto__', {})).toThrow(
        'Expression contains forbidden pattern: __proto__',
      );
      expect(() => evaluator.evaluate('prototype', {})).toThrow(
        'Expression contains forbidden pattern: prototype',
      );
    });

    it('throws on expression timeout', async () => {
      // Create a complex expression that will timeout
      const complexExpression = Array(100).fill('1 + ').join('') + '1';
      (evaluator as any).TIMEOUT_MS = 1; // Set timeout to 1ms
      expect(() => evaluator.evaluate(complexExpression, {})).toThrow(
        'Expression evaluation timed out',
      );
    });

    it('throws on expression length limit', () => {
      const longExpression = 'x'.repeat(1001);
      expect(() => evaluator.evaluate(longExpression, {})).toThrow(
        'Expression length exceeds maximum',
      );
    });
  });

  describe('operator precedence', () => {
    it('respects arithmetic operator precedence', () => {
      expect(evaluator.evaluate('2 + 3 * 4', {})).toBe(14);
      expect(evaluator.evaluate('(2 + 3) * 4', {})).toBe(20);
      expect(evaluator.evaluate('10 - 2 * 3', {})).toBe(4);
    });

    it('respects logical operator precedence', () => {
      expect(evaluator.evaluate('true || false && false', {})).toBe(true);
      expect(evaluator.evaluate('(true || false) && false', {})).toBe(false);
    });

    it('respects comparison operator precedence', () => {
      expect(evaluator.evaluate('2 + 3 > 4', {})).toBe(true);
      expect(evaluator.evaluate('2 + (3 > 4)', {})).toBe(2);
    });
  });

  describe('complex expressions', () => {
    it('evaluates nested expressions', () => {
      const context = {
        a: 1,
        b: 2,
        c: 3,
      };

      expect(evaluator.evaluate('(a + b) * c', context)).toBe(9);
      expect(evaluator.evaluate('a + b * c', context)).toBe(7);
      expect(evaluator.evaluate('(a > b) || (b < c) && true', context)).toBe(true);
    });

    it('handles deep object references', () => {
      const context = {
        user: {
          profile: {
            settings: {
              notifications: {
                enabled: true,
              },
            },
          },
        },
      };

      expect(evaluator.evaluate('user.profile.settings.notifications.enabled', context)).toBe(true);
    });

    it('combines multiple operators', () => {
      const context = {
        x: 10,
        y: 20,
        z: 30,
      };

      expect(evaluator.evaluate('x + y * z / 2', context)).toBe(310);
      expect(evaluator.evaluate('(x + y) * (z / 2)', context)).toBe(450);
    });
  });
});
