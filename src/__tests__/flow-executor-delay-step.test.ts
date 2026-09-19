import { FlowExecutor, FlowEventType } from '../index';
import { Flow } from '../types';
import { TestLogger } from '../util/logger';
import { StepType } from '../step-executors';

/**
 * Regression tests for issue #145: the DelayStepExecutor was never registered
 * in FlowExecutor.rebuildStepExecutors(), so any flow containing a delay step
 * failed with "No executor found for step <name>".
 */
describe('FlowExecutor delay step (issue #145)', () => {
  const makeExecutor = (flow: Flow, handler: jest.Mock) =>
    new FlowExecutor(flow, handler, { logger: new TestLogger('DelayStepTest') });

  const delayFlow = (duration: number): Flow => ({
    name: 'Delay Flow',
    description: 'flow with a delay step',
    steps: [
      {
        name: 'waitThenCall',
        delay: {
          duration,
          step: { name: 'inner', request: { method: 'getData', params: {} } },
        },
      } as any,
    ],
  });

  it('registers the delay executor so delay steps run end-to-end', async () => {
    const jsonRpcHandler = jest.fn().mockResolvedValue({ ok: true });
    const executor = makeExecutor(delayFlow(5), jsonRpcHandler);

    const results = await executor.execute();

    expect(jsonRpcHandler).toHaveBeenCalledTimes(1);
    expect(jsonRpcHandler).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'getData' }),
      expect.anything(),
    );
    expect(results.has('waitThenCall')).toBe(true);
  });

  it('stores the delay step result wrapping the nested step result', async () => {
    const jsonRpcHandler = jest.fn().mockResolvedValue({ value: 42 });
    const executor = makeExecutor(delayFlow(5), jsonRpcHandler);

    const results = await executor.execute();

    const delayResult: any = results.get('waitThenCall');
    expect(delayResult.type).toBe(StepType.Delay);
    expect(delayResult.result.result).toEqual({ value: 42 });
    expect(delayResult.metadata.duration).toBe(5);
  });

  it('honors the delay duration before running the nested step', async () => {
    const jsonRpcHandler = jest.fn().mockResolvedValue({ ok: true });
    const executor = makeExecutor(delayFlow(50), jsonRpcHandler);

    const start = Date.now();
    await executor.execute();
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(45);
  });

  it('lets dependent steps consume the delay step result', async () => {
    const jsonRpcHandler = jest.fn().mockResolvedValue({ value: 7 });
    const flow: Flow = {
      name: 'Dependent Flow',
      description: 'consumer of a delay step result',
      steps: [
        {
          name: 'waitThenCall',
          delay: {
            duration: 5,
            step: { name: 'inner', request: { method: 'getData', params: {} } },
          },
        } as any,
        {
          name: 'consumer',
          request: {
            method: 'useData',
            params: { answer: '${waitThenCall.result.result.value}' },
          },
        },
      ],
    };
    const executor = makeExecutor(flow, jsonRpcHandler);

    await executor.execute();

    expect(jsonRpcHandler).toHaveBeenCalledTimes(2);
    expect(jsonRpcHandler).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ params: { answer: 7 } }),
      expect.anything(),
    );
  });

  it('emits step:start and step:complete for the delay step and its nested step', async () => {
    const jsonRpcHandler = jest.fn().mockResolvedValue({ ok: true });
    const executor = makeExecutor(delayFlow(5), jsonRpcHandler);

    const events: Array<{ type: string; stepName?: string }> = [];
    for (const type of [FlowEventType.STEP_START, FlowEventType.STEP_COMPLETE]) {
      executor.events.on(type, (data: any) => {
        events.push({ type, stepName: data?.stepName });
      });
    }

    await executor.execute();

    const starts = events.filter((e) => e.type === FlowEventType.STEP_START);
    const completes = events.filter((e) => e.type === FlowEventType.STEP_COMPLETE);
    expect(starts.map((e) => e.stepName)).toEqual(
      expect.arrayContaining(['waitThenCall', 'inner']),
    );
    expect(completes.map((e) => e.stepName)).toEqual(
      expect.arrayContaining(['waitThenCall', 'inner']),
    );
  });
});
