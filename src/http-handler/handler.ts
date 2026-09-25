/**
 * Minimal HTTP JSON-RPC handler: POSTs JSON-RPC requests to a real endpoint.
 *
 * Deliberately barebones (issue #195) — a URL, static headers, an injectable
 * `fetchImpl`, basic non-2xx handling, and invalid-JSON handling. Explicitly
 * out of scope: retries, batching, WebSockets/SSE, auth refresh, and
 * extensive connection controls. There is no plan to grow this into a robust
 * transport layer; bring your own for that.
 */
import { ErrorCode } from '../errors/codes';
import { ExecutionError, ValidationError } from '../errors';
import { JsonRpcRequestError } from '../step-executors/types';
import type { JsonRpcHandlerOptions, JsonRpcRequest } from '../types';
import type { HttpJsonRpcHandlerFn, HttpJsonRpcHandlerOptions } from './types';

export class HttpJsonRpcHandler {
  /**
   * Build a `JsonRpcHandler` that POSTs JSON-RPC 2.0 requests to
   * `options.url` and resolves with the response's `result`.
   *
   * Error contract:
   * - A JSON-RPC error envelope (`{ error: { code, message, data? } }`)
   *   throws `JsonRpcRequestError`, which the request executor passes through
   *   unwrapped so the step surfaces the endpoint's code/message intact.
   * - Non-2xx HTTP statuses, invalid JSON bodies, malformed envelopes, and
   *   network failures throw `ExecutionError` with `ErrorCode.NETWORK_ERROR`.
   * - Aborts propagate untouched so the executor can turn step timeouts into
   *   `TimeoutError` as usual.
   */
  static create(options: HttpJsonRpcHandlerOptions): HttpJsonRpcHandlerFn {
    validateOptions(options);
    const { url, headers = {} } = options;
    const fetchFn = options.fetchImpl ?? defaultFetch();

    return async (
      request: JsonRpcRequest,
      handlerOptions?: JsonRpcHandlerOptions,
    ): Promise<unknown> => {
      const payload = JSON.stringify({
        jsonrpc: '2.0',
        method: request.method,
        params: request.params,
        id: request.id,
      });

      let response: Response;
      try {
        response = await fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: payload,
          signal: handlerOptions?.signal,
        });
      } catch (error) {
        // Aborts must propagate untouched: the request executor detects
        // AbortError and converts step timeouts into TimeoutError.
        if (isAbortError(error, handlerOptions?.signal)) throw error;
        throw new ExecutionError(
          `JSON-RPC request to ${url} failed: ${messageOf(error)}`,
          { code: ErrorCode.NETWORK_ERROR, url, method: request.method },
          toError(error),
        );
      }

      if (!response.ok) {
        throw new ExecutionError(
          `JSON-RPC endpoint ${url} responded with HTTP ${response.status}`,
          {
            code: ErrorCode.NETWORK_ERROR,
            url,
            method: request.method,
            status: response.status,
          },
        );
      }

      let parsed: unknown;
      try {
        parsed = await response.json();
      } catch (error) {
        throw new ExecutionError(
          `JSON-RPC endpoint ${url} returned invalid JSON: ${messageOf(error)}`,
          { code: ErrorCode.NETWORK_ERROR, url, method: request.method },
          toError(error),
        );
      }

      if (typeof parsed !== 'object' || parsed === null) {
        throw new ExecutionError(`JSON-RPC endpoint ${url} returned a non-object response`, {
          code: ErrorCode.NETWORK_ERROR,
          url,
          method: request.method,
        });
      }

      const errorPayload = (parsed as { error?: unknown }).error;
      if (errorPayload !== undefined && errorPayload !== null) {
        if (!isJsonRpcErrorPayload(errorPayload)) {
          throw new ExecutionError(`JSON-RPC endpoint ${url} returned a malformed error response`, {
            code: ErrorCode.NETWORK_ERROR,
            url,
            method: request.method,
          });
        }
        const { code, message, data } = errorPayload;
        // Passes through the request executor unwrapped, surfacing as the
        // step's error with the endpoint's code/message intact.
        throw new JsonRpcRequestError(`JSON-RPC error ${code}: ${message}`, {
          code,
          message,
          data,
        });
      }

      return (parsed as { result?: unknown }).result;
    };
  }
}

function validateOptions(options: HttpJsonRpcHandlerOptions): void {
  if (typeof options !== 'object' || options === null) {
    throw new ValidationError('HttpJsonRpcHandler options must be an object', {
      options,
    });
  }
  if (typeof options.url !== 'string' || options.url.length === 0) {
    throw new ValidationError('HttpJsonRpcHandler requires a non-empty url', {
      url: (options as { url?: unknown }).url,
    });
  }
  if (
    options.headers !== undefined &&
    (typeof options.headers !== 'object' ||
      options.headers === null ||
      Array.isArray(options.headers))
  ) {
    throw new ValidationError('HttpJsonRpcHandler headers must be an object', {
      headers: options.headers,
    });
  }
  if (options.fetchImpl !== undefined && typeof options.fetchImpl !== 'function') {
    throw new ValidationError('HttpJsonRpcHandler fetchImpl must be a function', {
      fetchImpl: options.fetchImpl,
    });
  }
}

function defaultFetch(): typeof fetch {
  const impl = (globalThis as { fetch?: typeof fetch }).fetch;
  if (typeof impl !== 'function') {
    throw new ValidationError(
      'No fetch implementation available: pass fetchImpl explicitly or run on Node 18+',
      {},
    );
  }
  return impl.bind(globalThis);
}

function isAbortError(error: unknown, signal?: AbortSignal | null): boolean {
  // Name-based on purpose: the request executor detects aborts the same way
  // (`error.name === 'AbortError'`), and DOMException is not instanceof Error
  // in Node, so an instanceof check would miss real fetch aborts.
  return (
    (typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'AbortError') ||
    signal?.aborted === true
  );
}

function isJsonRpcErrorPayload(
  value: unknown,
): value is { code: number; message: string; data?: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'number' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
