import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError as _ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

/**
 * This is a consolidated test file for array-related tests in the SafeExpressionEvaluator.
 * It combines tests from:
 * - safe-evaluator-array-elements.test.ts
 * - safe-evaluator-array-case-coverage.test.ts
 */
describe('SafeExpressionEvaluator - Array Tests', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  let logger: TestLogger;

  beforeEach(() => {
    stepResults = new Map();
    context = {
      arr: [1, 2, 3, 4, 5],
      nestedArr: [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
      mixedArr: [1, 'hello', true, null, undefined, { key: 'value' }],
      objArr: [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ],
      emptyArr: [],
      idx: 2,
    };
    logger = new TestLogger('SafeEvaluatorArrayTest');
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  describe('Array Literal Creation', () => {
    it('should create and evaluate empty arrays', () => {
      expect(evaluator.evaluate('[]', {})).toEqual([]);
    });

    it('should create and evaluate arrays with simple values', () => {
      expect(evaluator.evaluate('[1, 2, 3]', {})).toEqual([1, 2, 3]);
      expect(evaluator.evaluate('["a", "b", "c"]', {})).toEqual(['a', 'b', 'c']);
      expect(evaluator.evaluate('[true, false, true]', {})).toEqual([true, false, true]);
    });

    it('should create and evaluate arrays with mixed values', () => {
      expect(evaluator.evaluate('[1, "two", true, null]', {})).toEqual([1, 'two', true, null]);
    });

    it('should create and evaluate nested arrays', () => {
      expect(evaluator.evaluate('[[1, 2], [3, 4]]', {})).toEqual([
        [1, 2],
        [3, 4],
      ]);
      expect(evaluator.evaluate('[1, [2, 3], 4]', {})).toEqual([1, [2, 3], 4]);
    });
  });

  describe('Array References', () => {
    it('should correctly reference array elements directly', () => {
      expect(evaluator.evaluate('${context.arr[0]}', {})).toBe(1);
      expect(evaluator.evaluate('${context.arr[2]}', {})).toBe(3);
      expect(evaluator.evaluate('${context.arr[4]}', {})).toBe(5);
    });

    it('should correctly reference nested array elements', () => {
      expect(evaluator.evaluate('${context.nestedArr[0][0]}', {})).toBe(1);
      expect(evaluator.evaluate('${context.nestedArr[1][1]}', {})).toBe(4);
      expect(evaluator.evaluate('${context.nestedArr[2][0]}', {})).toBe(5);
    });

    it('should access array properties', () => {
      expect(evaluator.evaluate('${context.arr.length}', {})).toBe(5);
    });

    it('should access object properties in arrays', () => {
      expect(evaluator.evaluate('${context.objArr[0].id}', {})).toBe(1);
      expect(evaluator.evaluate('${context.objArr[1].name}', {})).toBe('B');
    });
  });

  describe('Array Manipulation', () => {
    it('should create arrays with context references', () => {
      expect(evaluator.evaluate('[${context.arr[0]}, ${context.arr[1]}]', {})).toEqual([1, 2]);
    });

    it('should handle spread operator in arrays', () => {
      context.items = [10, 20, 30];
      expect(evaluator.evaluate('[...${context.items}]', {})).toEqual([10, 20, 30]);
      expect(evaluator.evaluate('[1, ...${context.items}, 2]', {})).toEqual([1, 10, 20, 30, 2]);
    });

    it('should handle multiple spread operators', () => {
      context.items1 = [10, 20];
      context.items2 = [30, 40];
      expect(evaluator.evaluate('[...${context.items1}, ...${context.items2}]', {})).toEqual([
        10, 20, 30, 40,
      ]);
    });
  });

  describe('Array Error Handling', () => {
    it('should throw for out of bounds indices', () => {
      expect(() => {
        evaluator.evaluate('${context.arr[10]}', {});
      }).toThrow();
    });

    it('should throw when trying to access properties on non-arrays', () => {
      context.notArray = 42;
      expect(() => {
        evaluator.evaluate('${context.notArray[0]}', {});
      }).toThrow();
    });

    it('should handle null/undefined array gracefully', () => {
      context.nullArray = null;
      context.undefinedArray = undefined;

      expect(() => {
        evaluator.evaluate('${context.nullArray[0]}', {});
      }).toThrow();

      expect(() => {
        evaluator.evaluate('${context.undefinedArray[0]}', {});
      }).toThrow();
    });

    it('should handle invalid input to evaluate', () => {
      const anyEvaluator = evaluator as any;
      expect(() => anyEvaluator.evaluate(null, {})).toThrow();
      expect(() => anyEvaluator.evaluate(undefined, {})).toThrow();
    });
  });
});
