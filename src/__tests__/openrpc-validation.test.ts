import { FlowExecutor } from '../flow-executor';
import { Flow } from '../types';
import { createMockJsonRpcHandler } from './test-utils';
import { TestLogger } from '../util/logger';
import { ValidationError } from '../errors/base';

describe('OpenRPC discovery and validation', () => {
  it('validates methods against discovered document', async () => {
    const openRpc = {
      openrpc: '1.2.6',
      info: { title: 'test', version: '1' },
      methods: [{ name: 'foo' }],
    };
    const handler = createMockJsonRpcHandler({
      'rpc.discover': openRpc,
      foo: { success: true },
    });
    const flow: Flow = {
      name: 'doc-flow',
      description: '',
      steps: [{ name: 's1', request: { method: 'foo', params: {} } }],
    };
    const logger = new TestLogger('openrpc');
    const executor = new FlowExecutor(flow, handler, logger);
    const results = await executor.execute();
    expect(results.get('s1').result).toEqual({ success: true });
  });

  it('throws when method is not in document', async () => {
    const openRpc = {
      openrpc: '1.2.6',
      info: { title: 'test', version: '1' },
      methods: [{ name: 'foo' }],
    };
    const handler = createMockJsonRpcHandler({
      'rpc.discover': openRpc,
      bar: { ok: true },
    });
    const flow: Flow = {
      name: 'invalid-method',
      description: '',
      steps: [{ name: 'bad', request: { method: 'bar', params: {} } }],
    };
    const executor = new FlowExecutor(flow, handler, new TestLogger('openrpc'));
    await expect(executor.execute()).rejects.toThrow(ValidationError);
  });

  it('continues when discovery fails', async () => {
    const handler = jest.fn().mockImplementation((req) => {
      if (req.method === 'rpc.discover') {
        return Promise.reject(new Error('unsupported'));
      }
      return Promise.resolve({ ok: true });
    });
    const flow: Flow = {
      name: 'no-doc',
      description: '',
      steps: [{ name: 'step', request: { method: 'any', params: {} } }],
    };
    const executor = new FlowExecutor(flow, handler, new TestLogger('openrpc'));
    const results = await executor.execute();
    expect(results.get('step').result).toEqual({ ok: true });
  });
});
