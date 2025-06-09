import { FlowExecutor } from '../flow-executor';
import { Flow } from '../types';
import { FlowEventType } from '../util/flow-executor-events';
import { TestLogger } from '../util/logger';

describe('FlowExecutor event emission', () => {
  let jsonRpcHandler: jest.Mock;
  let testLogger: TestLogger;

  beforeEach(() => {
    jsonRpcHandler = jest.fn().mockResolvedValue({ result: 'ok' });
    testLogger = new TestLogger('EventEmissionTest');
  });

  it('emits all major events during successful flow execution', async () => {
    const flow: Flow = {
      name: 'EventTestFlow',
      description: 'A flow to test event emission',
      steps: [
        {
          name: 'step1',
          request: { method: 'foo', params: {} },
        },
        {
          name: 'step2',
          request: { method: 'bar', params: {} },
        },
      ],
    };

    const executor = new FlowExecutor(flow, jsonRpcHandler, {
      logger: testLogger,
      eventOptions: { emitDependencyEvents: true },
    });
    const events: { type: string; payload: any }[] = [];
    const fevents = executor.events;

    // Listen to all event types
    fevents.on(FlowEventType.FLOW_START, (payload) =>
      events.push({ type: FlowEventType.FLOW_START, payload }),
    );
    fevents.on(FlowEventType.FLOW_COMPLETE, (payload) =>
      events.push({ type: FlowEventType.FLOW_COMPLETE, payload }),
    );
    fevents.on(FlowEventType.FLOW_ERROR, (payload) =>
      events.push({ type: FlowEventType.FLOW_ERROR, payload }),
    );
    fevents.on(FlowEventType.STEP_START, (payload) =>
      events.push({ type: FlowEventType.STEP_START, payload }),
    );
    fevents.on(FlowEventType.STEP_COMPLETE, (payload) =>
      events.push({ type: FlowEventType.STEP_COMPLETE, payload }),
    );
    fevents.on(FlowEventType.STEP_ERROR, (payload) =>
      events.push({ type: FlowEventType.STEP_ERROR, payload }),
    );
    fevents.on(FlowEventType.STEP_SKIP, (payload) =>
      events.push({ type: FlowEventType.STEP_SKIP, payload }),
    );
    fevents.on(FlowEventType.DEPENDENCY_RESOLVED, (payload) =>
      events.push({ type: FlowEventType.DEPENDENCY_RESOLVED, payload }),
    );

    await executor.execute();

    // Check for dependency resolved event
    expect(events.some((e) => e.type === FlowEventType.DEPENDENCY_RESOLVED)).toBe(true);
    // Check for flow start and complete
    expect(events.some((e) => e.type === FlowEventType.FLOW_START)).toBe(true);
    expect(events.some((e) => e.type === FlowEventType.FLOW_COMPLETE)).toBe(true);
    // Check for step start and complete for each step
    const stepStartEvents = events.filter((e) => e.type === FlowEventType.STEP_START);
    const stepCompleteEvents = events.filter((e) => e.type === FlowEventType.STEP_COMPLETE);
    expect(stepStartEvents.length).toBe(2);
    expect(stepCompleteEvents.length).toBe(2);
    // No error or skip events expected
    expect(events.some((e) => e.type === FlowEventType.FLOW_ERROR)).toBe(false);
    expect(events.some((e) => e.type === FlowEventType.STEP_ERROR)).toBe(false);
    expect(events.some((e) => e.type === FlowEventType.STEP_SKIP)).toBe(false);
  });

  it('emits error events on step failure', async () => {
    const flow: Flow = {
      name: 'EventTestFlow',
      description: 'A flow to test event emission',
      steps: [
        {
          name: 'failStep',
          request: { method: 'fail', params: {} },
        },
      ],
    };
    jsonRpcHandler.mockRejectedValueOnce(new Error('fail!'));
    const executor = new FlowExecutor(flow, jsonRpcHandler, { logger: testLogger });
    const events: { type: string; payload: any }[] = [];
    const fevents = executor.events;
    fevents.on(FlowEventType.STEP_ERROR, (payload) =>
      events.push({ type: FlowEventType.STEP_ERROR, payload }),
    );
    fevents.on(FlowEventType.FLOW_ERROR, (payload) =>
      events.push({ type: FlowEventType.FLOW_ERROR, payload }),
    );
    await expect(executor.execute()).rejects.toThrow('fail!');
    expect(events.some((e) => e.type === FlowEventType.STEP_ERROR)).toBe(true);
    expect(events.some((e) => e.type === FlowEventType.FLOW_ERROR)).toBe(true);
  });

  it('emits step skip and flow complete if a stop step is encountered', async () => {
    const flow: Flow = {
      name: 'EventTestFlow',
      description: 'A flow to test event emission',
      steps: [
        {
          name: 'stopStep',
          stop: { endWorkflow: true },
        },
        {
          name: 'shouldNotRun',
          request: { method: 'foo', params: {} },
        },
      ],
    };
    const executor = new FlowExecutor(flow, jsonRpcHandler, { logger: testLogger });
    const events: { type: string; payload: any }[] = [];
    const fevents = executor.events;
    fevents.on(FlowEventType.STEP_SKIP, (payload) =>
      events.push({ type: FlowEventType.STEP_SKIP, payload }),
    );
    fevents.on(FlowEventType.FLOW_COMPLETE, (payload) =>
      events.push({ type: FlowEventType.FLOW_COMPLETE, payload }),
    );
    fevents.on(FlowEventType.FLOW_ABORTED, (payload) =>
      events.push({ type: FlowEventType.FLOW_ABORTED, payload }),
    );
    await executor.execute();
    // Should emit a skip for the second step
    expect(events.some((e) => e.type === FlowEventType.STEP_SKIP)).toBe(true);
    expect(events.some((e) => e.type === FlowEventType.FLOW_COMPLETE)).toBe(true);
    expect(events.some((e) => e.type === FlowEventType.FLOW_ABORTED)).toBe(true);
  });

  it('emits step aborted when a step receives an aborted signal', async () => {
    const flow: Flow = {
      name: 'AbortFlow',
      description: 'flow',
      steps: [
        {
          name: 'transform',
          transform: {
            input: [1, 2],
            operations: [{ type: 'map', using: '${item}' }],
          },
        },
      ],
    };
    const executor = new FlowExecutor(flow, jsonRpcHandler, { logger: testLogger });
    const events: any[] = [];
    executor.events.on(FlowEventType.STEP_ABORTED, (p) => events.push(p));
    const ac = new AbortController();
    ac.abort();
    await expect(executor['executeStep'](flow.steps[0], {}, ac.signal)).rejects.toThrow();
    expect(events.length).toBe(1);
    expect(events[0].stepName).toBe('transform');
  });

  it('emits abort events when flow is aborted before execution', async () => {
    const flow: Flow = {
      name: 'PreAbort',
      description: 'flow',
      steps: [{ name: 's', request: { method: 'foo', params: {} } }],
    };
    const executor = new FlowExecutor(flow, jsonRpcHandler, { logger: testLogger });
    executor['globalAbortController'].abort('pre');
    const events: any[] = [];
    executor.events.on(FlowEventType.STEP_ABORTED, (p) => events.push({ t: 's', p }));
    executor.events.on(FlowEventType.FLOW_ABORTED, (p) => events.push({ t: 'f', p }));
    await expect(executor.execute()).rejects.toThrow();
    expect(events.some((e) => e.t === 's')).toBe(true);
    expect(events.some((e) => e.t === 'f')).toBe(true);
  });

  it('emits step progress events for loop steps', async () => {
    const flow: Flow = {
      name: 'ProgressFlow',
      description: 'progress test',
      steps: [
        {
          name: 'loopStep',
          loop: {
            over: '${context.items}',
            as: 'item',
            step: { name: 'inner', request: { method: 'foo', params: {} } },
          },
        },
      ],
      context: { items: [1, 2, 3] },
    };

    const executor = new FlowExecutor(flow, jsonRpcHandler, { logger: testLogger });
    const progress: any[] = [];
    executor.events.on(FlowEventType.STEP_PROGRESS, (p) => progress.push(p));

    await executor.execute();

    expect(progress.length).toBe(3);
    expect(progress[0].iteration).toBe(1);
    expect(progress[2].percent).toBe(100);
  });
});
