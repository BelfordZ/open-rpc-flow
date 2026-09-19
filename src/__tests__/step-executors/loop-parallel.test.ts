import { LoopStepExecutor } from '../../step-executors/loop-executor';
import { canRunLoopInParallel } from '../../step-executors/loop-parallel-safety';
import { LoopStep, StepExecutionResult, StepType } from '../../step-executors/types';
import { Step, StepExecutionContext, ExecutionContextData } from '../../types';
import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ReferenceResolver } from '../../reference-resolver';
import { noLogger, TestLogger } from '../../util/logger';
import { LoopStepExecutionError } from '../../errors/base';

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

function makeItemLoop(
  name: string,
  body: Step,
  extraLoop: Partial<LoopStep['loop']> = {},
): LoopStep {
  return {
    name,
    loop: {
      over: '${items}',
      as: 'item',
      step: body,
      ...extraLoop,
    },
  };
}

function makeRequestBody(params: Record<string, unknown>): Step {
  return {
    name: 'processItem',
    request: {
      method: 'item.process',
      params,
    },
  };
}

describe('LoopStepExecutor parallel iterations', () => {
  let executor: LoopStepExecutor;
  let context: StepExecutionContext;
  let executeStep: jest.Mock;
  let stepResults: Map<string, any>;
  let testLogger: TestLogger;

  beforeEach(() => {
    testLogger = new TestLogger('LoopStepExecutor');
    executeStep = jest.fn();
    executor = new LoopStepExecutor(executeStep, testLogger);
    stepResults = new Map();
    const referenceResolver = new ReferenceResolver(stepResults, {}, testLogger);
    const expressionEvaluator = new SafeExpressionEvaluator(testLogger, referenceResolver);
    context = {
      referenceResolver,
      expressionEvaluator,
      stepResults,
      context: {},
      logger: noLogger,
    };
    stepResults.set('items', [{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  afterEach(() => {
    testLogger.clear();
  });

  it('runs iterations concurrently', async () => {
    const step = makeItemLoop('processItems', makeRequestBody({ id: '${item.id}' }));

    const started: number[] = [];
    const gates: Array<() => void> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    executeStep.mockImplementation(async (_step: Step, ctx: ExecutionContextData) => {
      const id = (ctx.item as { id: number }).id;
      started.push(id);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => {
        gates.push(resolve);
      });
      inFlight--;
      return { type: StepType.Request, result: { id } };
    });

    const promise = executor.execute(step, context, {}, new AbortController().signal);
    await flush();

    // All three iterations started before any finished.
    expect(started).toEqual([1, 2, 3]);
    expect(maxInFlight).toBe(3);

    // Finish out of order: iteration 3, then 1, then 2.
    gates[2]();
    gates[0]();
    gates[1]();
    const result = await promise;

    // Results come back in iteration order regardless of completion order.
    expect(result.type).toBe(StepType.Loop);
    expect(
      result.result.value.map((r: StepExecutionResult) => (r.result as { id: number }).id),
    ).toEqual([1, 2, 3]);
    expect(result.result.iterationCount).toBe(3);
    expect(result.result.skippedCount).toBe(0);
    expect(result.metadata?.parallel).toBe(true);
  });

  it('gives each iteration an isolated context', async () => {
    const step = makeItemLoop('processItems', makeRequestBody({ id: '${item.id}' }));
    executeStep.mockResolvedValue({ type: StepType.Request, result: {} });

    await executor.execute(step, context);

    const contexts = executeStep.mock.calls.map((call) => call[1] as ExecutionContextData);
    expect(contexts).toHaveLength(3);
    // Distinct objects, each bound to its own item.
    expect(new Set(contexts).size).toBe(3);
    const byId = new Map(contexts.map((c) => [(c.item as { id: number }).id, c]));
    expect([...byId.keys()].sort()).toEqual([1, 2, 3]);
    for (const [id, ctx] of byId) {
      expect((ctx.metadata as { current: { value: { id: number } } }).current.value.id).toBe(id);
    }
  });

  it('keeps the sequential metadata.iteration prefix shape in parallel mode', async () => {
    const step = makeItemLoop('processItems', makeRequestBody({ id: '${item.id}' }));
    executeStep.mockResolvedValue({ type: StepType.Request, result: {} });

    await executor.execute(step, context);

    const contexts = executeStep.mock.calls.map((call) => call[1] as ExecutionContextData);
    const histories = contexts.map((c) => (c.metadata as { iteration: unknown[] }).iteration);
    expect(histories[0]).toHaveLength(1);
    expect(histories[1]).toHaveLength(2);
    expect(histories[2]).toHaveLength(3);
    // Prefixes are copies: mutating one does not affect the others.
    expect(histories[0][0]).toEqual(histories[1][0]);
    expect(histories[0]).not.toBe(histories[1]);
  });

  it('respects the loop condition in parallel mode', async () => {
    const step = makeItemLoop('processItems', makeRequestBody({ id: '${item.id}' }), {
      condition: '${item.valid}',
    });
    stepResults.set('items', [
      { id: 1, valid: true },
      { id: 2, valid: false },
      { id: 3, valid: true },
    ]);
    executeStep.mockResolvedValue({ type: StepType.Request, result: {} });

    const result = await executor.execute(step, context);

    expect(result.result.value).toHaveLength(2);
    expect(result.result.iterationCount).toBe(3);
    expect(result.result.skippedCount).toBe(1);
    expect(executeStep).toHaveBeenCalledTimes(2);
  });

  it('emits progress for every iteration up front, in order', async () => {
    const progress: Array<[number, number]> = [];
    executor = new LoopStepExecutor(executeStep, testLogger, (_step, iteration, total) => {
      progress.push([iteration, total]);
    });

    const step = makeItemLoop('processItems', makeRequestBody({ id: '${item.id}' }));
    const gates: Array<() => void> = [];
    executeStep.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        gates.push(resolve);
      });
      return { type: StepType.Request, result: {} };
    });

    const promise = executor.execute(step, context);
    await flush();
    // Progress was emitted for all iterations before any finished.
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);

    gates.forEach((release) => release());
    await promise;
  });

  it('skips every iteration when the signal is already aborted', async () => {
    const step = makeItemLoop('processItems', makeRequestBody({ id: '${item.id}' }));
    executeStep.mockResolvedValue({ type: StepType.Request, result: {} });
    const controller = new AbortController();
    controller.abort();

    const result = await executor.execute(step, context, {}, controller.signal);

    expect(executeStep).not.toHaveBeenCalled();
    expect(result.result.value).toEqual([]);
    expect(result.result.iterationCount).toBe(0);
    expect(result.result.skippedCount).toBe(3);
    expect(result.metadata?.parallel).toBe(true);
  });

  it('fails the loop when an iteration throws, like the sequential loop', async () => {
    const step = makeItemLoop('processItems', makeRequestBody({ id: '${item.id}' }));
    executeStep.mockImplementation(async (_step: Step, ctx: ExecutionContextData) => {
      if ((ctx.item as { id: number }).id === 2) {
        throw new Error('boom');
      }
      return { type: StepType.Request, result: {} };
    });

    const error = await executor.execute(step, context).catch((e) => e);
    expect(error).toBeInstanceOf(LoopStepExecutionError);
    expect(error.message).toBe('Failed to execute loop step "processItems": boom');
  });

  it('produces the same error shape as sequential mode for iteration failures', async () => {
    const failing = async (_step: Step, ctx: ExecutionContextData) => {
      if ((ctx.item as { id: number }).id === 2) {
        throw new Error('boom');
      }
      return { type: StepType.Request, result: {} };
    };

    // Parallel: plain body.
    executeStep.mockImplementation(failing);
    const parallelError = await executor
      .execute(makeItemLoop('processItems', makeRequestBody({ id: '${item.id}' })), context)
      .catch((e) => e);

    // Sequential: body reads cross-iteration history, forcing sequential mode.
    executeStep.mockImplementation(failing);
    const sequentialError = await executor
      .execute(
        makeItemLoop(
          'processItems',
          makeRequestBody({ id: '${item.id}', n: '${metadata.iteration.length}' }),
        ),
        context,
      )
      .catch((e) => e);

    expect(parallelError.message).toBe(sequentialError.message);
    expect(parallelError.message).toBe('Failed to execute loop step "processItems": boom');
  });

  it('runs sequentially (never overlapping) when the body reads cross-iteration history', async () => {
    const step = makeItemLoop(
      'processItems',
      makeRequestBody({ id: '${item.id}', n: '${metadata.iteration.length}' }),
    );
    let inFlight = 0;
    let maxInFlight = 0;
    executeStep.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await flush();
      inFlight--;
      return { type: StepType.Request, result: {} };
    });

    const result = await executor.execute(step, context);

    expect(maxInFlight).toBe(1);
    expect(result.metadata?.parallel).toBe(false);
    expect(result.result.value).toHaveLength(3);
  });

  it('runs sequentially when the body references the loop’s own result', async () => {
    const step = makeItemLoop(
      'processItems',
      makeRequestBody({ id: '${item.id}', prev: '${processItems.result.value[0]}' }),
    );
    let inFlight = 0;
    let maxInFlight = 0;
    executeStep.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await flush();
      inFlight--;
      return { type: StepType.Request, result: {} };
    });

    const result = await executor.execute(step, context);

    expect(maxInFlight).toBe(1);
    expect(result.metadata?.parallel).toBe(false);
  });

  it('runs sequentially when the body contains a stop step', async () => {
    const step: LoopStep = {
      name: 'processItems',
      loop: {
        over: '${items}',
        as: 'item',
        steps: [
          makeRequestBody({ id: '${item.id}' }),
          { name: 'halt', stop: { message: 'done' } } as Step,
        ],
      },
    };
    let inFlight = 0;
    let maxInFlight = 0;
    executeStep.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await flush();
      inFlight--;
      return { type: StepType.Request, result: {} };
    });

    const result = await executor.execute(step, context);

    expect(maxInFlight).toBe(1);
    expect(result.metadata?.parallel).toBe(false);
  });

  it('stays parallel when the body only reads metadata.current', async () => {
    const step = makeItemLoop(
      'processItems',
      makeRequestBody({ id: '${item.id}', index: '${metadata.current.index}' }),
    );
    let maxInFlight = 0;
    let inFlight = 0;
    const gates: Array<() => void> = [];
    executeStep.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => {
        gates.push(resolve);
      });
      inFlight--;
      return { type: StepType.Request, result: {} };
    });

    const promise = executor.execute(step, context);
    await flush();
    expect(maxInFlight).toBe(3);

    gates.forEach((release) => release());
    const result = await promise;
    expect(result.metadata?.parallel).toBe(true);
  });
});

