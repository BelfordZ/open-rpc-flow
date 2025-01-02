import { ExpressionEvaluator } from '../expression-evaluator';
import { ReferenceResolver } from '../reference-resolver';
import { StepType } from '../step-executors/types';
import { noLogger } from '../util/logger';

describe('ExpressionEvaluator', () => {
  let evaluator: ExpressionEvaluator;
  let referenceResolver: ReferenceResolver;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;

  beforeEach(() => {
    stepResults = new Map();
    stepResults.set('step1', {
      data: {
        value: 42,
        nested: { prop: 'test' },
      },
    });

    context = {
      config: {
        threshold: 100,
        enabled: true,
      },
    };

    referenceResolver = new ReferenceResolver(stepResults, context, noLogger);
    evaluator = new ExpressionEvaluator(referenceResolver, context, noLogger);
  });

  describe('evaluateCondition', () => {
    test('evaluates simple boolean expressions', () => {
      expect(evaluator.evaluateCondition('true')).toBe(true);
      expect(evaluator.evaluateCondition('false')).toBe(false);
    });

    test('evaluates comparison expressions', () => {
      expect(evaluator.evaluateCondition('10 > 5')).toBe(true);
      expect(evaluator.evaluateCondition('10 < 5')).toBe(false);
    });

    test('evaluates expressions with context', () => {
      expect(evaluator.evaluateCondition('${context.config.threshold} > 50')).toBe(true);
      expect(evaluator.evaluateCondition('${context.config.enabled}')).toBe(true);
    });

    test('evaluates expressions with references', () => {
      expect(evaluator.evaluateCondition('${step1.data.value} > 40')).toBe(true);
      expect(evaluator.evaluateCondition('${step1.data.value} < 40')).toBe(false);
    });

    test('evaluates expressions with extra context', () => {
      const extraContext = { item: { value: 75 } };
      expect(evaluator.evaluateCondition('${item.value} > 50', extraContext)).toBe(true);
      expect(evaluator.evaluateCondition('${item.value} < 50', extraContext)).toBe(false);
    });

    test('coerces non-boolean values to boolean', () => {
      expect(evaluator.evaluateCondition('1')).toBe(true);
      expect(evaluator.evaluateCondition('0')).toBe(false);
      expect(evaluator.evaluateCondition('""')).toBe(false);
      expect(evaluator.evaluateCondition('"text"')).toBe(true);
    });
  });

  describe('evaluateExpression', () => {
    it('evaluates arithmetic expressions', () => {
      expect(evaluator.evaluateExpression('2 + 2')).toBe(4);
      expect(evaluator.evaluateExpression('10 * 5')).toBe(50);
    });

    it('evaluates string expressions', () => {
      expect(evaluator.evaluateExpression('"Hello" + " " + "World"')).toBe('Hello World');
    });

    it('evaluates object literals', () => {
      expect(evaluator.evaluateExpression('{ x: 1, y: 2 }')).toEqual({ x: 1, y: 2 });
    });

    test('evaluates expressions with references', () => {
      expect(evaluator.evaluateExpression('${step1.data.value} * 2')).toBe(84);
      expect(evaluator.evaluateExpression('`Value is ${step1.data.value}`')).toBe('Value is 42');
    });

    test('evaluates expressions with context', () => {
      expect(evaluator.evaluateExpression('${context.config.threshold} + 50')).toBe(150);
    });

    test('evaluates expressions with extra context', () => {
      const extraContext = { item: { value: 75 } };
      expect(evaluator.evaluateExpression('${item.value} * 2', extraContext)).toBe(150);
    });

    test('evaluates complex object literals with references', () => {
      const result = evaluator.evaluateExpression(
        '{ id: ${step1.data.value}, config: ${context.config.threshold} }',
      );
      expect(result).toEqual({ id: 42, config: 100 });
    });

    test('throws on invalid expressions', () => {
      expect(() => evaluator.evaluateExpression('invalid syntax')).toThrow(
        'Failed to evaluate expression',
      );
    });

    it('throws on undefined references', () => {
      expect(() => evaluator.evaluateExpression('${nonexistent.value}')).toThrow(
        "Reference 'nonexistent' not found. Available references are: step1, context",
      );
    });

    test('resolves simple references directly', () => {
      const items = [1, 2, 3];
      stepResults.set('items', items);
      expect(evaluator.evaluateExpression('${items}')).toBe(items);

      const extraContext = { item: { id: 42 } };
      expect(evaluator.evaluateExpression('${item.id}', extraContext)).toBe(42);
    });

    describe('wrapped step results', () => {
      let wrappedResult: any;

      beforeEach(() => {
        wrappedResult = {
          result: { name: 'Alice', age: 30 },
          type: StepType.Request,
          metadata: { requestId: '123' },
        };
        referenceResolver = new ReferenceResolver(new Map([['userInfo', wrappedResult]]), {}, noLogger);
        evaluator = new ExpressionEvaluator(referenceResolver, context, noLogger);
      });

      it('should require explicit .result access for wrapped step results', () => {
        // Must explicitly access .result
        expect(evaluator.evaluateExpression('${userInfo.result.name}', {})).toBe('Alice');
        expect(evaluator.evaluateExpression('${userInfo.result.age}', {})).toBe(30);

        // Can access other properties of the wrapper
        expect(evaluator.evaluateExpression('${userInfo.type}', {})).toBe('request');
        expect(evaluator.evaluateExpression('${userInfo.metadata.requestId}', {})).toBe('123');
      });

      it('should not allow direct property access that skips result', () => {
        // Direct property access should fail
        expect(() => evaluator.evaluateExpression('${userInfo.name}', {})).toThrow(
          'Cannot access property',
        );
        expect(() => evaluator.evaluateExpression('${userInfo.age}', {})).toThrow(
          'Cannot access property',
        );
      });

      it('should not allow accessing result properties through array notation', () => {
        expect(() => evaluator.evaluateExpression('${userInfo["name"]}', {})).toThrow(
          'Cannot access property',
        );
      });

      it('should handle nested step results correctly', () => {
        const nestedResult = {
          result: {
            user: {
              result: { name: 'Bob' },
              type: StepType.Request,
            },
          },
          type: StepType.Transform,
        };
        referenceResolver = new ReferenceResolver(new Map([['nested', nestedResult]]), {}, noLogger);
        evaluator = new ExpressionEvaluator(referenceResolver, context, noLogger);

        // Must use .result at each level
        expect(evaluator.evaluateExpression('${nested.result.user.result.name}', {})).toBe('Bob');

        // Skipping any .result should fail
        expect(() => evaluator.evaluateExpression('${nested.user.result.name}', {})).toThrow(
          'Cannot access property',
        );
        expect(() => evaluator.evaluateExpression('${nested.result.user.name}', {})).toThrow(
          'Cannot access property',
        );
      });

      it('should handle array results correctly', () => {
        const arrayResult = {
          result: [
            { result: { name: 'Alice' }, type: StepType.Request },
            { result: { name: 'Bob' }, type: StepType.Request },
          ],
          type: StepType.Transform,
        };
        referenceResolver = new ReferenceResolver(new Map([['users', arrayResult]]), {}, noLogger);
        evaluator = new ExpressionEvaluator(referenceResolver, context, noLogger);

        // Must use .result to access array
        expect(evaluator.evaluateExpression('${users.result.length}', {})).toBe(2);

        // Accessing array elements should require .result
        expect(() => evaluator.evaluateExpression('${users[0].name}', {})).toThrow();
      });

      it('should support both dot and array notation for accessing properties', () => {
        // Both notations should work for accessing result
        expect(evaluator.evaluateExpression('${userInfo.result.name}', {})).toBe('Alice');
        expect(evaluator.evaluateExpression('${userInfo["result"]["name"]}', {})).toBe('Alice');
        expect(evaluator.evaluateExpression('${userInfo["result"].name}', {})).toBe('Alice');
        expect(evaluator.evaluateExpression('${userInfo.result["name"]}', {})).toBe('Alice');

        // Both notations should work for metadata
        expect(evaluator.evaluateExpression('${userInfo.metadata.requestId}', {})).toBe('123');
        expect(evaluator.evaluateExpression('${userInfo["metadata"]["requestId"]}', {})).toBe(
          '123',
        );

        // Both notations should fail when trying to skip result
        expect(() => evaluator.evaluateExpression('${userInfo.name}', {})).toThrow(
          'Cannot access property',
        );
        expect(() => evaluator.evaluateExpression('${userInfo["name"]}', {})).toThrow(
          'Cannot access property',
        );
      });

      it('should handle array results with both notations', () => {
        const arrayResult = {
          result: [
            { result: { name: 'Alice' }, type: StepType.Request },
            { result: { name: 'Bob' }, type: StepType.Request },
          ],
          type: StepType.Transform,
        };
        referenceResolver = new ReferenceResolver(new Map([['users', arrayResult]]), {}, noLogger);
        evaluator = new ExpressionEvaluator(referenceResolver, context, noLogger);

        // Both notations should work for accessing array elements
        expect(evaluator.evaluateExpression('${users.result[0].result.name}', {})).toBe('Alice');
        expect(evaluator.evaluateExpression('${users["result"][0]["result"]["name"]}', {})).toBe(
          'Alice',
        );
        expect(evaluator.evaluateExpression('${users.result[1].result.name}', {})).toBe('Bob');
        expect(evaluator.evaluateExpression('${users["result"][1]["result"]["name"]}', {})).toBe(
          'Bob',
        );

        // Both notations should fail when trying to skip result
        expect(() => evaluator.evaluateExpression('${users[0].name}', {})).toThrow(
          'Cannot access property',
        );
        expect(() => evaluator.evaluateExpression('${users["result"][0].name}', {})).toThrow(
          'Cannot access property',
        );
      });

      it('should handle array notation edge cases', () => {
        const complexResult = {
          result: {
            'special.key': 'special value',
            'key-with-dash': 'dash value',
            array: ['a', 'b', 'c'],
            '0': 'zero',
            '': 'empty',
            ' ': 'space',
          },
          type: StepType.Request,
        };
        referenceResolver = new ReferenceResolver(new Map([['complex', complexResult]]), {}, noLogger);
        evaluator = new ExpressionEvaluator(referenceResolver, context, noLogger);

        // Special characters in keys require array notation
        expect(evaluator.evaluateExpression('${complex.result["special.key"]}', {})).toBe(
          'special value',
        );
        expect(evaluator.evaluateExpression('${complex.result["key-with-dash"]}', {})).toBe(
          'dash value',
        );

        // Numeric keys
        expect(evaluator.evaluateExpression('${complex.result["0"]}', {})).toBe('zero');

        // Empty and space keys
        expect(evaluator.evaluateExpression('${complex.result[""]}', {})).toBe('empty');
        expect(evaluator.evaluateExpression('${complex.result[" "]}', {})).toBe('space');

        // Array access
        expect(evaluator.evaluateExpression('${complex.result.array[0]}', {})).toBe('a');
        expect(evaluator.evaluateExpression('${complex.result["array"][1]}', {})).toBe('b');

        // These should fail
        expect(() => evaluator.evaluateExpression('${complex.result.special.key}', {})).toThrow(); // Can't use dot notation with special characters
        expect(() => evaluator.evaluateExpression('${complex.result.0}', {})).toThrow(); // Can't use dot notation with numeric keys
      });

      it('should handle array notation with expressions', () => {
        const arrayResult = {
          result: ['a', 'b', 'c'],
          indices: [0, 1, 2],
          type: StepType.Request,
        };
        referenceResolver = new ReferenceResolver(new Map([['arr', arrayResult]]), {}, noLogger);
        evaluator = new ExpressionEvaluator(referenceResolver, context, noLogger);

        // Dynamic array access using expressions
        expect(evaluator.evaluateExpression('${arr.result[arr.indices[0]]}', {})).toBe('a');
        expect(evaluator.evaluateExpression('${arr.result[arr.indices[1]]}', {})).toBe('b');

        // Expression in array index
        expect(evaluator.evaluateExpression('${arr.result[0 + 1]}', {})).toBe('b');
        expect(evaluator.evaluateExpression('${arr.result[2 - 1]}', {})).toBe('b');

        // These should fail
        expect(() => evaluator.evaluateExpression('${arr.result[-1]}', {})).toThrow(); // Invalid index
        expect(() => evaluator.evaluateExpression('${arr.result[3]}', {})).toThrow(); // Out of bounds
      });

      it('should handle deeply nested array and object access', () => {
        const deepResult = {
          result: {
            users: [
              {
                result: {
                  friends: [
                    { result: { name: 'Charlie' }, type: StepType.Request },
                    { result: { name: 'David' }, type: StepType.Request },
                  ],
                },
                type: StepType.Request,
              },
            ],
          },
          type: StepType.Request,
        };
        referenceResolver = new ReferenceResolver(new Map([['deep', deepResult]]), {}, noLogger);
        evaluator = new ExpressionEvaluator(referenceResolver, context, noLogger);

        // Deep access with mixed notation
        expect(
          evaluator.evaluateExpression('${deep.result.users[0].result.friends[0].result.name}', {}),
        ).toBe('Charlie');
        expect(
          evaluator.evaluateExpression(
            '${deep["result"]["users"][0]["result"]["friends"][1]["result"]["name"]}',
            {},
          ),
        ).toBe('David');

        // These should fail
        expect(() =>
          evaluator.evaluateExpression('${deep.result.users[0].friends[0].name}', {}),
        ).toThrow(); // Missing .result
        expect(() =>
          evaluator.evaluateExpression('${deep.result.users.0.result.friends.0.result.name}', {}),
        ).toThrow(); // Invalid array access with dot notation
      });

      it('should handle array notation with string expressions', () => {
        const result = {
          result: { a: 1, b: 2, c: 3 },
          keys: ['a', 'b', 'c'],
          type: StepType.Request,
        };
        referenceResolver = new ReferenceResolver(new Map([['data', result]]), {}, noLogger);
        evaluator = new ExpressionEvaluator(referenceResolver, context, noLogger);

        // Dynamic property access using string expressions
        expect(evaluator.evaluateExpression('${data.result[data.keys[0]]}', {})).toBe(1);
        expect(evaluator.evaluateExpression('${data.result[`${data.keys[1]}`]}', {})).toBe(2);

        // String concatenation in property access
        expect(evaluator.evaluateExpression('${data.result["" + data.keys[2]]}', {})).toBe(3);

        // These should fail
        expect(() => evaluator.evaluateExpression('${data.result[keys[0]]}', {})).toThrow(); // Undefined variable
        expect(() => evaluator.evaluateExpression('${data.result[undefined]}', {})).toThrow(); // Invalid property
      });

      it('correctly handles expressions with multiple references', () => {
        const extraContext = { foo: 5, bar: 3 };

        // This should be treated as a comparison expression, not a single reference
        expect(evaluator.evaluateExpression('${foo} > ${bar}', extraContext)).toBe(true);
        expect(evaluator.evaluateExpression('${foo} + ${bar}', extraContext)).toBe(8);

        // These should also work with object properties
        const objContext = { a: { value: 10 }, b: { value: 7 } };
        expect(evaluator.evaluateExpression('${a.value} > ${b.value}', objContext)).toBe(true);
        expect(evaluator.evaluateExpression('${a.value} + ${b.value}', objContext)).toBe(17);
      });

      // This test shows what should NOT happen
      it('should not treat expressions with multiple references as a single reference', () => {
        const extraContext = { foo: 5, bar: 3 };

        // This should throw because it's trying to resolve "foo} > ${bar" as a single path
        expect(() => evaluator.evaluateExpression('${foo} > ${bar}', extraContext)).not.toThrow(
          'Failed to resolve reference: foo} > ${bar',
        );
      });
    });
  });
});
