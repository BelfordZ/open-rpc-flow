import { FlowExecutor } from '../../flow-executor';
import { flow as eventEmitterFlow } from '../../examples/event-emitter-example';
import { FlowEventType } from '../../util/flow-executor-events';

describe('Event Emitter Example', () => {
  test('executes the example flow and emits events', async () => {
    const handler = jest.fn().mockImplementation((req) => {
      if (req.method === 'echoMany') {
        return [{ data: req.params.message }];
      }
      if (req.method === 'echo') {
        return { data: req.params.message };
      }
      throw new Error(`Unknown method: ${req.method}`);
    });

    const executor = new FlowExecutor(eventEmitterFlow, handler);
    const emitted: FlowEventType[] = [];
    executor.events.on(FlowEventType.STEP_COMPLETE, (evt) => emitted.push(evt.type));

    const results = await executor.execute();

    expect(results.get('step3').result).toEqual([{ data: 'Hello! World!' }]);
    expect(emitted).toContain(FlowEventType.STEP_COMPLETE);
  });
});
