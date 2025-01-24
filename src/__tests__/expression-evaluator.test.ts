import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';
import { ReferenceResolver } from '../reference-resolver';
import { StepType } from '../step-executors/types';
import { TestLogger, noLogger } from '../util/logger';

describe('ExpressionEvaluator', () => {
  let evaluator: SafeExpressionEvaluator;
  let referenceResolver: ReferenceResolver;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let logger: TestLogger;
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
    logger = new TestLogger();

    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.print();
    logger.clear();
  });

  it('evaluates simple boolean expressions', () => {
    expect(evaluator.evaluate('true', {})).toBe(true);
    expect(evaluator.evaluate('false', {})).toBe(false);
  });

  it('evaluates comparison expressions', () => {
    expect(evaluator.evaluate('10 > 5', {})).toBe(true);
    expect(evaluator.evaluate('10 < 5', {})).toBe(false);
  });

  it('evaluates expressions with context', () => {
    expect(evaluator.evaluate('${context.config.threshold} > 50', {})).toBe(true);
    expect(evaluator.evaluate('${context.config.enabled}', {})).toBe(true);
  });

  it('evaluates expressions with references', () => {
    expect(evaluator.evaluate('${step1.data.value} > 40', {})).toBe(true);
    expect(evaluator.evaluate('${step1.data.value} < 40', {})).toBe(false);
  });

  it('evaluates expressions with extra context', () => {
    const extraContext = { item: { value: 75 } };
    expect(evaluator.evaluate('${item.value} > 50', extraContext)).toBe(true);
    expect(evaluator.evaluate('${item.value} < 50', extraContext)).toBe(false);
  });

  it('does not coerces non-boolean values to boolean', () => {
    expect(evaluator.evaluate('1', {})).toBe(1);
    expect(evaluator.evaluate('0', {})).toBe(0);
    expect(evaluator.evaluate('""', {})).toBe('');
    expect(evaluator.evaluate('"text"', {})).toBe('text');
  });

  it('evaluates arithmetic expressions', () => {
    expect(evaluator.evaluate('2 + 2', {})).toBe(4);
    expect(evaluator.evaluate('10 * 5', {})).toBe(50);
  });

  it('evaluates string expressions', () => {
    expect(evaluator.evaluate('"Hello" + " " + "World"', {})).toBe('Hello World');
  });

  it('evaluates object literals', () => {
    expect(evaluator.evaluate('{ x: 1, y: 2 }', {})).toEqual({ x: 1, y: 2 });
  });

  it('evaluates expressions with references', () => {
    expect(evaluator.evaluate('${step1.data.value} * 2', {})).toBe(84);
  });

  it('evaluates expressions with template literals', () => {
    expect(evaluator.evaluate('Value is ${step1.data.value}', {})).toBe('Value is 42');
    expect(
      evaluator.evaluate('Value ${step1.data.value} with nested ${step1.data.nested.prop}', {}),
    ).toBe('Value 42 with nested test');
  });

  it('evaluates expressions with context', () => {
    expect(evaluator.evaluate('${context.config.threshold} + 50', {})).toBe(150);
  });

  it('evaluates expressions with extra context', () => {
    const extraContext = { item: { value: 75 } };
    expect(evaluator.evaluate('${item.value} * 2', extraContext)).toBe(150);
  });

  it('evaluates complex object literals with references', () => {
    const result = evaluator.evaluate(
      '{ id: ${step1.data.value}, config: ${context.config.threshold} }',
      {},
    );
    expect(result).toStrictEqual({ id: 42, config: 100 });
  });

  it('throws on invalid expressions', () => {
    expect(() => evaluator.evaluate('2 <> 3', {})).toThrow('Failed to evaluate expression: 2 <> 3');
  });

  it('throws on undefined references', () => {
    expect(() => evaluator.evaluate('${nonexistent.value}', {})).toThrow(
      "Reference 'nonexistent' not found. Available references are: step1, context",
    );
  });

  it('resolves simple references directly', () => {
    const items = [1, 2, 3];
    stepResults.set('items', items);
    expect(evaluator.evaluate('${items}', {})).toBe(items);

    const extraContext = { item: { id: 42 } };
    expect(evaluator.evaluate('${item.id}', extraContext)).toBe(42);
  });

  describe('wrapped step results', () => {
    let wrappedResult: any;

    beforeEach(() => {
      wrappedResult = {
        result: { name: 'Alice', age: 30 },
        type: StepType.Request,
        metadata: { requestId: '123' },
      };
      referenceResolver = new ReferenceResolver(
        new Map([['userInfo', wrappedResult]]),
        {},
        noLogger,
      );
      evaluator = new SafeExpressionEvaluator(noLogger, referenceResolver);
    });

    it('should require explicit .result access for wrapped step results', () => {
      // Must explicitly access .result
      expect(evaluator.evaluate('${userInfo.result.name}', {})).toBe('Alice');
      expect(evaluator.evaluate('${userInfo.result.age}', {})).toBe(30);

      // Can access other properties of the wrapper
      expect(evaluator.evaluate('${userInfo.type}', {})).toBe('request');
      expect(evaluator.evaluate('${userInfo.metadata.requestId}', {})).toBe('123');
    });

    it('should not allow direct property access that skips result', () => {
      // Direct property access should fail
      expect(() => evaluator.evaluate('${userInfo.name}', {})).toThrow('Cannot access property');
      expect(() => evaluator.evaluate('${userInfo.age}', {})).toThrow('Cannot access property');
    });

    it('should not allow accessing result properties through array notation', () => {
      expect(() => evaluator.evaluate('${userInfo["name"]}', {})).toThrow('Cannot access property');
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
      evaluator = new SafeExpressionEvaluator(noLogger, referenceResolver);

      // Must use .result at each level
      expect(evaluator.evaluate('${nested.result.user.result.name}', {})).toBe('Bob');

      // Skipping any .result should fail
      expect(() => evaluator.evaluate('${nested.user.result.name}', {})).toThrow(
        'Cannot access property',
      );
      expect(() => evaluator.evaluate('${nested.result.user.name}', {})).toThrow(
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
      evaluator = new SafeExpressionEvaluator(noLogger, referenceResolver);

      // Must use .result to access array
      expect(evaluator.evaluate('${users.result.length}', {})).toBe(2);

      // Accessing array elements should require .result
      expect(() => evaluator.evaluate('${users[0].name}', {})).toThrow();
    });

    it('should support both dot and array notation for accessing properties', () => {
      // Both notations should work for accessing result
      expect(evaluator.evaluate('${userInfo.result.name}', {})).toBe('Alice');
      expect(evaluator.evaluate('${userInfo["result"]["name"]}', {})).toBe('Alice');
      expect(evaluator.evaluate('${userInfo["result"].name}', {})).toBe('Alice');
      expect(evaluator.evaluate('${userInfo.result["name"]}', {})).toBe('Alice');

      // Both notations should work for metadata
      expect(evaluator.evaluate('${userInfo.metadata.requestId}', {})).toBe('123');
      expect(evaluator.evaluate('${userInfo["metadata"]["requestId"]}', {})).toBe('123');

      // Both notations should fail when trying to skip result
      expect(() => evaluator.evaluate('${userInfo.name}', {})).toThrow('Cannot access property');
      expect(() => evaluator.evaluate('${userInfo["name"]}', {})).toThrow('Cannot access property');
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
      evaluator = new SafeExpressionEvaluator(noLogger, referenceResolver);

      // Both notations should work for accessing array elements
      expect(evaluator.evaluate('${users.result[0].result.name}', {})).toBe('Alice');
      expect(evaluator.evaluate('${users["result"][0]["result"]["name"]}', {})).toBe('Alice');
      expect(evaluator.evaluate('${users.result[1].result.name}', {})).toBe('Bob');
      expect(evaluator.evaluate('${users["result"][1]["result"]["name"]}', {})).toBe('Bob');

      // Both notations should fail when trying to skip result
      expect(() => evaluator.evaluate('${users[0].name}', {})).toThrow('Cannot access property');
      expect(() => evaluator.evaluate('${users["result"][0].name}', {})).toThrow(
        'Cannot access property',
      );
    });

    describe('array notation', () => {
      let complexResult: any;
      beforeEach(() => {
        complexResult = {
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

        referenceResolver = new ReferenceResolver(
          new Map([['complex', complexResult]]),
          {},
          noLogger,
        );
        evaluator = new SafeExpressionEvaluator(noLogger, referenceResolver);
      });

      it('special characters in keys require array notation', () => {
        // Special characters in keys require array notation
        expect(evaluator.evaluate('${complex.result["special.key"]}', {})).toBe('special value');
        expect(evaluator.evaluate('${complex.result["key-with-dash"]}', {})).toBe('dash value');
      });

      it('numeric keys require array notation', () => {
        // Numeric keys
        expect(evaluator.evaluate('${complex.result["0"]}', {})).toBe('zero');
      });

      it('empty and space keys require array notation', () => {
        // Empty and space keys
        expect(evaluator.evaluate('${complex.result[""]}', {})).toBe('empty');
        expect(evaluator.evaluate('${complex.result[" "]}', {})).toBe('space');
      });

      it('array access', () => {
        // Array access
        expect(evaluator.evaluate('${complex.result.array[0]}', {})).toBe('a');
        expect(evaluator.evaluate('${complex.result["array"][1]}', {})).toBe('b');
      });

      it('special characters in keys require array notation', () => {
        // These should fail
        expect(() => evaluator.evaluate('${complex.result.special.key}', {})).toThrow(); // Can't use dot notation with special characters
        expect(() => evaluator.evaluate('${complex.result.0}', {})).toThrow; // Can't use dot notation with numeric keys
      });
    });

    describe('array notation with expressions', () => {
      let arrayResult: any;
      beforeEach(() => {
        arrayResult = {
          result: ['a', 'b', 'c'],
          indices: [0, 1, 2],
          type: StepType.Request,
        };
        referenceResolver = new ReferenceResolver(new Map([['arr', arrayResult]]), {}, noLogger);
        evaluator = new SafeExpressionEvaluator(noLogger, referenceResolver);
      });

      it('dynamic array access using expressions', () => {
        // Dynamic array access using expressions
        expect(evaluator.evaluate('${arr.result[arr.indices[0]]}', {})).toBe('a');
        expect(evaluator.evaluate('${arr.result[arr.indices[1]]}', {})).toBe('b');
      });

      xit('expression in array index', () => {
        // Expression in array index
        expect(evaluator.evaluate('${arr.result[0 + 1]}', {})).toBe('b');
        expect(evaluator.evaluate('${arr.result[2 - 1]}', {})).toBe('b');
      });

      it('invalid index', () => {
        // These should fail
        expect(() => evaluator.evaluate('${arr.result[-1]}', {})).toThrow(); // Invalid index
        expect(() => evaluator.evaluate('${arr.result[3]}', {})).toThrow(); // Out of bounds
      });
    });

    describe('deeply nested array and object access', () => {
      let deepResult: any;
      beforeEach(() => {
        deepResult = {
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
        evaluator = new SafeExpressionEvaluator(noLogger, referenceResolver);
      });

      it('deep access with mixed notation', () => {
        expect(
          evaluator.evaluate('${deep.result.users[0].result.friends[0].result.name}', {}),
        ).toBe('Charlie');

        expect(
          evaluator.evaluate(
            '${deep["result"]["users"][0]["result"]["friends"][1]["result"]["name"]}',
            {},
          ),
        ).toBe('David');
      });

      it('invalid array access', () => {
        // These should fail
        expect(() => evaluator.evaluate('${deep.result.users[0].friends[0].name}', {})).toThrow(); // Missing .result
        expect(() =>
          evaluator.evaluate('${deep.result.users.0.result.friends.0.result.name}', {}),
        ).toThrow(); // Invalid array access with dot notation
      });
    });

    describe('array notation with string expressions', () => {
      let result: any;
      beforeEach(() => {
        result = {
          result: { a: 1, b: 2, c: 3 },
          keys: ['a', 'b', 'c'],
          type: StepType.Request,
        };
        referenceResolver = new ReferenceResolver(new Map([['data', result]]), {}, noLogger);
        evaluator = new SafeExpressionEvaluator(noLogger, referenceResolver);
      });

      it('dynamic property access using string expressions', () => {
        expect(evaluator.evaluate('${data.result[data.keys[0]]}', {})).toBe(1);
        expect(evaluator.evaluate('${data.result[data.keys[1]]}', {})).toBe(2);
      });

      xit('string concatenation in property access', () => {
        expect(evaluator.evaluate('${data.result["" + data.keys[2]]}', {})).toBe(3);
      });

      it('invalid property access', () => {
        // These should fail
        expect(() => evaluator.evaluate('${data.result[keys[0]]}', {})).toThrow(); // Undefined variable
        expect(() => evaluator.evaluate('${data.result[undefined]}', {})).toThrow(); // Invalid property
      });
    });

    it('correctly handles expressions with multiple references', () => {
      const extraContext = { foo: 5, bar: 3 };

      // This should be treated as a comparison expression, not a single reference
      expect(evaluator.evaluate('${foo} > ${bar}', extraContext)).toBe(true);
      expect(evaluator.evaluate('${foo} + ${bar}', extraContext)).toBe(8);

      // These should also work with object properties
      const objContext = { a: { value: 10 }, b: { value: 7 } };
      expect(evaluator.evaluate('${a.value} > ${b.value}', objContext)).toBe(true);
      expect(evaluator.evaluate('${a.value} + ${b.value}', objContext)).toBe(17);
    });

    // This test shows what should NOT happen
    it('should not treat expressions with multiple references as a single reference', () => {
      const extraContext = { foo: 5, bar: 3 };

      // This should throw because it's trying to resolve "foo} > ${bar" as a single path
      expect(() => evaluator.evaluate('${foo} > ${bar}', extraContext)).not.toThrow(
        'Failed to resolve reference: foo} > ${bar',
      );
    });
  });
});
