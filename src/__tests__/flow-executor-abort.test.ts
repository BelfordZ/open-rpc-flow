import { FlowExecutor } from '../flow-executor';
import { Flow } from '../types';
import { TestLogger } from '../util/logger';
import { TimeoutError } from '../errors/timeout-error';

describe('FlowExecutor abort handling', () => {
  it('skips steps when aborted before execution', async () => {
    const flow: Flow = {
      name: 'Abort Flow',
      description: '',
      steps: [{ name: 'a', request: { method: 'm', params: [] } }],
    };
    const executor = new FlowExecutor(flow, jest.fn(), { logger: new TestLogger('abort') });
    (executor as any).globalAbortController.abort('manual abort');
    await expect(executor.execute()).rejects.toThrow('manual abort');
  });

  it('wraps timeout abort reason in TimeoutError', async () => {
    const flow: Flow = {
      name: 'Timeout Abort Flow',
      description: '',
      steps: [{ name: 'a', request: { method: 'm', params: [] } }],
    };
    const executor = new FlowExecutor(flow, jest.fn(), { logger: new TestLogger('abort') });
    const step = { name: 'a', request: { method: 'm', params: [] } } as any;
    (executor as any).globalAbortController.abort(new TimeoutError('timeout abort', 10, 0, step));
    await expect(executor.execute()).rejects.toThrow(TimeoutError);
  });
});