describe('LoopStepExecutor sequential fallback', () => {
  let executor: LoopStepExecutor;
  let context: StepExecutionContext;
  let executeStep: jest.Mock;
  let stepResults: Map<string, any>;
  let testLogger: TestLogger;

  beforeEach(() => {
    testLogger = new TestLogger('LoopStepExecutor');
    executeStep = jest.fn();
    executor = new LoopStepExecutor(executeStep, testLogger);
    stepResults = new Map();
    const referenceResolver = new ReferenceResolver(stepResults, {}, testLogger);
    const expressionEvaluator = new SafeExpressionEvaluator(testLogger, referenceResolver);
    context = {
      referenceResolver,
      expressionEvaluator,
      stepResults,
      context: {},
      logger: noLogger,
    };
    stepResults.set('items', [{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  afterEach(() => {
    testLogger.clear();
  });

  // Bodies that read ${metadata.iteration} force sequential execution, which
  // keeps the original sequential behavior (and its branches) covered.

  it('enforces maxIterations in sequential mode', async () => {
    stepResults.set('items', [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    const step = makeItemLoop(
      'processItems',
      makeRequestBody({ id: '${item.id}', n: '${metadata.iteration.length}' }),
      { maxIterations: 2 },
    );
    executeStep.mockResolvedValue({ type: StepType.Request, result: {} });

    const result = await executor.execute(step, context);

    expect(result.metadata?.parallel).toBe(false);
    expect(executeStep).toHaveBeenCalledTimes(2);
    expect(result.result.value).toHaveLength(2);
    expect(result.result.iterationCount).toBe(2);
    expect(result.result.skippedCount).toBe(2);
  });

  it('applies condition skips in sequential mode', async () => {
    stepResults.set('items', [
      { id: 1, valid: true },
      { id: 2, valid: false },
      { id: 3, valid: true },
    ]);
    const step = makeItemLoop(
      'processItems',
      makeRequestBody({ id: '${item.id}', n: '${metadata.iteration.length}' }),
      { condition: '${item.valid}' },
    );
    executeStep.mockResolvedValue({ type: StepType.Request, result: {} });

    const result = await executor.execute(step, context);

    expect(result.metadata?.parallel).toBe(false);
    expect(executeStep).toHaveBeenCalledTimes(2);
    expect(result.result.value).toHaveLength(2);
    expect(result.result.skippedCount).toBe(1);
  });

  it('stops a sequential loop when the signal aborts mid-run', async () => {
    const step = makeItemLoop(
      'processItems',
      makeRequestBody({ id: '${item.id}', n: '${metadata.iteration.length}' }),
    );
    const controller = new AbortController();
    let calls = 0;
    executeStep.mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        controller.abort();
      }
      return { type: StepType.Request, result: {} };
    });

    const result = await executor.execute(step, context, {}, controller.signal);

    expect(result.metadata?.parallel).toBe(false);
    expect(executeStep).toHaveBeenCalledTimes(1);
    expect(result.result.value).toHaveLength(1);
    expect(result.result.iterationCount).toBe(1);
    expect(result.result.skippedCount).toBe(2);
  });
});
describe('canRunLoopInParallel', () => {
  it('approves a plain loop over step results', () => {
    const step = makeItemLoop('processItems', makeRequestBody({ id: '${item.id}' }));
    expect(canRunLoopInParallel(step)).toEqual({
      parallel: true,
      reason: 'no self-dependencies detected',
    });
  });

  it('rejects a reference to the loop’s own result', () => {
    const step = makeItemLoop(
      'processItems',
      makeRequestBody({ id: '${processItems.result.value[0].id}' }),
    );
    const decision = canRunLoopInParallel(step);
    expect(decision.parallel).toBe(false);
    expect(decision.reason).toContain('own result');
  });

  it('rejects a bracket-notation reference to the loop’s own result', () => {
    const step = makeItemLoop(
      'processItems',
      makeRequestBody({ id: "${steps['processItems'].result.value[0]}" }),
    );
    // `steps` is not a resolvable root in the reference resolver, so this is
    // not treated as a self-dependency; it fails identically in both modes.
    expect(canRunLoopInParallel(step).parallel).toBe(true);
  });

  it('rejects reads of metadata.iteration', () => {
    const step = makeItemLoop(
      'processItems',
      makeRequestBody({ id: '${item.id}', history: '${metadata.iteration}' }),
    );
    const decision = canRunLoopInParallel(step);
    expect(decision.parallel).toBe(false);
    expect(decision.reason).toContain('cross-iteration history');
  });

  it('rejects reads of bare metadata', () => {
    const step = makeItemLoop(
      'processItems',
      makeRequestBody({ id: '${item.id}', m: '${metadata}' }),
    );
    expect(canRunLoopInParallel(step).parallel).toBe(false);
  });

  it('allows reads of metadata.current', () => {
    const step = makeItemLoop(
      'processItems',
      makeRequestBody({ id: '${item.id}', index: '${metadata.current.index}' }),
    );
    expect(canRunLoopInParallel(step).parallel).toBe(true);
  });

  it('allows the loop variable to share the loop’s name (it shadows the result)', () => {
    const step = makeItemLoop('item', makeRequestBody({ id: '${item.id}' }));
    expect(canRunLoopInParallel(step).parallel).toBe(true);
  });

  it('rejects a self-reference in the loop condition', () => {
    const step = makeItemLoop('processItems', makeRequestBody({ id: '${item.id}' }), {
      condition: '${processItems.result.value[0].done}',
    });
    expect(canRunLoopInParallel(step).parallel).toBe(false);
  });

  it('rejects a stop step anywhere in the body', () => {
    const step: LoopStep = {
      name: 'processItems',
      loop: {
        over: '${items}',
        as: 'item',
        steps: [
          makeRequestBody({ id: '${item.id}' }),
          { name: 'halt', stop: { message: 'done' } } as Step,
        ],
      },
    };
    const decision = canRunLoopInParallel(step);
    expect(decision.parallel).toBe(false);
    expect(decision.reason).toContain('stop step');
  });

  it('rejects a stop step nested in a condition branch', () => {
    const step: LoopStep = {
      name: 'processItems',
      loop: {
        over: '${items}',
        as: 'item',
        step: {
          name: 'maybe',
          condition: {
            if: '${item.go}',
            then: { name: 'halt', stop: { message: 'done' } } as Step,
            else: makeRequestBody({ id: '${item.id}' }),
          },
        } as Step,
      },
    };
    expect(canRunLoopInParallel(step).parallel).toBe(false);
  });

  it('rejects a self-reference inside a nested loop body', () => {
    const step: LoopStep = {
      name: 'outer',
      loop: {
        over: '${items}',
        as: 'item',
        step: {
          name: 'inner',
          loop: {
            over: '${item.children}',
            as: 'child',
            step: makeRequestBody({ id: '${outer.result.value[0]}' }),
          },
        } as Step,
      },
    };
    expect(canRunLoopInParallel(step).parallel).toBe(false);
  });

  it('rejects a self-reference inside a delay step', () => {
    const step: LoopStep = {
      name: 'processItems',
      loop: {
        over: '${items}',
        as: 'item',
        step: {
          name: 'wait',
          delay: {
            duration: 10,
            step: makeRequestBody({ id: '${processItems.result}' }),
          },
        } as Step,
      },
    };
    expect(canRunLoopInParallel(step).parallel).toBe(false);
  });

  it('ignores the loop name in name/description labels', () => {
    const step: LoopStep = {
      name: 'processItems',
      description: 'aggregates processItems.result downstream',
      loop: {
        over: '${items}',
        as: 'item',
        step: {
          name: 'processItemsWatcher',
          description: 'watches processItems',
          request: { method: 'm', params: { id: '${item.id}' } },
        },
      },
    };
    expect(canRunLoopInParallel(step).parallel).toBe(true);
  });

  it('handles nested references and multiple references per string', () => {
    const step = makeItemLoop(
      'processItems',
      makeRequestBody({ id: 'a-${item.id}-b-${other.value}-c-${outer.${processItems.result}}' }),
    );
    expect(canRunLoopInParallel(step).parallel).toBe(false);
  });

  it('approves a condition with clean then and else branches', () => {
    const step: LoopStep = {
      name: 'processItems',
      loop: {
        over: '${items}',
        as: 'item',
        step: {
          name: 'maybe',
          condition: {
            if: '${item.go}',
            then: makeRequestBody({ id: '${item.id}' }),
            else: makeRequestBody({ id: '${item.id}' }),
          },
        } as Step,
      },
    };
    expect(canRunLoopInParallel(step).parallel).toBe(true);
  });

  it('tolerates unbalanced reference syntax without crashing', () => {
    const step = makeItemLoop(
      'processItems',
      makeRequestBody({ id: '${item.id', note: 'oops ${' }),
    );
    expect(canRunLoopInParallel(step).parallel).toBe(true);
  });

  it('tolerates nullish and odd shapes without crashing', () => {
    // Null / non-object loop shapes (defensive branches).
    for (const loop of [null, 'nope', { over: '${items}', as: 'item' }] as unknown[]) {
      expect(canRunLoopInParallel({ name: 'x', loop } as unknown as LoopStep).parallel).toBe(true);
    }
    // Null / non-object condition shapes (defensive branches).
    for (const condition of [null, 'nope'] as unknown[]) {
      expect(
        canRunLoopInParallel({
          name: 'processItems',
          loop: { over: '${items}', as: 'item', condition, step: makeRequestBody({}) },
        } as unknown as LoopStep).parallel,
      ).toBe(true);
    }
  });

  it('handles a loop named metadata reading metadata.current', () => {
    const step = makeItemLoop('metadata', makeRequestBody({ index: '${metadata.current.index}' }));
    expect(canRunLoopInParallel(step).parallel).toBe(true);
  });
});
