import { FlowExecutor } from '../flow-executor';
import { Flow } from '../types';
import { TestLogger } from '../util/logger';
import { PauseError } from '../errors/base';

describe('FlowExecutor resume/retry/pause', () => {
  it('resumes after the last completed step', async () => {
    const flow: Flow = {
      name: 'resume-flow',
      description: 'resume test flow',
      steps: [
        { name: 'step1', request: { method: 'one', params: { value: 'a' } } },
        { name: 'step2', request: { method: 'two', params: { value: '${step1.result}' } } },
        { name: 'step3', request: { method: 'three', params: { value: '${step2.result}' } } },
      ],
    };

    const handler = jest.fn(async (request) => ({
      result: request.method,
      params: request.params,
    }));

    const executor = new FlowExecutor(flow, handler, {
      logger: new TestLogger('resume'),
    });

    executor.setStepResults({
      step1: { result: 'one' },
      step2: { result: 'two' },
    });

    await executor.resume();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].method).toBe('three');
    expect(handler.mock.calls[0][0].params).toEqual({ value: 'two' });
  });

  it('retries starting from the last failed step', async () => {
    const flow: Flow = {
      name: 'retry-flow',
      description: 'retry test flow',
      steps: [
        { name: 'step1', request: { method: 'one', params: { value: 'a' } } },
        { name: 'step2', request: { method: 'two', params: { value: '${step1.result}' } } },
      ],
    };

    let shouldFail = true;
    const handler = jest.fn(async (request) => {
      if (request.method === 'two' && shouldFail) {
        shouldFail = false;
        throw new Error('fail once');
      }
      return { result: request.method };
    });

    const executor = new FlowExecutor(flow, handler, {
      logger: new TestLogger('retry'),
    });

    await expect(executor.execute()).rejects.toThrow();

    const results = await executor.retry();

    const calledMethods = handler.mock.calls.map((call) => call[0].method);
    expect(calledMethods.filter((method) => method === 'one')).toHaveLength(1);
    expect(calledMethods.filter((method) => method === 'two')).toHaveLength(2);
    expect(results.get('step1')?.result).toEqual({ result: 'one' });
    expect(results.get('step2')?.result).toEqual({ result: 'two' });
  });

  it('pauses and resumes without re-running completed steps', async () => {
    const flow: Flow = {
      name: 'pause-flow',
      description: 'pause test flow',
      steps: [
        { name: 'step1', request: { method: 'one', params: { value: 'a' } } },
        { name: 'step2', request: { method: 'two', params: { value: 'b' } } },
      ],
    };

    let allowStep2Resolve = false;
    let step2StartedResolve: (() => void) | null = null;
    const step2Started = new Promise<void>((resolve) => {
      step2StartedResolve = resolve;
    });

    const handler = jest.fn((request, options) => {
      if (request.method === 'one') {
        return Promise.resolve({ result: 'one' });
      }
      if (request.method === 'two') {
        step2StartedResolve?.();
        if (allowStep2Resolve) {
          return Promise.resolve({ result: 'two' });
        }
        return new Promise((_, reject) => {
          options?.signal?.addEventListener('abort', () => {
            const error = new Error('aborted');
            (error as any).name = 'AbortError';
            reject(error);
          });
        });
      }
      return Promise.resolve(null);
    });

    const executor = new FlowExecutor(flow, handler, {
      logger: new TestLogger('pause'),
    });

    const executePromise = executor.execute();
    await step2Started;
    executor.pause();

    await expect(executePromise).rejects.toBeInstanceOf(PauseError);

    allowStep2Resolve = true;
    await executor.resume();

    const calledMethods = handler.mock.calls.map((call) => call[0].method);
    expect(calledMethods.filter((method) => method === 'one')).toHaveLength(1);
    expect(calledMethods.filter((method) => method === 'two')).toHaveLength(2);
  });

  it('updates context for subsequent executions', async () => {
    const flow: Flow = {
      name: 'context-flow',
      description: 'context test flow',
      steps: [
        {
          name: 'step1',
          request: { method: 'one', params: { value: '${context.foo}' } },
        },
      ],
    };

    const handler = jest.fn(async (request) => ({ result: request.params }));

    const executor = new FlowExecutor(flow, handler, {
      logger: new TestLogger('context'),
    });

    executor.setContext({ foo: 123 });
    await executor.execute();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].params).toEqual({ value: 123 });
  });

  it('validates context input', () => {
    const flow: Flow = {
      name: 'context-validate-flow',
      description: 'context validation',
      steps: [{ name: 'step1', request: { method: 'one', params: {} } }],
    };

    const executor = new FlowExecutor(flow, jest.fn(), {
      logger: new TestLogger('context-validate'),
    });

    expect(() => executor.setContext(null as any)).toThrow('Context must be a non-null object');
  });

  it('validates step results for unknown steps', () => {
    const flow: Flow = {
      name: 'results-validate-flow',
      description: 'results validation',
      steps: [{ name: 'step1', request: { method: 'one', params: {} } }],
    };

    const executor = new FlowExecutor(flow, jest.fn(), {
      logger: new TestLogger('results-validate'),
    });

    expect(() => executor.setStepResults({ missing: 'value' })).toThrow(
      'Unknown step name in step results',
    );
  });

  it('accepts step results as a Map', async () => {
    const flow: Flow = {
      name: 'results-map-flow',
      description: 'results map validation',
      steps: [
        { name: 'step1', request: { method: 'one', params: {} } },
        { name: 'step2', request: { method: 'two', params: { value: '${step1.result}' } } },
      ],
    };

    const handler = jest.fn(async (request) => ({ result: request.method }));
    const executor = new FlowExecutor(flow, handler, {
      logger: new TestLogger('results-map'),
    });

    const results = new Map<string, unknown>([['step1', { result: 'one' }]]);
    executor.setStepResults(results);

    await executor.resume();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].method).toBe('two');
  });

  it('honors an abort signal provided to execute', async () => {
    const flow: Flow = {
      name: 'signal-flow',
      description: 'signal validation',
      steps: [{ name: 'step1', request: { method: 'one', params: {} } }],
    };

    const handler = jest.fn((_request, options) => {
      return new Promise((_, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new Error('stopped')));
      });
    });

    const executor = new FlowExecutor(flow, handler, {
      logger: new TestLogger('signal'),
    });

    const controller = new AbortController();
    const promise = executor.execute({ signal: controller.signal });
    controller.abort('stopped');

    await expect(promise).rejects.toThrow('stopped');
  });

  it('returns early when pausing an already aborted flow', () => {
    const flow: Flow = {
      name: 'pause-aborted-flow',
      description: 'pause validation',
      steps: [{ name: 'step1', request: { method: 'one', params: {} } }],
    };

    const executor = new FlowExecutor(flow, jest.fn(), {
      logger: new TestLogger('pause-aborted'),
    });

    (executor as any).globalAbortController.abort('already');

    expect(() => executor.pause()).not.toThrow();
  });

  it('throws PauseError when paused before execution starts', async () => {
    const flow: Flow = {
      name: 'paused-before-start',
      description: 'pause before execute',
      steps: [{ name: 'step1', request: { method: 'one', params: {} } }],
    };

    const executor = new FlowExecutor(flow, jest.fn(), {
      logger: new TestLogger('pause-before'),
    });

    executor.pause();

    await expect(executor.execute()).rejects.toBeInstanceOf(PauseError);
  });

  it('throws when retry is called without a failed step', async () => {
    const flow: Flow = {
      name: 'retry-missing-flow',
      description: 'retry validation',
      steps: [{ name: 'step1', request: { method: 'one', params: {} } }],
    };

    const executor = new FlowExecutor(flow, jest.fn(), {
      logger: new TestLogger('retry-missing'),
    });

    await expect(executor.retry()).rejects.toThrow('No failed step to retry');
  });

  it('throws when the failed step is not part of the flow', async () => {
    const flow: Flow = {
      name: 'retry-unknown-flow',
      description: 'retry validation',
      steps: [{ name: 'step1', request: { method: 'one', params: {} } }],
    };

    const executor = new FlowExecutor(flow, jest.fn(), {
      logger: new TestLogger('retry-unknown'),
    });

    (executor as any).lastFailedStepName = 'missing';

    await expect(executor.retry()).rejects.toThrow('Failed step not found in flow');
  });

  it('derives failed steps from status when retrying', async () => {
    const flow: Flow = {
      name: 'retry-status-flow',
      description: 'retry status validation',
      steps: [
        { name: 'step1', request: { method: 'one', params: {} } },
        { name: 'step2', request: { method: 'two', params: { value: '${step1.result}' } } },
      ],
    };

    const handler = jest.fn(async (request) => ({ result: request.method }));

    const executor = new FlowExecutor(flow, handler, {
      logger: new TestLogger('retry-status'),
    });

    (executor as any).stepResults.set('step1', { result: 'one' });
    (executor as any).stepStatus.set('step2', { status: 'failed' });

    await executor.retry();

    const calledMethods = handler.mock.calls.map((call) => call[0].method);
    expect(calledMethods.filter((method) => method === 'one')).toHaveLength(0);
    expect(calledMethods.filter((method) => method === 'two')).toHaveLength(1);
  });

  it('clears the failed step marker when a step succeeds', async () => {
    const flow: Flow = {
      name: 'clear-failed-flow',
      description: 'clear failed validation',
      steps: [{ name: 'step1', request: { method: 'one', params: {} } }],
    };

    const executor = new FlowExecutor(
      flow,
      jest.fn(async () => ({ result: 'ok' })),
      {
        logger: new TestLogger('clear-failed'),
      },
    );

    (executor as any).lastFailedStepName = 'step1';

    await executor.resume();

    await expect(executor.retry()).rejects.toThrow('No failed step to retry');
  });

  it('fills step status from existing results before resuming', async () => {
    const flow: Flow = {
      name: 'resume-status-flow',
      description: 'resume status validation',
      steps: [
        { name: 'step1', request: { method: 'one', params: {} } },
        { name: 'step2', request: { method: 'two', params: {} } },
      ],
    };

    const handler = jest.fn(async (request) => ({ result: request.method }));
    const executor = new FlowExecutor(flow, handler, {
      logger: new TestLogger('resume-status'),
    });

    (executor as any).stepResults.set('step1', { result: 'one' });

    await executor.resume();

    const calledMethods = handler.mock.calls.map((call) => call[0].method);
    expect(calledMethods).toEqual(['two']);
  });

  it('resumes from a specific step while clearing downstream results', async () => {
    const flow: Flow = {
      name: 'resume-from-flow',
      description: 'resume from step validation',
      steps: [
        { name: 'step1', request: { method: 'one', params: {} } },
        { name: 'step2', request: { method: 'two', params: { value: '${step1.result}' } } },
        { name: 'step3', request: { method: 'three', params: { value: '${step2.result}' } } },
      ],
    };

    const handler = jest.fn(async (request) => ({ result: request.method }));
    const executor = new FlowExecutor(flow, handler, {
      logger: new TestLogger('resume-from'),
    });

    executor.setStepResults({
      step1: { result: 'one' },
      step2: { result: 'two-stale' },
      step3: { result: 'three-stale' },
    });

    const results = await executor.resumeFrom('step2');

    const calledMethods = handler.mock.calls.map((call) => call[0].method);
    expect(calledMethods).toEqual(['two', 'three']);
    expect(results.get('step1')).toEqual({ result: 'one' });
    expect((results.get('step2') as any)?.result).toEqual({ result: 'two' });
    expect((results.get('step3') as any)?.result).toEqual({ result: 'three' });
  });

  it('throws when resumeFrom step is not part of the flow', async () => {
    const flow: Flow = {
      name: 'resume-from-unknown-flow',
      description: 'resume from unknown step validation',
      steps: [{ name: 'step1', request: { method: 'one', params: {} } }],
    };

    const executor = new FlowExecutor(flow, jest.fn(), {
      logger: new TestLogger('resume-from-unknown'),
    });

    await expect(executor.resumeFrom('missing')).rejects.toThrow('Step not found in flow');
  });
});
