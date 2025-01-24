import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

describe('SafeExpressionEvaluator', () => {
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
    logger.print();
    logger.clear();
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
      context.user = {
        name: 'John',
        age: 30,
      };
      context.settings = {
        enabled: true,
      };

      expect(evaluator.evaluate('${context.user.name}', {})).toBe('John');
      expect(evaluator.evaluate('${context.user.age} > 25', {})).toBe(true);
      expect(evaluator.evaluate('${context.settings.enabled}', {})).toBe(true);
    });

    it('works with equality checking references', () => {
      context.user = {
        name: 'John',
        age: 30,
      };
      context.settings = {
        enabled: true,
      };

      expect(evaluator.evaluate('${context.user.name} == "John"', {})).toBe(true);
      expect(evaluator.evaluate('${context.settings.enabled} == true', {})).toBe(true);
      expect(evaluator.evaluate('${context.settings.enabled} === true', {})).toBe(true);
    });

    it('works with spread operator in object literals', () => {
      context.user = {
        name: 'John',
        age: 30,
      };
      context.settings = {
        enabled: true,
      };

      expect(evaluator.evaluate('{ ...${context.user}, foo: true }', {})).toEqual({
        name: 'John',
        age: 30,
        foo: true,
      });
    });

    it('works with spread operator in array literals', () => {
      context.users = [
        { name: 'John', age: 30 },
        { name: 'Jane', age: 25 },
      ];

      expect(evaluator.evaluate('[ ...${context.users}, "foo" ]', {})).toEqual([
        { name: 'John', age: 30 },
        { name: 'Jane', age: 25 },
        'foo',
      ]);
    });

    it('evaluates references from step results', () => {
      stepResults.set('user', {
        name: 'John',
        age: 30,
      });
      stepResults.set('settings', {
        enabled: true,
      });

      expect(evaluator.evaluate('${user.name}', {})).toBe('John');
      expect(evaluator.evaluate('${user.age} > 25', {})).toBe(true);
      expect(evaluator.evaluate('${settings.enabled}', {})).toBe(true);
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

    it('works with spread operator in arrays', () => {
      context.numbers = [4, 5, 6];
      context.array1 = [1, 2];
      context.array2 = [3, 4];
      context.object = { a: 1, b: 2 };

      // Test spreading array into array
      expect(evaluator.evaluate('[1, 2, ...${context.numbers}, 7]', {})).toEqual([
        1, 2, 4, 5, 6, 7,
      ]);

      // Test spreading multiple arrays
      expect(evaluator.evaluate('[...${context.array1}, ...${context.array2}]', {})).toEqual([
        1, 2, 3, 4,
      ]);

      // Test spreading object values into array
      expect(evaluator.evaluate('[...${context.object}]', {})).toEqual([1, 2]);
    });
  });

  describe('error handling', () => {
    it('throws on invalid expressions', () => {
      expect(() => evaluator.evaluate('', {})).toThrow(ExpressionError);
    });

    it('throws on unknown operators', () => {
      expect(() => evaluator.evaluate('a @ b', {})).toThrow('Failed to evaluate expression: a @ b');
    });

    it('throws on invalid references', () => {
      expect(() => evaluator.evaluate('${nonexistent.property}', {})).toThrow(
        "Reference 'nonexistent' not found. Available references are: context",
      );
    });

    it('throws on null/undefined property access', () => {
      stepResults.set('obj', null);
      expect(() => evaluator.evaluate('${obj.property}', {})).toThrow(
        "Cannot access property 'property' of null",
      );
    });

    it('throws on dangerous patterns', () => {
      expect(() => evaluator.evaluate('${constructor}', {})).toThrow(
        'Expression contains forbidden pattern: constructor',
      );
      expect(() => evaluator.evaluate('${__proto__}', {})).toThrow(
        'Expression contains forbidden pattern: __proto__',
      );
      expect(() => evaluator.evaluate('${prototype}', {})).toThrow(
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
      expect(evaluator.evaluate('10 - 2 * 3', {})).toBe(4);
    });

    it('respects arithmetic operator precedence (with brackets)', () => {
      expect(evaluator.evaluate('(2 + 3) * 4', {})).toBe(20);
    });

    it('respects logical operator precedence', () => {
      expect(evaluator.evaluate('true || false && false', {})).toBe(true);
      expect(evaluator.evaluate('(true || false) && false', {})).toBe(false);
    });
  });

  describe('complex expressions', () => {
    beforeEach(() => {
      stepResults.set('a', 1);
      stepResults.set('b', 2);
      stepResults.set('c', 3);
      stepResults.set('user', {
        profile: {
          settings: {
            notifications: {
              enabled: true,
            },
          },
        },
      });
      stepResults.set('x', 10);
      stepResults.set('y', 20);
      stepResults.set('z', 30);
    });

    it('evaluates nested expressions', () => {
      expect(evaluator.evaluate('(${a} + ${b}) * ${c}', {})).toBe(9);
      expect(evaluator.evaluate('${a} + ${b} * ${c}', {})).toBe(7);
      expect(evaluator.evaluate('(${a} > ${b}) || (${b} < ${c}) && true', {})).toBe(true);
    });

    it('handles deep object references', () => {
      expect(evaluator.evaluate('${user.profile.settings.notifications.enabled}', {})).toBe(true);
    });

    it('combines multiple operators', () => {
      expect(evaluator.evaluate('${x} + ${y} * ${z} / 2', {})).toBe(310);
      expect(evaluator.evaluate('(${x} + ${y}) * (${z} / 2)', {})).toBe(450);
    });
  });

  describe('array access', () => {
    beforeEach(() => {
      stepResults.set('items', [1, 2, 3]);
      stepResults.set('matrix', [
        [1, 2],
        [3, 4],
      ]);
    });

    it('handles array indexing', () => {
      expect(evaluator.evaluate('${items[0]}', {})).toBe(1);
      expect(evaluator.evaluate('${items[2]}', {})).toBe(3);
      expect(evaluator.evaluate('${matrix[0][1]}', {})).toBe(2);
      expect(evaluator.evaluate('${matrix[1][0]}', {})).toBe(3);
    });

    it('handles array methods', () => {
      expect(evaluator.evaluate('${items.length}', {})).toBe(3);
    });

    it('throws on invalid array access', () => {
      expect(() => evaluator.evaluate('${items[3]}', {})).toThrow();
      expect(() => evaluator.evaluate('${items[-1]}', {})).toThrow();
    });
  });

  describe('direct reference resolution', () => {
    beforeEach(() => {
      stepResults.set('items', [1, 2, 3]);
      stepResults.set('user', { id: 42 });
      stepResults.set('data', {
        nested: {
          value: 42,
        },
      });
    });

    it('resolves simple references directly', () => {
      expect(evaluator.evaluate('${items}', {})).toEqual([1, 2, 3]);
      expect(evaluator.evaluate('${user}', {})).toEqual({ id: 42 });
    });

    it('resolves nested references', () => {
      expect(evaluator.evaluate('${data}', {})).toEqual({ nested: { value: 42 } });
      expect(evaluator.evaluate('${data.nested}', {})).toEqual({ value: 42 });
    });
  });
});
