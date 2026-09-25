/**
 * HTTP handler types: a minimal JSON-RPC-over-HTTP transport for talking to
 * real endpoints. See issue #195.
 */
import type { JsonRpcHandlerOptions, JsonRpcRequest } from '../types';

/**
 * Options for {@link HttpJsonRpcHandler.create}.
 */
export interface HttpJsonRpcHandlerOptions {
  /**
   * The HTTP(S) URL of the JSON-RPC endpoint. Every request is POSTed here.
   */
  url: string;

  /**
   * Static headers sent on every request, e.g. `{ Authorization: 'Bearer ...' }`.
   * Merged over the default `Content-Type: application/json` — a custom
   * `Content-Type` entry overrides the default.
   */
  headers?: Record<string, string>;

  /**
   * The `fetch` implementation to use. Defaults to `globalThis.fetch`
   * (Node 18+). Inject a stub in tests — no network required:
   *
   * ```ts
   * const handler = HttpJsonRpcHandler.create({
   *   url: 'http://localhost:8545',
   *   fetchImpl: async () =>
   *     new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 42 })),
   * });
   * ```
   */
  fetchImpl?: typeof fetch;
}

/**
 * The handler function returned by {@link HttpJsonRpcHandler.create}.
 * Directly assignable to `JsonRpcHandler`, so it can be passed to
 * `new FlowExecutor(flow, handler)` with no executor changes.
 */
export interface HttpJsonRpcHandlerFn {
  (request: JsonRpcRequest, options?: JsonRpcHandlerOptions): Promise<unknown>;
}
