import { FlowExecutor } from '../flow-executor';
import { Flow, JsonRpcRequest } from '../types';
import { FlowEventType } from '../util/flow-executor-events';
import { TestLogger } from '../util/logger';
import { StopBranch } from '../errors/stop-branch';
import { RetryableOperation, RetryPolicy } from '../errors/recovery';
import { ErrorCode } from '../errors/codes';

/**
 * Regression tests for issue #188: a bare `stop: {}` (without
 * `endWorkflow: true`) used to be a silent no-op. It now terminates the
 * enclosing branch:
 * - inside a switch case: the rest of the case is skipped, the flow
 *   continues after the switch step;
 * - inside a `loop.steps` body: the rest of the current iteration is
 *   skipped, the loop continues with the next iteration;
 * - at the top level: remaining steps are skipped and the flow completes
 *   successfully (gracefully — not aborted).
 */
describe('bare stop step branch termination (issue #188)', () => {
  let testLogger: TestLogger;

  beforeEach(() => {
    testLogger = new TestLogger('StopBranchTest');
  });

  afterEach(() => {
    testLogger.clear();
  });

  const trackEvents = (executor: FlowExecutor) => {
    const events: Array<{ type: string; payload: any }> = [];
    const types = [
      FlowEventType.STEP_START,
      FlowEventType.STEP_COMPLETE,
      FlowEventType.STEP_SKIP,
      FlowEventType.STEP_ERROR,
      FlowEventType.FLOW_COMPLETE,
      FlowEventType.FLOW_ABORTED,
      FlowEventType.FLOW_ERROR,
    ];
    for (const type of types) {
      executor.events.on(type, (payload) => events.push({ type, payload }));
    }
    return events;
  };

  const handlerFor = (methods: Record<string, (params: any) => any>, calls: string[]) =>
    jest.fn(async (request: JsonRpcRequest) => {
      calls.push(request.method);
      const impl = methods[request.method];
      if (!impl) {
        throw new Error(`No mock response for method: ${request.method}`);
      }
      return impl(request.params);
    });

  it('skips remaining top-level steps and completes gracefully (not aborted)', async () => {
    const calls: string[] = [];
    const flow: Flow = {
      name: 'stop-top-level',
      description: 'bare stop at top level',
      steps: [
        { name: 'a', request: { method: 'a', params: {} } },
        { name: 'halt', stop: {} },
        { name: 'b', request: { method: 'b', params: { after: '${halt.result}' } } },
        { name: 'c', request: { method: 'c', params: { after: '${b.result}' } } },
      ],
    };
    const executor = new FlowExecutor(flow, handlerFor({ a: () => 'a-ok' }, calls), {
      logger: testLogger,
    });
    const events = trackEvents(executor);

    const results = await executor.execute();

    // The flow completed successfully: no rejection, no abort.
    expect(results.get('a')).toMatchObject({ result: 'a-ok' });
    expect(results.get('halt')).toMatchObject({ type: 'stop' });
    expect(results.has('b')).toBe(false);
    expect(results.has('c')).toBe(false);
    expect(calls).toEqual(['a']);

    const ofType = (type: string) => events.filter((e) => e.type === type);
    expect(ofType(FlowEventType.FLOW_COMPLETE).length).toBe(1);
    expect(ofType(FlowEventType.FLOW_ABORTED).length).toBe(0);
    expect(ofType(FlowEventType.FLOW_ERROR).length).toBe(0);
    expect(ofType(FlowEventType.STEP_ERROR).length).toBe(0);

    // The stop step itself completed exactly once...
    const haltCompletes = ofType(FlowEventType.STEP_COMPLETE).filter(
      (e) => e.payload.stepName === 'halt',
    );
    expect(haltCompletes.length).toBe(1);

    // ...and the steps that never ran are reported as skipped.
    const skips = ofType(FlowEventType.STEP_SKIP);
    expect(skips.map((e) => e.payload.stepName).sort()).toEqual(['b', 'c']);
    for (const skip of skips) {
      expect(skip.payload.reason).toContain('halt');
      expect(typeof skip.payload.correlationId).toBe('string');
    }
  });

  it('skips the rest of the switch case but continues after the switch', async () => {
    const calls: string[] = [];
    const flow: Flow = {
      name: 'stop-switch',
      description: 'bare stop in switch case',
      steps: [
        { name: 'pick', request: { method: 'pick', params: {} } },
        {
          name: 'route',
          condition: {
            switch: '${pick.result}',
            cases: {
              x: [
                { name: 'x1', request: { method: 'x1', params: {} } },
                { name: 'halt', stop: {} },
                { name: 'x2', request: { method: 'x2', params: {} } },
              ],
              y: [{ name: 'y1', request: { method: 'y1', params: {} } }],
            },
          },
        },
        { name: 'after', request: { method: 'after', params: { routed: '${route}' } } },
      ],
    };
    const executor = new FlowExecutor(
      flow,
      handlerFor({ pick: () => 'x', x1: () => 'x1-ok', after: () => 'after-ok' }, calls),
      { logger: testLogger },
    );
    const events = trackEvents(executor);

    const results = await executor.execute();

    expect(calls).toEqual(['pick', 'x1', 'after']);
    expect(results.get('after')).toMatchObject({ result: 'after-ok' });

    const ofType = (type: string) => events.filter((e) => e.type === type);
    expect(ofType(FlowEventType.FLOW_COMPLETE).length).toBe(1);
    expect(ofType(FlowEventType.FLOW_ABORTED).length).toBe(0);
    expect(ofType(FlowEventType.STEP_ERROR).length).toBe(0);

    // The stop step completed; the rest of its case was skipped.
    expect(
      ofType(FlowEventType.STEP_COMPLETE).filter((e) => e.payload.stepName === 'halt').length,
    ).toBe(1);
    const skips = ofType(FlowEventType.STEP_SKIP);
    expect(skips.map((e) => e.payload.stepName)).toEqual(['x2']);
    expect(skips[0].payload.reason).toContain('halt');
  });

  it('skips the rest of the loop iteration and continues with the next one', async () => {
    const calls: string[] = [];
    const flow: Flow = {
      name: 'stop-loop',
      description: 'bare stop in loop body',
      steps: [
        { name: 'items', request: { method: 'items', params: {} } },
        {
          name: 'each',
          loop: {
            over: '${items.result}',
            as: 'item',
            steps: [
              { name: 'mark', request: { method: 'mark', params: { item: '${item}' } } },
              { name: 'halt', stop: {} },
              { name: 'tail', request: { method: 'tail', params: { item: '${item}' } } },
            ],
          },
        },
        { name: 'done', request: { method: 'done', params: { each: '${each}' } } },
      ],
    };
    const executor = new FlowExecutor(
      flow,
      handlerFor(
        {
          items: () => [1, 2, 3],
          mark: (params) => `marked-${params.item}`,
          done: () => 'done-ok',
        },
        calls,
      ),
      { logger: testLogger },
    );
    const events = trackEvents(executor);

    const results = await executor.execute();

    // Every iteration ran its head, hit the stop, skipped its tail, and the
    // loop moved on; the flow then finished normally.
    expect(calls.filter((c) => c === 'mark').length).toBe(3);
    expect(calls).not.toContain('tail');
    expect(calls).toContain('done');
    expect(results.get('done')).toMatchObject({ result: 'done-ok' });

    const ofType = (type: string) => events.filter((e) => e.type === type);
    expect(ofType(FlowEventType.FLOW_COMPLETE).length).toBe(1);
    expect(ofType(FlowEventType.FLOW_ABORTED).length).toBe(0);
    expect(ofType(FlowEventType.STEP_ERROR).length).toBe(0);

    const skips = ofType(FlowEventType.STEP_SKIP).filter((e) => e.payload.stepName === 'tail');
    expect(skips.length).toBe(3);
    for (const skip of skips) {
      expect(skip.payload.reason).toContain('halt');
    }
  });

  it('treats a bare stop as the whole loop.step body by ending the iteration', async () => {
    const calls: string[] = [];
    const flow: Flow = {
      name: 'stop-loop-step',
      description: 'bare stop as single loop step',
      steps: [
        { name: 'items', request: { method: 'items', params: {} } },
        {
          name: 'each',
          loop: {
            over: '${items.result}',
            as: 'item',
            step: { name: 'halt', stop: {} },
          },
        },
        { name: 'done', request: { method: 'done', params: { each: '${each}' } } },
      ],
    };
    const executor = new FlowExecutor(
      flow,
      handlerFor({ items: () => [1, 2], done: () => 'done-ok' }, calls),
      { logger: testLogger },
    );
    const events = trackEvents(executor);

    const results = await executor.execute();

    expect(calls).toEqual(['items', 'done']);
    expect(results.get('done')).toMatchObject({ result: 'done-ok' });
    expect(events.filter((e) => e.type === FlowEventType.FLOW_COMPLETE).length).toBe(1);
    expect(events.filter((e) => e.type === FlowEventType.STEP_ERROR).length).toBe(0);
  });

  it('propagates a stop from a condition branch as a graceful early exit', async () => {
    const calls: string[] = [];
    const flow: Flow = {
      name: 'stop-then-branch',
      description: 'bare stop in then branch of top-level condition',
      steps: [
        { name: 'flag', request: { method: 'flag', params: {} } },
        {
          name: 'maybe',
          condition: {
            if: '${flag.result}',
            then: { name: 'halt', stop: {} },
          },
        },
        { name: 'after', request: { method: 'after', params: { maybe: '${maybe}' } } },
      ],
    };
    const executor = new FlowExecutor(
      flow,
      handlerFor({ flag: () => true, after: () => 'after-ok' }, calls),
      { logger: testLogger },
    );
    const events = trackEvents(executor);

    const results = await executor.execute();

    // The stop terminated the branch inside `maybe`; `maybe` itself produced
    // no result and is reported as skipped, along with everything after it.
    expect(calls).toEqual(['flag']);
    expect(results.has('maybe')).toBe(false);
    expect(results.has('after')).toBe(false);

    const ofType = (type: string) => events.filter((e) => e.type === type);
    expect(ofType(FlowEventType.FLOW_COMPLETE).length).toBe(1);
    expect(ofType(FlowEventType.FLOW_ABORTED).length).toBe(0);
    expect(ofType(FlowEventType.STEP_ERROR).length).toBe(0);
    expect(
      ofType(FlowEventType.STEP_COMPLETE).filter((e) => e.payload.stepName === 'halt').length,
    ).toBe(1);
    const skippedNames = ofType(FlowEventType.STEP_SKIP)
      .map((e) => e.payload.stepName)
      .sort();
    expect(skippedNames).toEqual(['after', 'maybe']);
  });

  it('propagates a stop from a condition nested in a loop body without failing the iteration', async () => {
    const calls: string[] = [];
    const flow: Flow = {
      name: 'stop-nested-condition-loop',
      description: 'bare stop in then branch of a condition inside a loop body',
      steps: [
        { name: 'items', request: { method: 'items', params: {} } },
        {
          name: 'each',
          loop: {
            over: '${items.result}',
            as: 'item',
            steps: [
              {
                name: 'maybe',
                condition: {
                  if: '${item} > 1',
                  then: { name: 'halt', stop: {} },
                },
              },
              { name: 'tail', request: { method: 'tail', params: { item: '${item}' } } },
            ],
          },
        },
        { name: 'done', request: { method: 'done', params: { each: '${each}' } } },
      ],
    };
    const executor = new FlowExecutor(
      flow,
      handlerFor(
        {
          items: () => [1, 2],
          tail: (params) => `tail-${params.item}`,
          done: () => 'done-ok',
        },
        calls,
      ),
      { logger: testLogger },
    );
    const events = trackEvents(executor);

    const results = await executor.execute();

    // Iteration 1: condition false, tail runs. Iteration 2: the stop fires
    // inside the condition's branch, terminating the rest of the iteration.
    expect(calls.filter((c) => c === 'tail').length).toBe(1);
    expect(calls).toContain('done');
    expect(results.get('done')).toMatchObject({ result: 'done-ok' });

    const ofType = (type: string) => events.filter((e) => e.type === type);
    expect(ofType(FlowEventType.FLOW_COMPLETE).length).toBe(1);
    expect(ofType(FlowEventType.STEP_ERROR).length).toBe(0);
    const tailSkips = ofType(FlowEventType.STEP_SKIP).filter((e) => e.payload.stepName === 'tail');
    expect(tailSkips.length).toBe(1);
  });

  it('still propagates non-stop errors from switch cases as failures', async () => {
    const calls: string[] = [];
    const flow: Flow = {
      name: 'stop-case-error',
      description: 'regular error in switch case',
      steps: [
        { name: 'pick', request: { method: 'pick', params: {} } },
        {
          name: 'route',
          condition: {
            switch: '${pick.result}',
            cases: {
              x: [{ name: 'boom', request: { method: 'boom', params: {} } }],
            },
          },
        },
      ],
    };
    const executor = new FlowExecutor(
      flow,
      handlerFor(
        {
          pick: () => 'x',
          boom: () => {
            throw new Error('boom');
          },
        },
        calls,
      ),
      { logger: testLogger },
    );

    await expect(executor.execute()).rejects.toThrow('boom');
  });

  it('leaves endWorkflow: true behavior unchanged (aborts the flow)', async () => {
    const calls: string[] = [];
    const flow: Flow = {
      name: 'stop-end-workflow',
      description: 'endWorkflow still aborts',
      steps: [
        { name: 'a', request: { method: 'a', params: {} } },
        { name: 'halt', stop: { endWorkflow: true } },
        { name: 'b', request: { method: 'b', params: { after: '${halt.result}' } } },
      ],
    };
    const executor = new FlowExecutor(flow, handlerFor({ a: () => 'a-ok' }, calls), {
      logger: testLogger,
    });
    const events = trackEvents(executor);

    await executor.execute();

    expect(calls).toEqual(['a']);
    const ofType = (type: string) => events.filter((e) => e.type === type);
    expect(ofType(FlowEventType.FLOW_ABORTED).length).toBe(1);
    expect(ofType(FlowEventType.STEP_SKIP).map((e) => e.payload.stepName)).toEqual(['b']);
  });

  it('still propagates non-stop errors from loop bodies as failures', async () => {
    const calls: string[] = [];
    const flow: Flow = {
      name: 'stop-loop-body-error',
      description: 'regular error in loop body sequence',
      steps: [
        { name: 'items', request: { method: 'items', params: {} } },
        {
          name: 'each',
          loop: {
            over: '${items.result}',
            as: 'item',
            steps: [
              {
                name: 'boom',
                request: { method: 'boom', params: { item: '${item}' } },
              },
            ],
          },
        },
      ],
    };
    const executor = new FlowExecutor(
      flow,
      handlerFor(
        {
          items: () => [1],
          boom: () => {
            throw new Error('boom');
          },
        },
        calls,
      ),
      { logger: testLogger },
    );

    await expect(executor.execute()).rejects.toThrow('boom');
  });

  it('never treats the StopBranch signal as a retryable failure', async () => {
    const policy: RetryPolicy = {
      maxAttempts: 3,
      backoff: { initial: 1, multiplier: 1, maxDelay: 5 },
      retryableErrors: [ErrorCode.NETWORK_ERROR, ErrorCode.TIMEOUT_ERROR],
    };
    const signal = new StopBranch('halt', {
      type: 'stop',
      result: { endWorkflow: false },
      metadata: {},
    } as any);
    let attempts = 0;
    const operation = new RetryableOperation(
      () => {
        attempts += 1;
        return Promise.reject(signal);
      },
      policy,
      testLogger,
    );

    await expect(operation.execute()).rejects.toBe(signal);
    expect(attempts).toBe(1);
  });
});
