import { TransformExecutor, TransformOperation } from '../transform-executor';
import { ExpressionEvaluator } from '../expression-evaluator';
import { ReferenceResolver } from '../reference-resolver';
import { noLogger } from '../util/logger';

describe('TransformExecutor', () => {
  let executor: TransformExecutor;
  let expressionEvaluator: ExpressionEvaluator;
  let referenceResolver: ReferenceResolver;
  let context: Record<string, any>;
  let stepResults: Map<string, any>;

  beforeEach(() => {
    stepResults = new Map();
    context = {};
    referenceResolver = new ReferenceResolver(stepResults, context, noLogger);
    expressionEvaluator = new ExpressionEvaluator(referenceResolver, context, noLogger);
    executor = new TransformExecutor(expressionEvaluator, referenceResolver, context, noLogger);
  });

  describe('map operation', () => {
    test('maps array using expression', () => {
      const data = [1, 2, 3];
      const operations: TransformOperation[] = [
        {
          type: 'map',
          using: '${item} * 2',
        },
      ];

      const result = executor.execute(operations, data);
      expect(result).toEqual([2, 4, 6]);
    });

    test('maps objects using expression', () => {
      const data = [{ value: 1 }, { value: 2 }];
      const operations: TransformOperation[] = [
        {
          type: 'map',
          using: '${item.value} + 1',
        },
      ];

      const result = executor.execute(operations, data);
      expect(result).toEqual([2, 3]);
    });
  });

  describe('filter operation', () => {
    test('filters array using condition', () => {
      const data = [1, 2, 3, 4];
      const operations: TransformOperation[] = [
        {
          type: 'filter',
          using: '${item} > 2',
        },
      ];

      const result = executor.execute(operations, data);
      expect(result).toEqual([3, 4]);
    });

    test('filters objects using condition', () => {
      const data = [{ value: 1 }, { value: 2 }, { value: 3 }];
      const operations: TransformOperation[] = [
        {
          type: 'filter',
          using: '${item.value} > 1',
        },
      ];

      const result = executor.execute(operations, data);
      expect(result).toEqual([{ value: 2 }, { value: 3 }]);
    });
  });

  describe('reduce operation', () => {
    test('reduces array using expression', () => {
      const data = [1, 2, 3];
      const operations: TransformOperation[] = [
        {
          type: 'reduce',
          using: '${acc} + ${item}',
          initial: 0,
        },
      ];

      const result = executor.execute(operations, data);
      expect(result).toBe(6);
    });

    test('reduces objects using expression', () => {
      const data = [{ value: 1 }, { value: 2 }];
      const operations: TransformOperation[] = [
        {
          type: 'reduce',
          using: '${acc} + ${item.value}',
          initial: 0,
        },
      ];

      const result = executor.execute(operations, data);
      expect(result).toBe(3);
    });

    test('reduces with non-zero initial value', () => {
      const data = [1, 2, 3];
      const operations: TransformOperation[] = [
        {
          type: 'reduce',
          using: '${acc} + ${item}',
          initial: 10,
        },
      ];

      const result = executor.execute(operations, data);
      expect(result).toBe(16); // 10 + 1 + 2 + 3
    });
  });

  describe('flatten operation', () => {
    test('flattens nested arrays', () => {
      const data = [
        [1, 2],
        [3, 4],
      ];
      const operations: TransformOperation[] = [
        {
          type: 'flatten',
          using: '',
        },
      ];

      const result = executor.execute(operations, data);
      expect(result).toEqual([1, 2, 3, 4]);
    });
  });

  describe('sort operation', () => {
    test('sorts array using comparison', () => {
      const data = [3, 1, 4, 2];
      const operations: TransformOperation[] = [
        {
          type: 'sort',
          using: '${a} - ${b}',
        },
      ];

      const result = executor.execute(operations, data);
      expect(result).toEqual([1, 2, 3, 4]);
    });

    test('sorts objects using comparison', () => {
      const data = [{ value: 3 }, { value: 1 }, { value: 2 }];
      const operations: TransformOperation[] = [
        {
          type: 'sort',
          using: '${a.value} - ${b.value}',
        },
      ];

      const result = executor.execute(operations, data);
      expect(result).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
    });
  });

  describe('unique operation', () => {
    test('removes duplicates from array', () => {
      const data = [1, 2, 2, 3, 3, 4];
      const operations: TransformOperation[] = [
        {
          type: 'unique',
          using: '',
        },
      ];

      const result = executor.execute(operations, data);
      expect(result).toEqual([1, 2, 3, 4]);
    });
  });

  describe('group operation', () => {
    test('groups array items by key', () => {
      const data = [
        { type: 'a', value: 1 },
        { type: 'b', value: 2 },
        { type: 'a', value: 3 },
      ];
      const operations: TransformOperation[] = [
        {
          type: 'group',
          using: '${item.type}',
        },
      ];

      const result = executor.execute(operations, data);
      expect(result).toEqual({
        a: [
          { type: 'a', value: 1 },
          { type: 'a', value: 3 },
        ],
        b: [{ type: 'b', value: 2 }],
      });
    });
  });

  describe('join operation', () => {
    test('joins array with separator', () => {
      const data = ['a', 'b', 'c'];
      const operations: TransformOperation[] = [
        {
          type: 'join',
          using: ', ',
        },
      ];

      const result = executor.execute(operations, data);
      expect(result).toBe('a, b, c');
    });
  });

  describe('operation chaining', () => {
    test('chains multiple operations', () => {
      const data = [1, 2, 3, 4];
      const operations: TransformOperation[] = [
        {
          type: 'map',
          using: '${item} * 2',
        },
        {
          type: 'filter',
          using: '${item} > 4',
        },
        {
          type: 'reduce',
          using: '${acc} + ${item}',
          initial: 0,
        },
      ];

      const result = executor.execute(operations, data);
      expect(result).toBe(14); // (2*3 + 2*4) = 6 + 8 = 14
    });
  });

  describe('error handling', () => {
    test('throws on invalid input type', () => {
      const data = 'not an array';
      const operations: TransformOperation[] = [
        {
          type: 'map',
          using: '${item}',
        },
      ];

      expect(() => executor.execute(operations, data)).toThrow(
        'map operation requires array input',
      );
    });

    test('throws on unknown operation type', () => {
      const data = [1, 2, 3];
      const operations: TransformOperation[] = [
        {
          type: 'invalid' as any,
          using: '${item}',
        },
      ];

      expect(() => executor.execute(operations, data)).toThrow('Unknown transform operation type');
    });
  });

  describe('context assignment', () => {
    test('assigns result to context using "as"', () => {
      const data = [1, 2, 3];
      const operations: TransformOperation[] = [
        {
          type: 'map',
          using: '${item} * 2',
          as: 'doubled',
        },
      ];

      executor.execute(operations, data);
      expect(context.doubled).toEqual([2, 4, 6]);
    });
  });
});
