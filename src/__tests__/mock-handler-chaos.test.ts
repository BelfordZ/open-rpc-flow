/**
 * Tests for deterministic failure/latency injection in MockJsonRpcHandler
 * (issue #197) — the chaos harness for testing retry policies, timeouts,
 * and #193 error-handling paths without flaky hand-rolled handlers.
 */
import { ErrorCode } from '../errors/codes';
import { ExecutionError, ValidationError } from '../errors';
import { TimeoutError } from '../errors/timeout-error';
import { FlowExecutor } from '../flow-executor';
import { OpenRpcDocument } from '../flow-doctor';
import { MockJsonRpcHandler } from '../mock-handler';
import type { ChaosConfig } from '../mock-handler';
import { JsonRpcRequestError } from '../step-executors/types';
import type { Flow, JsonRpcRequest } from '../types';

const pair = (name: string, value: unknown) => ({ name, value });

const testDocument: OpenRpcDocument = {
  openrpc: '1.2.6',
  info: { title: 'Chaos Test API', version: '1.0.0' },
  methods: [
    {
      name: 'getUser',
      params: [{ name: 'id', required: true, schema: { type: 'integer' } }],
      result: { schema: { type: 'object' } },
      examples: [
        {
          name: 'ada',
          params: [pair('id', 1)],
          result: pair('user', { id: 1, name: 'Ada' }),
        },
      ],
    },
    {
      name: 'ping',
      params: [],
      result: { schema: { type: 'string' } },
      examples: [{ name: 'pong', params: [], result: pair('pong', 'pong') }],
    },
  ],
};

function request(method: string, params: Record<string, unknown> | unknown[] = {}): JsonRpcRequest {
  return { jsonrpc: '2.0', method, params, id: 1 };
}

/** Runs a promise and returns the rejection reason instead of throwing. */
async function captureError(promise: Promise<unknown>): Promise<any> {
  return promise.catch((e) => e);
}

