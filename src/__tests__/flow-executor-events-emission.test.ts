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
    fevents.on(FlowEventType.FLOW_FINISH, (payload) =>
      events.push({ type: FlowEventType.FLOW_FINISH, payload }),
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
    expect(events.some((e) => e.type === FlowEventType.FLOW_FINISH)).toBe(true);
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
    fevents.on(FlowEventType.FLOW_FINISH, (payload) =>
      events.push({ type: FlowEventType.FLOW_FINISH, payload }),
    );
    await expect(executor.execute()).rejects.toThrow('fail!');
    expect(events.some((e) => e.type === FlowEventType.STEP_ERROR)).toBe(true);
    expect(events.some((e) => e.type === FlowEventType.FLOW_ERROR)).toBe(true);
    expect(events.some((e) => e.type === FlowEventType.FLOW_FINISH)).toBe(true);
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
    fevents.on(FlowEventType.FLOW_FINISH, (payload) =>
      events.push({ type: FlowEventType.FLOW_FINISH, payload }),
    );
    await executor.execute();
    // Should emit a skip for the second step
    expect(events.some((e) => e.type === FlowEventType.STEP_SKIP)).toBe(true);
    expect(events.some((e) => e.type === FlowEventType.FLOW_COMPLETE)).toBe(true);
    expect(events.some((e) => e.type === FlowEventType.FLOW_FINISH)).toBe(true);
  });
});
