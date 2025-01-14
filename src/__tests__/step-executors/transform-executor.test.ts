import { TransformStepExecutor } from '../../step-executors';
import { TransformStep } from '../../step-executors/types';
import { StepExecutionContext } from '../../types';
import { TransformExecutor } from '../../step-executors/transform-executor';
import { noLogger } from '../../util/logger';
import { createMockContext } from '../test-utils';

describe('TransformStepExecutor', () => {
  let executor: TransformStepExecutor;
  let context: StepExecutionContext;
  let transformExecutor: TransformExecutor;

  beforeEach(() => {
    context = createMockContext();
    transformExecutor = new TransformExecutor(
      context.expressionEvaluator,
      context.referenceResolver,
      context.context,
      noLogger,
    );
    executor = new TransformStepExecutor(transformExecutor, noLogger);
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
            using: '{ id: item.id, value: item.value * 2 }',
          },
        ],
      },
    };

    const result = await executor.execute(step, context);

    expect(result.type).toBe('transform');
    expect(result.result).toEqual([
      { id: 1, value: 20 },
      { id: 2, value: 40 },
    ]);
    expect(result.metadata).toEqual({
      operations: [
        {
          type: 'map',
          using: '{ id: item.id, value: item.value * 2 }',
          initial: undefined,
        },
      ],
      inputType: 'array',
      resultType: 'array',
      timestamp: expect.any(String),
    });
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

    const result = await executor.execute(step, context);

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
      inputType: 'array',
      resultType: 'array',
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

    const result = await executor.execute(step, context);

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
      inputType: 'array',
      resultType: 'number',
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

    const result = await executor.execute(step, context);

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
            using: '{ id: item.id, doubled: item.value * 2 }',
          },
          {
            type: 'reduce',
            using: '${acc} + ${item.doubled}',
            initial: 0,
          },
        ],
      },
    };

    const result = await executor.execute(step, context);

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

    const result = await executor.execute(step, context);

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

    const result = await executor.execute(step, context);

    expect(result.metadata).toEqual({
      operations: [
        {
          type: 'map',
          using: '${item} * 2',
          initial: undefined,
        },
      ],
      inputType: 'array',
      resultType: 'array',
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

    const result = await executor.execute(step, context);

    expect(result.type).toBe('transform');
    expect(result.result).toBe('Bob, Charlie');
  });
});
