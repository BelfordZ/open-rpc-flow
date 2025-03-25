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
    //logger.print();
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
      // Test empty expression
      expect(() => evaluator.evaluate('', {})).toThrow(ExpressionError);

      // Test malformed template literals
      expect(() => evaluator.evaluate('${', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('${incomplete', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('${}', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('${a', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('${a.b', {})).toThrow(ExpressionError);

      // Test invalid operator usage
      expect(() => evaluator.evaluate('++', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('1 ++ 2', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('1 + + 2', {})).toThrow(ExpressionError);
    });

    it('throws on unknown operators', () => {
      expect(() => evaluator.evaluate('a @ b', {})).toThrow('Unexpected identifier');
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
      stepResults.set('primitive', 42);
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

    it('throws on invalid spread operator usage', () => {
      const errorPrefix =
        'Failed to evaluate expression: [1, 2, ...${primitive}]. Got error: Invalid spread operator usage:';
      // Test spreading primitive values
      stepResults.set('primitive', 42);
      const expression = '[1, 2, ...${primitive}]';
      expect(() => evaluator.evaluate(expression, {})).toThrow(
        `${errorPrefix} can only spread arrays or objects`,
      );

      // Test spreading string literals
      stepResults.set('primitive', 'foo');
      const expression2 = '[1, 2, ...${primitive}]';
      expect(() => evaluator.evaluate(expression2, {})).toThrow(
        `${errorPrefix} can only spread arrays or objects`,
      );

      // Test spreading boolean literals
      stepResults.set('primitive', true);
      const expression3 = '[1, 2, ...${primitive}]';
      expect(() => evaluator.evaluate(expression3, {})).toThrow(
        `${errorPrefix} can only spread arrays or objects`,
      );

      // Test spreading null/undefined
      stepResults.set('primitive', null);
      const expression4 = '[1, 2, ...${primitive}]';
      expect(() => evaluator.evaluate(expression4, {})).toThrow(
        `${errorPrefix} can only spread arrays or objects`,
      );

      stepResults.set('primitive', undefined);
      const expression5 = '[1, 2, ...${primitive}]';
      expect(() => evaluator.evaluate(expression5, {})).toThrow(
        `${errorPrefix} can only spread arrays or objects`,
      );
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

  describe('operator error handling', () => {
    it('throws ExpressionError when operator evaluation fails', () => {
      // Test division by zero
      expect(() => evaluator.evaluate('1 / 0', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('1 / 0', {})).toThrow('Division/modulo by zero');

      // Test invalid operand types
      expect(() => evaluator.evaluate('"hello" * 2', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('"hello" * 2', {})).toThrow(
        'Failed to evaluate expression: "hello" * 2. Got error: Cannot perform * on non-numeric values: hello * 2',
      );

      // Test undefined operands
      expect(() => evaluator.evaluate('undefined + 1', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('undefined + 1', {})).toThrow(
        'Failed to evaluate expression: undefined + 1. Got error: Cannot perform + on non-numeric values: undefined + 1',
      );
    });
  });

  describe('expression validation', () => {
    it('identifies expressions with operators', () => {
      // Test arithmetic operators
      expect(() => evaluator.evaluate('1 + 2', {})).not.toThrow();
      expect(() => evaluator.evaluate('3 * 4', {})).not.toThrow();
      expect(() => evaluator.evaluate('5 / 2', {})).not.toThrow();

      // Test comparison operators
      expect(() => evaluator.evaluate('1 < 2', {})).not.toThrow();
      expect(() => evaluator.evaluate('3 > 2', {})).not.toThrow();
      expect(() => evaluator.evaluate('2 <= 2', {})).not.toThrow();
      expect(() => evaluator.evaluate('3 >= 3', {})).not.toThrow();

      // Test logical operators
      expect(() => evaluator.evaluate('true && false', {})).not.toThrow();
      expect(() => evaluator.evaluate('true || false', {})).not.toThrow();
    });

    it('identifies simple references as expressions', () => {
      expect(() => evaluator.evaluate('${x}', { x: 1 })).not.toThrow();
      expect(() => evaluator.evaluate('${user.name}', { user: { name: 'John' } })).not.toThrow();
    });

    it('handles invalid expressions', () => {
      // Test empty expression
      expect(() => evaluator.evaluate('', {})).toThrow(ExpressionError);

      // Test malformed template literals
      expect(() => evaluator.evaluate('${', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('${incomplete', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('${}', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('${a', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('${a.b', {})).toThrow(ExpressionError);

      // Test invalid operator usage
      expect(() => evaluator.evaluate('++', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('1 ++ 2', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('1 + + 2', {})).toThrow(ExpressionError);
    });
  });

  describe('AST error handling', () => {
    it('throws error for unknown AST node type', () => {
      // Create an AST node with an unknown type
      const ast = { type: 'unknown' };
      expect(() => (evaluator as any).evaluateAst(ast, {}, Date.now())).toThrow(
        'Unknown AST node type: unknown',
      );
    });

    it('throws error for object node missing properties', () => {
      // Create an object AST node without properties
      const ast = { type: 'object' };
      expect(() => (evaluator as any).evaluateAst(ast, {}, Date.now())).toThrow(
        'Internal error: Object node missing properties',
      );
    });

    it('throws error for array node missing elements', () => {
      // Create an array AST node without elements
      const ast = { type: 'array' };
      expect(() => (evaluator as any).evaluateAst(ast, {}, Date.now())).toThrow(
        'Internal error: Array node missing elements',
      );
    });
  });

  describe('extractReferences', () => {
    beforeEach(() => {
      stepResults = new Map();
      context = {};
      referenceResolver = new ReferenceResolver(stepResults, context, logger);
      evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
    });

    it('extracts simple references', () => {
      const refs = evaluator.extractReferences('${step1} + ${step2}');
      expect(refs).toEqual(['step1', 'step2']);
    });

    it('extracts references from array indices', () => {
      const refs = evaluator.extractReferences('${step1.value[${step2.value}]}');
      expect(refs).toEqual(['step1', 'step2']);
    });

    it('extracts references from nested expressions', () => {
      const refs = evaluator.extractReferences(
        '${step1.data[${step2.index}].items[${step3.value}]}',
      );
      expect(refs).toEqual(['step1', 'step2', 'step3']);
    });

    it('ignores special variables', () => {
      const refs = evaluator.extractReferences('${item.value} + ${context.data} + ${acc.total}');
      expect(refs).toEqual([]);
    });

    it('extracts references from object literals', () => {
      const refs = evaluator.extractReferences('{ value: ${step1}, nested: { data: ${step2} } }');
      expect(refs).toEqual(['step1', 'step2']);
    });

    it('extracts references from array literals', () => {
      const refs = evaluator.extractReferences('[${step1}, { value: ${step2} }, ${step3}]');
      expect(refs).toEqual(['step1', 'step2', 'step3']);
    });

    it('extracts references from complex expressions', () => {
      const refs = evaluator.extractReferences(
        '${step1.value[${step2}]} * ${step3} + ${step4.data[${step5.index}]}',
      );
      expect(refs).toEqual(['step1', 'step2', 'step3', 'step4', 'step5']);
    });

    it('handles expressions with no references', () => {
      const refs = evaluator.extractReferences('1 + 2 * 3');
      expect(refs).toEqual([]);
    });

    it('handles invalid expressions gracefully', () => {
      const refs = evaluator.extractReferences('${incomplete + ${invalid}');
      expect(refs).toEqual([]);
    });

    it('extracts references from spread operators', () => {
      const refs = evaluator.extractReferences(
        '{ ...${step1}, value: ${step2}, items: [...${step3}] }',
      );
      expect(refs).toEqual(['step1', 'step2', 'step3']);
    });
  });
});
