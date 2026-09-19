import { TransformStepExecutor, TransformExecutor } from '../../step-executors/transform-executor';
import { TransformStep, TransformOperation } from '../../step-executors/types';
import { StepExecutionContext } from '../../types';
import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ReferenceResolver } from '../../reference-resolver';
import { TestLogger } from '../../util/logger';
import { createMockContext } from '../test-utils';
import { PolicyResolver } from '../../util/policy-resolver';

describe('Transform Executors', () => {
  describe('TransformExecutor', () => {
    let executor: TransformExecutor;
    let expressionEvaluator: SafeExpressionEvaluator;
    let referenceResolver: ReferenceResolver;
    let context: Record<string, any>;
    let stepResults: Map<string, any>;
    const logger = new TestLogger('TransformExecutorTest');

    beforeEach(() => {
      stepResults = new Map();
      context = {};

      referenceResolver = new ReferenceResolver(stepResults, context, logger);
      expressionEvaluator = new SafeExpressionEvaluator(logger, referenceResolver);
      executor = new TransformExecutor(expressionEvaluator, referenceResolver, context, logger);
    });

    afterEach(() => {
      //logger.print();
      logger.clear();
    });

    describe('map operation', () => {
      test('maps array using expression', async () => {
        const data = [1, 2, 3];
        const operations: TransformOperation[] = [
          {
            type: 'map',
            using: '${item} * 2',
          },
        ];

        const result = await executor.execute(operations, data);
        expect(result).toEqual([2, 4, 6]);
      });

      test('maps objects using expression', async () => {
        const data = [{ value: 1 }, { value: 2 }];
        const operations: TransformOperation[] = [
          {
            type: 'map',
            using: '${item.value} + 1',
          },
        ];

        const result = await executor.execute(operations, data);
        expect(result).toEqual([2, 3]);
      });
    });

    describe('filter operation', () => {
      test('filters array using condition', async () => {
        const data = [1, 2, 3, 4];
        const operations: TransformOperation[] = [
          {
            type: 'filter',
            using: '${item} > 2',
          },
        ];

        const result = await executor.execute(operations, data);
        expect(result).toEqual([3, 4]);
      });

      test('filters objects using condition', async () => {
        const data = [{ value: 1 }, { value: 2 }, { value: 3 }];
        const operations: TransformOperation[] = [
          {
            type: 'filter',
            using: '${item.value} > 1',
          },
        ];

        const result = await executor.execute(operations, data);
        expect(result).toEqual([{ value: 2 }, { value: 3 }]);
      });
    });

    describe('reduce operation', () => {
      test('reduces array using expression', async () => {
        const data = [1, 2, 3];
        const operations: TransformOperation[] = [
          {
            type: 'reduce',
            using: '${acc} + ${item}',
            initial: 0,
          },
        ];

        const result = await executor.execute(operations, data);
        expect(result).toBe(6);
      });

      test('reduces objects using expression', async () => {
        const data = [{ value: 1 }, { value: 2 }];
        const operations: TransformOperation[] = [
          {
            type: 'reduce',
            using: '${acc} + ${item.value}',
            initial: 0,
          },
        ];

        const result = await executor.execute(operations, data);
        expect(result).toBe(3);
      });

      test('reduces with non-zero initial value', async () => {
        const data = [1, 2, 3];
        const operations: TransformOperation[] = [
          {
            type: 'reduce',
            using: '${acc} + ${item}',
            initial: 10,
          },
        ];

        const result = await executor.execute(operations, data);
        expect(result).toBe(16); // 10 + 1 + 2 + 3
      });
    });

    describe('flatten operation', () => {
      test('flattens nested arrays', async () => {
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

        const result = await executor.execute(operations, data);
        expect(result).toEqual([1, 2, 3, 4]);
      });
    });

    describe('sort operation', () => {
      test('sorts array using comparison', async () => {
        const data = [3, 1, 4, 2];
        const operations: TransformOperation[] = [
          {
            type: 'sort',
            using: '${a} - ${b}',
          },
        ];

        const result = await executor.execute(operations, data);
        expect(result).toEqual([1, 2, 3, 4]);
      });

      test('sorts objects using comparison', async () => {
        const data = [{ value: 3 }, { value: 1 }, { value: 2 }];
        const operations: TransformOperation[] = [
          {
            type: 'sort',
            using: '${a.value} - ${b.value}',
          },
        ];

        const result = await executor.execute(operations, data);
        expect(result).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
      });
    });

    describe('unique operation', () => {
      test('removes duplicates from array', async () => {
        const data = [1, 2, 2, 3, 3, 4];
        const operations: TransformOperation[] = [
          {
            type: 'unique',
            using: '',
          },
        ];

        const result = await executor.execute(operations, data);
        expect(result).toEqual([1, 2, 3, 4]);
      });
    });

    describe('group operation', () => {
      test('groups array items by key', async () => {
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

        const result = await executor.execute(operations, data);
        expect(result).toEqual([
          {
            key: 'a',
            items: [
              { type: 'a', value: 1 },
              { type: 'a', value: 3 },
            ],
          },
          {
            key: 'b',
            items: [{ type: 'b', value: 2 }],
          },
        ]);
      });
    });

    describe('join operation', () => {
      test('joins array with separator', async () => {
        const data = ['a', 'b', 'c'];
        const operations: TransformOperation[] = [
          {
            type: 'join',
            using: ', ',
          },
        ];

        const result = await executor.execute(operations, data);
        expect(result).toBe('a, b, c');
      });
    });

    describe('operation chaining', () => {
      test('chains multiple operations', async () => {
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

        const result = await executor.execute(operations, data);
        expect(result).toBe(14); // (2*3 + 2*4) = 6 + 8 = 14
      });
    });

    describe('error handling', () => {
      test('throws on invalid input type', async () => {
        const data = 'not an array';
        const operations: TransformOperation[] = [
          {
            type: 'map',
            using: '${item}',
          },
        ];
        await expect(executor.execute(operations, data)).rejects.toThrow(
          'Did you mean to use a string literal? Wrap your value in quotes',
        );
      });

      test('throws when array operation receives non-array literal input', async () => {
        const data = { value: 1 };
        const operations: TransformOperation[] = [
          {
            type: 'map',
            using: '${item}',
          },
        ];

        await expect(executor.execute(operations, data as unknown as any[])).rejects.toThrow(
          'Input to map operation must be an array',
        );
      });

      test('throws on unknown operation type', async () => {
        const data = [1, 2, 3];
        const operations: TransformOperation[] = [
          {
            type: 'invalid' as any,
            using: '${item}',
          },
        ];
        await expect(executor.execute(operations, data)).rejects.toThrow(
          'Unknown transform operation type',
        );
      });
    });

    describe('outputs capture', () => {
      test('captures result for "as" without mutating context', async () => {
        const data = [1, 2, 3];
        const operations: TransformOperation[] = [
          {
            type: 'map',
            using: '${item} * 2',
            as: 'doubled',
          },
        ];

        const outputs: Record<string, unknown> = {};
        await executor.execute(operations, data, undefined, undefined, (key, value) => {
          outputs[key] = value;
        });
        expect(outputs).toEqual({ doubled: [2, 4, 6] });
        expect(context.doubled).toBeUndefined();
      });
    });

    describe('abort handling', () => {
      test('aborts when signal already aborted', async () => {
        const ac = new AbortController();
        ac.abort();
        const ops: TransformOperation[] = [{ type: 'map', using: '${item}' }];
        await expect(executor.execute(ops, [1, 2], undefined, ac.signal)).rejects.toThrow(
          'Transform step aborted',
        );
      });

      const cases: Array<[string, TransformOperation, any[]]> = [
        ['map', { type: 'map', using: '${item}' }, [1, 2]],
        ['filter', { type: 'filter', using: '${item > 0}' }, [1, -1]],
        ['reduce', { type: 'reduce', using: '${acc}+${item}', initial: 0 }, [1, 2]],
        [
          'sort',
          { type: 'sort', using: '${a.key} - ${b.key}' },
          [{ key: 3 }, { key: 2 }, { key: 1 }],
        ],
        ['group', { type: 'group', using: '${item.key}' }, [{ key: 'a' }, { key: 'b' }]],
      ];

      test.each(cases)(
        'aborts %s operation when signal aborted mid-execution',
        async (name, op, data) => {
          const ac = new AbortController();
          let count = 0;
          jest.spyOn(expressionEvaluator, 'evaluate').mockImplementation((expr, ctx) => {
            if (count++ === 0) ac.abort();
            return ctx.item ?? ctx.a ?? 0;
          });
          await expect(
            executor.execute([op], data as unknown as any[], undefined, ac.signal),
          ).rejects.toThrow(`Transform ${name} operation aborted`);
        },
      );
    });
  });

  describe('TransformStepExecutor', () => {
    let stepExecutor: TransformStepExecutor;
    let context: StepExecutionContext;
    let contextObj: Record<string, any>;
    const logger = new TestLogger('TransformStepExecutorTest');
    beforeEach(() => {
      const stepResults = new Map();
      contextObj = {};

      const referenceResolver = new ReferenceResolver(stepResults, contextObj, logger);
      const expressionEvaluator = new SafeExpressionEvaluator(logger, referenceResolver);
      const flow = { name: 'test', description: '', steps: [] };
      const policyResolver = new PolicyResolver(flow, logger);
      stepExecutor = new TransformStepExecutor(
        expressionEvaluator,
        referenceResolver,
        contextObj,
        logger,
        policyResolver,
      );
      context = createMockContext();
    });

    afterEach(() => {
      //logger.print();
      logger.clear();
    });

    it('performs map transformation', async () => {
      const items = [
        { id: 1, value: 10 },
        { id: 2, value: 20 },
      ];
      context.stepResults.set('items', items);

      const step: TransformStep = {
        name: 'doubleValues',
        transform: {
          input: '${items}',
          operations: [
            {
              type: 'map',
              using: '{ id: ${item.id}, value: ${item.value} * 2 }',
            },
          ],
        },
      };

      const result = await stepExecutor.execute(step, context);

      expect(result.type).toBe('transform');
      expect(result.result).toEqual([
        { id: 1, value: 20 },
        { id: 2, value: 40 },
      ]);
      expect(result.metadata).toEqual({
        operations: [
          {
            type: 'map',
            using: '{ id: ${item.id}, value: ${item.value} * 2 }',
            initial: undefined,
          },
        ],
        inputType: Array.isArray(items) ? 'array' : typeof items,
        resultType: 'array',
        timeout: 10000,
        timestamp: expect.any(String),
      });
    });

    it('stores outputs in metadata without mutating context', async () => {
      const step: TransformStep = {
        name: 'storeOutput',
        transform: {
          input: [1, 2, 3],
          operations: [
            {
              type: 'map',
              using: '${item} * 2',
              as: 'doubled',
            },
          ],
        },
      };

      const result = await stepExecutor.execute(step, context);

      expect(result.type).toBe('transform');
      expect(result.metadata?.outputs).toEqual({ doubled: [2, 4, 6] });
      expect(contextObj.doubled).toBeUndefined();
    });

    it('performs filter transformation', async () => {
      const items = [
        { id: 1, value: 10 },
        { id: 2, value: 20 },
        { id: 3, value: 30 },
      ];
      context.stepResults.set('items', items);

      const step: TransformStep = {
        name: 'filterHighValues',
        transform: {
          input: '${items}',
          operations: [
            {
              type: 'filter',
              using: '${item.value} > 15',
            },
          ],
        },
      };

      const result = await stepExecutor.execute(step, context);

      expect(result.type).toBe('transform');
      expect(result.result).toEqual([
        { id: 2, value: 20 },
        { id: 3, value: 30 },
      ]);
      expect(result.metadata).toEqual({
        operations: [
          {
            type: 'filter',
            using: '${item.value} > 15',
            initial: undefined,
          },
        ],
        inputType: Array.isArray(items) ? 'array' : typeof items,
        resultType: 'array',
        timeout: 10000,
        timestamp: expect.any(String),
      });
    });

    it('performs reduce transformation', async () => {
      const items = [
        { id: 1, value: 10 },
        { id: 2, value: 20 },
        { id: 3, value: 30 },
      ];
      context.stepResults.set('items', items);

      const step: TransformStep = {
        name: 'sumValues',
        transform: {
          input: '${items}',
          operations: [
            {
              type: 'reduce',
              using: '${acc} + ${item.value}',
              initial: 0,
            },
          ],
        },
      };

      const result = await stepExecutor.execute(step, context);

      expect(result.type).toBe('transform');
      expect(result.result).toBe(60);
      expect(result.metadata).toEqual({
        operations: [
          {
            type: 'reduce',
            using: '${acc} + ${item.value}',
            initial: 0,
          },
        ],
        inputType: Array.isArray(items) ? 'array' : typeof items,
        resultType: 'number',
        timeout: 10000,
        timestamp: expect.any(String),
      });
    });

    it('performs flatten transformation', async () => {
      const items = [
        [1, 2],
        [3, 4],
        [5, 6],
      ];
      context.stepResults.set('items', items);

      const step: TransformStep = {
        name: 'flattenArrays',
        transform: {
          input: '${items}',
          operations: [
            {
              type: 'flatten',
              using: '${item}',
            },
          ],
        },
      };

      const result = await stepExecutor.execute(step, context);

      expect(result.type).toBe('transform');
      expect(result.result).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('chains multiple transformations', async () => {
      const items = [
        { id: 1, value: 10 },
        { id: 2, value: 20 },
        { id: 3, value: 30 },
      ];
      context.stepResults.set('items', items);

      const step: TransformStep = {
        name: 'complexTransform',
        transform: {
          input: '${items}',
          operations: [
            {
              type: 'filter',
              using: '${item.value} > 15',
            },
            {
              type: 'map',
              using: '{ id: ${item.id}, doubled: ${item.value} * 2 }',
            },
            {
              type: 'reduce',
              using: '${acc} + ${item.doubled}',
              initial: 0,
            },
          ],
        },
      };

      const result = await stepExecutor.execute(step, context);

      expect(result.type).toBe('transform');
      expect(result.result).toBe(100); // (20 * 2) + (30 * 2)
    });

    it('handles empty input array', async () => {
      context.stepResults.set('items', []);

      const step: TransformStep = {
        name: 'transformEmpty',
        transform: {
          input: '${items}',
          operations: [
            {
              type: 'map',
              using: '${item}',
            },
          ],
        },
      };

      const result = await stepExecutor.execute(step, context);

      expect(result.type).toBe('transform');
      expect(result.result).toEqual([]);
    });

    it('provides operation metadata', async () => {
      const items = [1, 2, 3];
      context.stepResults.set('items', items);

      const step: TransformStep = {
        name: 'withMetadata',
        transform: {
          input: '${items}',
          operations: [
            {
              type: 'map',
              using: '${item} * 2',
            },
          ],
        },
      };

      const result = await stepExecutor.execute(step, context);

      expect(result.metadata).toEqual({
        operations: [
          {
            type: 'map',
            using: '${item} * 2',
            initial: undefined,
          },
        ],
        inputType: Array.isArray(items) ? 'array' : typeof items,
        resultType: 'array',
        timeout: 10000,
        timestamp: expect.any(String),
      });
    });

    it('records raw input type for expression inputs', async () => {
      const step: TransformStep = {
        name: 'literalExpression',
        transform: {
          input: '[1, 2, 3]',
          operations: [
            {
              type: 'map',
              using: '${item} * 2',
            },
          ],
        },
      };

      const result = await stepExecutor.execute(step, context);

      expect(result.type).toBe('transform');
      expect(result.result).toEqual([2, 4, 6]);
      expect(result.metadata).toEqual({
        operations: [
          {
            type: 'map',
            using: '${item} * 2',
            initial: undefined,
          },
        ],
        inputType: 'string',
        resultType: 'array',
        timeout: 10000,
        timestamp: expect.any(String),
      });
    });

    it('handles wrapped step results', async () => {
      // Set up a step result that includes the result wrapper
      const wrappedResult = {
        result: [
          { id: 1, name: 'Bob' },
          { id: 2, name: 'Charlie' },
        ],
        type: 'request',
        metadata: { method: 'user.getFriends', requestId: 1 },
      };
      context.stepResults.set('getFriends', wrappedResult);

      const step: TransformStep = {
        name: 'friendNames',
        transform: {
          input: '${getFriends.result}',
          operations: [
            {
              type: 'map',
              using: '${item.name}',
            },
            {
              type: 'join',
              using: ', ',
            },
          ],
        },
      };

      const result = await stepExecutor.execute(step, context);

      expect(result.type).toBe('transform');
      expect(result.result).toBe('Bob, Charlie');
    });

    it('throws error when given invalid step type', async () => {
      const invalidStep = {
        name: 'invalidStep',
        request: {
          // This makes it a RequestStep instead of a TransformStep
          method: 'some.method',
          params: {},
        },
      };

      await expect(stepExecutor.execute(invalidStep as any, context)).rejects.toThrow(
        'Invalid step type for TransformStepExecutor',
      );
    });
  });
});
