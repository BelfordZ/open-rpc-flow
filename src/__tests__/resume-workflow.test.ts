import { FlowExecutor } from '../flow-executor';
import { Flow } from '../types';
import { FlowEventType } from '../util/flow-executor-events';
import { TestLogger } from '../util/logger';
import { StepType } from '../step-executors/types';

describe('FlowExecutor resume capability', () => {
  it('skips already executed steps', async () => {
    const flow: Flow = {
      name: 'ResumeFlow',
      description: 'resume',
      steps: [
        { name: 's1', request: { method: 'a', params: {} } },
        { name: 's2', request: { method: 'b', params: {} } },
      ],
    };

    const handler = jest.fn().mockResolvedValue({ ok: true });

    const previous = new Map<string, any>();
    previous.set('s1', { type: StepType.Request, result: { ok: true }, metadata: {} });

    const executor = new FlowExecutor(flow, handler, new TestLogger('resume'), previous);

    const skips: any[] = [];
    executor.events.on(FlowEventType.STEP_SKIP, (e) => skips.push(e));

    const results = await executor.execute();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(skips.some((e) => e.stepName === 's1')).toBe(true);
    expect(results.get('s1').result).toEqual({ ok: true });
  });

  it('merges provided context', async () => {
    const flow: Flow = {
      name: 'CtxFlow',
      description: 'ctx',
      context: { foo: 'bar' },
      steps: [{ name: 's1', request: { method: 'a', params: { val: '${context.foo}' } } }],
    };

    const handler = jest.fn().mockResolvedValue({ ok: true });

    const executor = new FlowExecutor(flow, handler, new TestLogger('ctx'), undefined, {
      foo: 'baz',
    });

    await executor.execute();

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ params: { val: 'baz' } }),
      expect.anything(),
    );
  });
});