describe('MockJsonRpcHandler chaos injection', () => {
  describe('scripted error outcomes', () => {
    it('throws scripted JSON-RPC errors in order, then falls back to normal mocks', async () => {
      const chaos: ChaosConfig = {
        getUser: [
          { error: { code: -32000, message: 'boom' } },
          { error: { code: -32001, message: 'bam', data: { attempt: 2 } } },
          'success',
        ],
      };
      const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, { seed: 7, chaos });

      const first = await captureError(handler(request('getUser', { id: 1 })));
      expect(first).toBeInstanceOf(JsonRpcRequestError);
      expect(first.error).toEqual({ code: -32000, message: 'boom', data: undefined });

      const second = await captureError(handler(request('getUser', { id: 1 })));
      expect(second).toBeInstanceOf(JsonRpcRequestError);
      expect(second.error).toEqual({ code: -32001, message: 'bam', data: { attempt: 2 } });

      // 'success' entry: normal mock behavior resumes.
      await expect(handler(request('getUser', { id: 1 }))).resolves.toEqual({
        id: 1,
        name: 'Ada',
      });

      // Script exhausted: still normal mock behavior.
      await expect(handler(request('getUser', { id: 1 }))).resolves.toEqual({
        id: 1,
        name: 'Ada',
      });
    });

    it('only affects the scripted methods', async () => {
      const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, {
        seed: 7,
        chaos: { getUser: [{ error: { code: -32000, message: 'boom' } }] },
      });

      await expect(handler(request('getUser', { id: 1 }))).rejects.toBeInstanceOf(
        JsonRpcRequestError,
      );
      await expect(handler(request('ping'))).resolves.toBe('pong');
    });

    it('treats empty outcome objects as success', async () => {
      const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, {
        seed: 7,
        chaos: { ping: [{}] },
      });

      await expect(handler(request('ping'))).resolves.toBe('pong');
    });

    it('applies chaos to undeclared methods by request method name', async () => {
      const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, {
        seed: 7,
        chaos: { nope: [{ error: { code: -32601, message: 'Method not found' } }] },
      });

      const error = await captureError(handler(request('nope')));
      expect(error).toBeInstanceOf(JsonRpcRequestError);
      expect(error.error.code).toBe(-32601);
    });
  });

  describe('latency outcomes', () => {
    it('delays then returns the normal mock', async () => {
      const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, {
        seed: 7,
        chaos: { ping: [{ latencyMs: 60 }] },
      });

      const start = Date.now();
      await expect(handler(request('ping'))).resolves.toBe('pong');
      expect(Date.now() - start).toBeGreaterThanOrEqual(50);
    });

    it('composes latency with an error outcome', async () => {
      const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, {
        seed: 7,
        chaos: { ping: [{ latencyMs: 40, error: { code: -32000, message: 'slow boom' } }] },
      });

      const start = Date.now();
      const error = await captureError(handler(request('ping')));
      expect(Date.now() - start).toBeGreaterThanOrEqual(30);
      expect(error).toBeInstanceOf(JsonRpcRequestError);
      expect(error.error.message).toBe('slow boom');
    });

    it('rejects with an AbortError-named error when aborted mid-latency', async () => {
      const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, {
        seed: 7,
        chaos: { ping: [{ latencyMs: 5000 }] },
      });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 20);

      const error = await captureError(handler(request('ping'), { signal: controller.signal }));

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('AbortError');
      expect(error).not.toBeInstanceOf(ExecutionError);
    });

    it('rejects immediately when the signal is already aborted', async () => {
      const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, {
        seed: 7,
        chaos: { ping: [{ latencyMs: 5000 }] },
      });
      const controller = new AbortController();
      controller.abort();

      const error = await captureError(handler(request('ping'), { signal: controller.signal }));

      expect(error.name).toBe('AbortError');
    });
  });

  describe('malformed outcomes', () => {
    it('throws ExecutionError with NETWORK_ERROR', async () => {
      const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, {
        seed: 7,
        chaos: { ping: [{ malformed: true }] },
      });

      const error = await captureError(handler(request('ping')));

      expect(error).toBeInstanceOf(ExecutionError);
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(error.message).toMatch(/malformed/);
    });
  });

  describe('trace interaction', () => {
    it('does not record chaos failures in the trace, but records successes', async () => {
      const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, {
        seed: 7,
        chaos: {
          ping: [{ error: { code: -32000, message: 'boom' } }, { malformed: true }, 'success'],
        },
      });

      await captureError(handler(request('ping')));
      await captureError(handler(request('ping')));
      await handler(request('ping'));

      const trace = handler.getTrace();
      expect(trace).toHaveLength(1);
      expect(trace[0]).toMatchObject({ method: 'ping', result: 'pong' });
    });
  });

  describe('determinism', () => {
    it('does not mutate the caller-supplied chaos config', async () => {
      const chaos: ChaosConfig = {
        getUser: [{ error: { code: -32000, message: 'boom' } }, 'success'],
      };
      const snapshot = JSON.parse(JSON.stringify(chaos));
      const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, { seed: 7, chaos });

      await captureError(handler(request('getUser', { id: 1 })));
      await handler(request('getUser', { id: 1 }));
      // A second handler from the same config replays the full script.
      const handler2 = MockJsonRpcHandler.fromOpenRpc(testDocument, { seed: 7, chaos });
      await expect(handler2(request('getUser', { id: 1 }))).rejects.toBeInstanceOf(
        JsonRpcRequestError,
      );

      expect(chaos).toEqual(snapshot);
    });

    it('keeps non-chaos mock values governed by the seed', async () => {
      const plain = MockJsonRpcHandler.fromOpenRpc(testDocument, { seed: 7 });
      const chaotic = MockJsonRpcHandler.fromOpenRpc(testDocument, {
        seed: 7,
        chaos: { getUser: [{ error: { code: -32000, message: 'boom' } }] },
      });

      // ping has no script: identical seeded output with and without chaos.
      await expect(chaotic(request('ping'))).resolves.toBe(await plain(request('ping')));
    });
  });

  describe('executor integration', () => {
    it('drives step timeouts deterministically via injected latency', async () => {
      const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, {
        seed: 7,
        chaos: { getUser: [{ latencyMs: 5000 }] },
      });
      const flow: Flow = {
        name: 'chaos-timeout',
        description: 'chaos latency drives a step timeout',
        steps: [
          {
            name: 'slowUser',
            policies: { timeout: { timeout: 100 } },
            request: { method: 'getUser', params: { id: 1 } },
          },
        ],
      };

      const error = await captureError(new FlowExecutor(flow, handler).execute());

      // The request executor wraps the step's TimeoutError in an
      // ExecutionError carrying TIMEOUT_ERROR and the original as cause.
      expect(error).toBeInstanceOf(ExecutionError);
      expect(error.code).toBe(ErrorCode.TIMEOUT_ERROR);
      expect(error.cause).toBeInstanceOf(TimeoutError);
    });

    it('surfaces scripted JSON-RPC errors as step failures', async () => {
      const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, {
        seed: 7,
        chaos: { getUser: [{ error: { code: -32000, message: 'boom' } }] },
      });
      const flow: Flow = {
        name: 'chaos-error',
        description: 'scripted JSON-RPC error surfaces as a step failure',
        steps: [{ name: 'failing', request: { method: 'getUser', params: { id: 1 } } }],
      };

      const error = await captureError(new FlowExecutor(flow, handler).execute());

      expect(error).toBeInstanceOf(JsonRpcRequestError);
      expect((error as JsonRpcRequestError).error).toMatchObject({
        code: -32000,
        message: 'boom',
      });
    });
  });

  describe('config validation', () => {
    it.each([[null], ['nope'], [[]], [42]])('rejects non-object chaos config: %p', (chaos: any) => {
      expect(() => MockJsonRpcHandler.fromOpenRpc(testDocument, { chaos })).toThrow(
        ValidationError,
      );
    });

    it('rejects a non-array script', () => {
      expect(() =>
        MockJsonRpcHandler.fromOpenRpc(testDocument, { chaos: { ping: 'success' as any } }),
      ).toThrow(/must be an array/);
    });

    it.each([[[42]], [[null]], [['nope']], [[[]]]])(
      'rejects invalid outcome shapes: %p',
      (script: any) => {
        expect(() =>
          MockJsonRpcHandler.fromOpenRpc(testDocument, { chaos: { ping: script } }),
        ).toThrow(/must be 'success' or an outcome object/);
      },
    );

    it('rejects unknown outcome keys', () => {
      expect(() =>
        MockJsonRpcHandler.fromOpenRpc(testDocument, {
          chaos: { ping: [{ latnecyMs: 5 } as any] },
        }),
      ).toThrow(/unknown key "latnecyMs"/);
    });

    it.each([[-1], ['100'], [NaN], [Infinity]])(
      'rejects invalid latencyMs: %p',
      (latencyMs: any) => {
        expect(() =>
          MockJsonRpcHandler.fromOpenRpc(testDocument, { chaos: { ping: [{ latencyMs }] } }),
        ).toThrow(/latencyMs must be a non-negative finite number/);
      },
    );

    it.each([[{ code: 1 }], [{ message: 'x' }], [{ code: '1', message: 'x' }], ['boom'], [null]])(
      'rejects invalid error descriptors: %p',
      (error: any) => {
        expect(() =>
          MockJsonRpcHandler.fromOpenRpc(testDocument, { chaos: { ping: [{ error }] } }),
        ).toThrow(/error must be \{ code: number, message: string/);
      },
    );

    it('rejects unknown error descriptor keys', () => {
      expect(() =>
        MockJsonRpcHandler.fromOpenRpc(testDocument, {
          chaos: { ping: [{ error: { code: 1, message: 'x', detail: 'typo' } as any }] },
        }),
      ).toThrow(/error has unknown key "detail"/);
    });

    it('rejects non-boolean malformed', () => {
      expect(() =>
        MockJsonRpcHandler.fromOpenRpc(testDocument, {
          chaos: { ping: [{ malformed: 'yes' as any }] },
        }),
      ).toThrow(/malformed must be a boolean/);
    });

    it('rejects error combined with malformed', () => {
      expect(() =>
        MockJsonRpcHandler.fromOpenRpc(testDocument, {
          chaos: { ping: [{ error: { code: 1, message: 'x' }, malformed: true }] },
        }),
      ).toThrow(/mutually exclusive/);
    });
  });
});
