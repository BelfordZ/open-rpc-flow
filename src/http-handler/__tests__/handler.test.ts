/**
 * Tests for the minimal HTTP JSON-RPC handler (issue #195).
 *
 * All network I/O goes through an injected `fetchImpl` stub — no real
 * requests are made. Responses use the real global `Response` (Node 18+).
 */
import { ErrorCode } from '../../errors/codes';
import { ExecutionError, ValidationError } from '../../errors';
import { JsonRpcRequestError } from '../../step-executors/types';
import { FlowExecutor } from '../../flow-executor';
import { HttpJsonRpcHandler } from '../handler';

const URL = 'https://example.com/rpc';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function successEnvelope(result: unknown, id = 1) {
  return { jsonrpc: '2.0', id, result };
}

/** Runs a promise and returns the rejection reason instead of throwing. */
async function captureError(promise: Promise<unknown>): Promise<any> {
  return promise.catch((e) => e);
}

/** First call of an untyped fetch stub, as (url, init). */
function firstCall(fetchImpl: jest.Mock): [string, RequestInit] {
  return fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
}

describe('HttpJsonRpcHandler', () => {
  describe('create() option validation', () => {
    it('throws ValidationError for a missing options object', () => {
      expect(() => HttpJsonRpcHandler.create(undefined as any)).toThrow(ValidationError);
    });

    it('throws ValidationError for an empty url', () => {
      expect(() => HttpJsonRpcHandler.create({ url: '', fetchImpl: jest.fn() } as any)).toThrow(
        /non-empty url/,
      );
    });

    it('throws ValidationError for a non-string url', () => {
      expect(() => HttpJsonRpcHandler.create({ url: 42, fetchImpl: jest.fn() } as any)).toThrow(
        /non-empty url/,
      );
    });

    it('throws ValidationError for non-object headers', () => {
      expect(() =>
        HttpJsonRpcHandler.create({
          url: URL,
          headers: 'nope' as any,
          fetchImpl: jest.fn() as any,
        }),
      ).toThrow(/headers must be an object/);
    });

    it('throws ValidationError for array headers', () => {
      expect(() =>
        HttpJsonRpcHandler.create({
          url: URL,
          headers: [] as any,
          fetchImpl: jest.fn() as any,
        }),
      ).toThrow(/headers must be an object/);
    });

    it('throws ValidationError for a non-function fetchImpl', () => {
      expect(() => HttpJsonRpcHandler.create({ url: URL, fetchImpl: 'nope' as any })).toThrow(
        /fetchImpl must be a function/,
      );
    });

    it('throws ValidationError when no fetch implementation is available', () => {
      const originalFetch = globalThis.fetch;
      (globalThis as any).fetch = undefined;
      try {
        expect(() => HttpJsonRpcHandler.create({ url: URL })).toThrow(
          /No fetch implementation available/,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('uses globalThis.fetch when fetchImpl is omitted', async () => {
      const originalFetch = globalThis.fetch;
      const stub = jest.fn(async () => jsonResponse(successEnvelope('ok')));
      (globalThis as any).fetch = stub;
      try {
        const handler = HttpJsonRpcHandler.create({ url: URL });
        await expect(handler({ jsonrpc: '2.0', method: 'ping', params: {}, id: 7 })).resolves.toBe(
          'ok',
        );
        expect(stub).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('request sending', () => {
    it('POSTs a JSON-RPC 2.0 envelope with the default Content-Type', async () => {
      const fetchImpl = jest.fn(async () => jsonResponse(successEnvelope(42)));
      const handler = HttpJsonRpcHandler.create({ url: URL, fetchImpl });

      const result = await captureError(
        handler({ jsonrpc: '2.0', method: 'getAnswer', params: { q: 1 }, id: 3 }),
      );

      expect(result).toBe(42);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [calledUrl, init] = firstCall(fetchImpl);
      expect(calledUrl).toBe(URL);
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(JSON.parse(init.body as string)).toEqual({
        jsonrpc: '2.0',
        method: 'getAnswer',
        params: { q: 1 },
        id: 3,
      });
    });

    it('merges static headers and lets a custom Content-Type win', async () => {
      const fetchImpl = jest.fn(async () => jsonResponse(successEnvelope(null)));
      const handler = HttpJsonRpcHandler.create({
        url: URL,
        headers: { Authorization: 'Bearer s3cret', 'Content-Type': 'application/json-rpc' },
        fetchImpl,
      });

      await captureError(handler({ jsonrpc: '2.0', method: 'ping', params: [], id: 1 }));

      const [, init] = firstCall(fetchImpl);
      expect(init.headers).toEqual({
        'Content-Type': 'application/json-rpc',
        Authorization: 'Bearer s3cret',
      });
    });

    it('forwards the AbortSignal from handler options', async () => {
      const fetchImpl = jest.fn(async () => jsonResponse(successEnvelope(1)));
      const handler = HttpJsonRpcHandler.create({ url: URL, fetchImpl });
      const controller = new AbortController();

      await captureError(
        handler(
          { jsonrpc: '2.0', method: 'ping', params: {}, id: 1 },
          { signal: controller.signal },
        ),
      );

      const [, init] = firstCall(fetchImpl);
      expect(init.signal).toBe(controller.signal);
    });

    it('works as a JsonRpcHandler for FlowExecutor request steps', async () => {
      const fetchImpl = jest.fn(async (_url: any, init: any) => {
        const body = JSON.parse(init.body);
        return jsonResponse(successEnvelope(`hello:${body.params.name}`));
      });
      const handler = HttpJsonRpcHandler.create({ url: URL, fetchImpl });

      const flow = {
        name: 'http-smoke',
        steps: [
          {
            name: 'greet',
            request: { method: 'greet', params: { name: 'zachary' } },
          },
        ],
      };
      const executor = new FlowExecutor(flow as any, handler);
      const results = await executor.execute();

      expect(results.get('greet')).toMatchObject({ result: 'hello:zachary' });
    });
  });

  describe('error handling', () => {
    it('throws ExecutionError with NETWORK_ERROR on non-2xx status', async () => {
      const fetchImpl = jest.fn(async () => new Response('nope', { status: 503 }));
      const handler = HttpJsonRpcHandler.create({ url: URL, fetchImpl });

      const failure = captureError(handler({ jsonrpc: '2.0', method: 'ping', params: {}, id: 1 }));

      await expect(failure).resolves.toBeInstanceOf(ExecutionError);
      const error = await failure;
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(error.context.status).toBe(503);
      expect(error.context.url).toBe(URL);
      expect(error.message).toMatch(/HTTP 503/);
    });

    it('throws ExecutionError with NETWORK_ERROR when fetch rejects', async () => {
      const networkFailure = new TypeError('fetch failed');
      const fetchImpl = jest.fn(async () => {
        throw networkFailure;
      });
      const handler = HttpJsonRpcHandler.create({ url: URL, fetchImpl });

      const failure = captureError(handler({ jsonrpc: '2.0', method: 'ping', params: {}, id: 1 }));

      await expect(failure).resolves.toBeInstanceOf(ExecutionError);
      const error = await failure;
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(error.cause).toBe(networkFailure);
      expect(error.message).toMatch(/fetch failed/);
    });

    it('wraps non-Error fetch rejections', async () => {
      const fetchImpl = jest.fn(async () => {
        throw 'string failure';
      });
      const handler = HttpJsonRpcHandler.create({ url: URL, fetchImpl });

      const error = await captureError(
        handler({ jsonrpc: '2.0', method: 'ping', params: {}, id: 1 }),
      );

      expect(error).toBeInstanceOf(ExecutionError);
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(error.message).toMatch(/string failure/);
      expect(error.cause).toBeInstanceOf(Error);
    });

    it('lets AbortError propagate unwrapped so the executor can detect it', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      const fetchImpl = jest.fn(async () => {
        throw abortError;
      });
      const handler = HttpJsonRpcHandler.create({ url: URL, fetchImpl });

      const error = await captureError(
        handler({ jsonrpc: '2.0', method: 'ping', params: {}, id: 1 }),
      );

      expect(error).toBe(abortError);
      expect(error).not.toBeInstanceOf(ExecutionError);
    });

    it('lets aborts detected via an aborted signal propagate unwrapped', async () => {
      const controller = new AbortController();
      controller.abort();
      const fetchImpl = jest.fn(async () => {
        throw new Error('aborted by signal');
      });
      const handler = HttpJsonRpcHandler.create({ url: URL, fetchImpl });

      const error = await captureError(
        handler(
          { jsonrpc: '2.0', method: 'ping', params: {}, id: 1 },
          { signal: controller.signal },
        ),
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(ExecutionError);
      expect(error.message).toBe('aborted by signal');
    });

    it('throws ExecutionError on an invalid JSON body', async () => {
      const fetchImpl = jest.fn(async () => new Response('this is not json', { status: 200 }));
      const handler = HttpJsonRpcHandler.create({ url: URL, fetchImpl });

      const error = await captureError(
        handler({ jsonrpc: '2.0', method: 'ping', params: {}, id: 1 }),
      );

      expect(error).toBeInstanceOf(ExecutionError);
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(error.message).toMatch(/invalid JSON/);
    });

    it('throws ExecutionError on a non-object JSON response', async () => {
      const fetchImpl = jest.fn(async () => jsonResponse(42));
      const handler = HttpJsonRpcHandler.create({ url: URL, fetchImpl });

      const error = await captureError(
        handler({ jsonrpc: '2.0', method: 'ping', params: {}, id: 1 }),
      );

      expect(error).toBeInstanceOf(ExecutionError);
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(error.message).toMatch(/non-object response/);
    });

    it('throws JsonRpcRequestError on a JSON-RPC error envelope', async () => {
      const fetchImpl = jest.fn(async () =>
        jsonResponse({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'Method not found', data: { method: 'nope' } },
        }),
      );
      const handler = HttpJsonRpcHandler.create({ url: URL, fetchImpl });

      const error = await captureError(
        handler({ jsonrpc: '2.0', method: 'nope', params: {}, id: 1 }),
      );

      expect(error).toBeInstanceOf(JsonRpcRequestError);
      expect(error.error).toEqual({
        code: -32601,
        message: 'Method not found',
        data: { method: 'nope' },
      });
      expect(error.message).toMatch(/-32601/);
    });

    it('throws ExecutionError on a malformed JSON-RPC error envelope', async () => {
      const fetchImpl = jest.fn(async () =>
        jsonResponse({ jsonrpc: '2.0', id: 1, error: { nope: true } }),
      );
      const handler = HttpJsonRpcHandler.create({ url: URL, fetchImpl });

      const error = await captureError(
        handler({ jsonrpc: '2.0', method: 'ping', params: {}, id: 1 }),
      );

      expect(error).toBeInstanceOf(ExecutionError);
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
      expect(error.message).toMatch(/malformed error response/);
    });

    it('treats a null error member as no error', async () => {
      const fetchImpl = jest.fn(async () =>
        jsonResponse({ jsonrpc: '2.0', id: 1, result: 'fine', error: null }),
      );
      const handler = HttpJsonRpcHandler.create({ url: URL, fetchImpl });

      await expect(handler({ jsonrpc: '2.0', method: 'ping', params: {}, id: 1 })).resolves.toBe(
        'fine',
      );
    });
  });
});
