import { FlowExecutor } from '../flow-executor';
import { Flow } from '../types';
import { FlowEventType } from '../util/flow-executor-events';
import { TestLogger } from '../util/logger';

describe('Flow abort behavior', () => {
  it('emits step skip when aborted before execution', async () => {
    const flow: Flow = {
      name: 'AbortFlow',
      description: 'abort',
      steps: [{ name: 's1', request: { method: 'foo', params: {} } }],
    };

    const handler = jest.fn().mockResolvedValue({ result: 'ok' });
    const executor = new FlowExecutor(flow, handler, { logger: new TestLogger('abort') });

    (executor as any).globalAbortController.abort('stop');

    const skips: any[] = [];
    executor.events.on(FlowEventType.STEP_SKIP, (e) => skips.push(e));

    await expect(executor.execute()).rejects.toThrow('stop');

    expect(skips.length).toBe(1);
    expect(typeof skips[0].correlationId).toBe('string');
  });
});
