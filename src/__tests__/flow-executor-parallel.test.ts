import { FlowExecutor } from '../flow-executor';
import { Flow } from '../types';
import { TestLogger } from '../util/logger';
import { ExecutionError } from '../errors/base';

const waitFor = async (
  predicate: () => boolean,
  timeoutMs = 1000,
  intervalMs = 5,
): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
};

describe('FlowExecutor parallel execution', () => {
  it('executes independent steps concurrently by default', async () => {
    const flow: Flow = {
      name: 'parallel-flow',
      description: 'parallel steps',
      steps: [
        { name: 'stepA', request: { method: 'a', params: {} } },
        { name: 'stepB', request: { method: 'b', params: {} } },
      ],
    };

    const started: string[] = [];
    const resolvers = new Map<string, (value: any) => void>();
    const jsonRpcHandler = jest.fn((request) => {
      started.push(request.method);
      return new Promise((resolve) => {
        resolvers.set(request.method, resolve);
      });
    });

    const executor = new FlowExecutor(flow, jsonRpcHandler, new TestLogger('parallel'));
    const execPromise = executor.execute();

    await waitFor(() => started.length === 2);

    resolvers.get('a')?.({ result: 'a' });
    resolvers.get('b')?.({ result: 'b' });

    await execPromise;

    expect(started).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('honors maxConcurrency when configured', async () => {
    const flow: Flow = {
      name: 'limited-parallel-flow',
      description: 'limited parallel steps',
      policies: {
        global: {
          execution: {
            maxConcurrency: 1,
          },
        },
      },
      steps: [
        { name: 'stepA', request: { method: 'a', params: {} } },
        { name: 'stepB', request: { method: 'b', params: {} } },
      ],
    };

    const started: string[] = [];
    const resolvers = new Map<string, (value: any) => void>();
    const jsonRpcHandler = jest.fn((request) => {
      started.push(request.method);
      return new Promise((resolve) => {
        resolvers.set(request.method, resolve);
      });
    });

    const executor = new FlowExecutor(flow, jsonRpcHandler, new TestLogger('parallel-limit'));
    const execPromise = executor.execute();

    await waitFor(() => started.length === 1);
    expect(started).toEqual(['a']);

    resolvers.get('a')?.({ result: 'a' });
    await waitFor(() => started.length === 2);
    resolvers.get('b')?.({ result: 'b' });

    await execPromise;
  });

  it('continues independent branches when a step fails', async () => {
    const flow: Flow = {
      name: 'branch-fail-flow',
      description: 'branch failure behavior',
      steps: [
        { name: 'stepA', request: { method: 'a', params: {} } },
        {
          name: 'stepB',
          request: { method: 'b', params: { value: '${stepA.result}' } },
        },
        { name: 'stepC', request: { method: 'c', params: {} } },
      ],
    };

    const jsonRpcHandler = jest.fn((request) => {
      if (request.method === 'a') {
        return Promise.reject(new Error('fail A'));
      }
      return Promise.resolve({ result: request.method });
    });

    const executor = new FlowExecutor(flow, jsonRpcHandler, new TestLogger('branch-fail'));

    await expect(executor.execute()).rejects.toThrow('fail A');

    expect(jsonRpcHandler).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'c' }),
      expect.anything(),
    );
    expect(jsonRpcHandler).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'b' }),
      expect.anything(),
    );
  });

  it('aborts remaining steps when configured to abort-flow', async () => {
    const flow: Flow = {
      name: 'abort-flow',
      description: 'abort on failure',
      policies: {
        global: {
          execution: {
            maxConcurrency: 1,
            onFailure: 'abort-flow',
          },
        },
      },
      steps: [
        { name: 'stepA', request: { method: 'a', params: {} } },
        { name: 'stepB', request: { method: 'b', params: {} } },
      ],
    };

    const jsonRpcHandler = jest.fn((request) => {
      if (request.method === 'a') {
        return Promise.reject(new Error('fail A'));
      }
      return Promise.resolve({ result: request.method });
    });

    const executor = new FlowExecutor(flow, jsonRpcHandler, new TestLogger('abort-flow'));

    await expect(executor.execute()).rejects.toThrow('fail A');

    expect(jsonRpcHandler).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'b' }),
      expect.anything(),
    );
  });

  it('skips pending steps when a running step aborts the flow', async () => {
    const flow: Flow = {
      name: 'manual-abort-flow',
      description: 'manual abort after first step',
      policies: {
        global: {
          execution: {
            maxConcurrency: 1,
          },
        },
      },
      steps: [
        { name: 'stepA', request: { method: 'a', params: {} } },
        { name: 'stepB', request: { method: 'b', params: {} } },
      ],
    };

    let executor: FlowExecutor;
    const jsonRpcHandler = jest.fn((request) => {
      if (request.method === 'a') {
        executor['globalAbortController'].abort('manual abort');
        return Promise.resolve({ result: 'a' });
      }
      return Promise.resolve({ result: 'b' });
    });

    executor = new FlowExecutor(flow, jsonRpcHandler, new TestLogger('manual-abort'));

    await expect(executor.execute()).rejects.toThrow('manual abort');

    expect(jsonRpcHandler).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'b' }),
      expect.anything(),
    );
  });

  it('throws an ExecutionError when multiple steps fail', async () => {
    const flow: Flow = {
      name: 'multi-fail-flow',
      description: 'multiple failures',
      steps: [
        { name: 'stepA', request: { method: 'a', params: {} } },
        { name: 'stepB', request: { method: 'b', params: {} } },
        {
          name: 'stepC',
          request: {
            method: 'c',
            params: { a: '${stepA.result}', b: '${stepB.result}' },
          },
        },
      ],
    };

    const jsonRpcHandler = jest.fn((request) => {
      if (request.method === 'a' || request.method === 'b') {
        return Promise.reject(new Error(`fail ${request.method}`));
      }
      return Promise.resolve({ result: 'c' });
    });

    const executor = new FlowExecutor(flow, jsonRpcHandler, new TestLogger('multi-fail'));

    await expect(executor.execute()).rejects.toBeInstanceOf(ExecutionError);
    expect(jsonRpcHandler).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'c' }),
      expect.anything(),
    );
  });

  it('does not schedule skipped dependents after another dependency succeeds', async () => {
    const flow: Flow = {
      name: 'skipped-dependent-flow',
      description: 'skip dependents on failure',
      steps: [
        { name: 'stepA', request: { method: 'a', params: {} } },
        { name: 'stepB', request: { method: 'b', params: {} } },
        {
          name: 'stepC',
          request: {
            method: 'c',
            params: { a: '${stepA.result}', b: '${stepB.result}' },
          },
        },
      ],
    };

    const jsonRpcHandler = jest.fn((request) => {
      if (request.method === 'a') {
        return Promise.reject(new Error('fail A'));
      }
      return Promise.resolve({ result: request.method });
    });

    const executor = new FlowExecutor(flow, jsonRpcHandler, new TestLogger('skip-dependents'));

    await expect(executor.execute()).rejects.toThrow('fail A');
    expect(jsonRpcHandler).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'b' }),
      expect.anything(),
    );
    expect(jsonRpcHandler).not.toHaveBeenCalledWith(
      expect.objectContaining({ method: 'c' }),
      expect.anything(),
    );
  });

  it('treats a stop-step abort reason as a workflow stop', async () => {
    const flow: Flow = {
      name: 'pre-aborted-stop',
      description: 'pre-aborted stop reason',
      steps: [{ name: 'stepA', request: { method: 'a', params: {} } }],
    };

    const jsonRpcHandler = jest.fn().mockResolvedValue({ result: 'a' });
    const executor = new FlowExecutor(flow, jsonRpcHandler, new TestLogger('stop-reason'));
    executor['globalAbortController'].abort('Stopped by stop step');

    const results = await executor.execute();

    expect(results.size).toBe(0);
    expect(jsonRpcHandler).not.toHaveBeenCalled();
  });
});
