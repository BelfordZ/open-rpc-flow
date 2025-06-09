import { FlowExecutor } from '../flow-executor';
import { Flow } from '../types';
import { FlowEventType } from '../util/flow-executor-events';
import { TestLogger } from '../util/logger';

describe('Correlation ID and metadata propagation', () => {
  it('includes correlationId and step metadata in events', async () => {
    const flow: Flow = {
      name: 'CorrelationFlow',
      description: 'flow',
      steps: [
        {
          name: 'step1',
          request: { method: 'foo', params: {} },
          metadata: { tag: 'a' },
        },
        {
          name: 'step2',
          request: { method: 'bar', params: {} },
          metadata: { tag: 'b' },
        },
      ],
    };

    const handler = jest.fn().mockResolvedValue({ result: 'ok' });
    const logger = new TestLogger('cid');
    const executor = new FlowExecutor(flow, handler, {
      logger,
      eventOptions: { includeContext: true },
    });

    const starts: any[] = [];
    const completes: any[] = [];

    executor.events.on(FlowEventType.STEP_START, (e) => starts.push(e));
    executor.events.on(FlowEventType.STEP_COMPLETE, (e) => completes.push(e));

    await executor.execute();

    expect(starts.length).toBe(2);
    expect(completes.length).toBe(2);

    for (let i = 0; i < 2; i++) {
      expect(typeof starts[i].correlationId).toBe('string');
      expect(completes[i].correlationId).toBe(starts[i].correlationId);
      expect(starts[i].metadata.tag).toBe(i === 0 ? 'a' : 'b');
    }

    expect(starts[0].correlationId).not.toBe(starts[1].correlationId);
  });
});
