/**
 * Mock handler types: contract-driven dry runs of flows against an OpenRPC
 * document. See issue #152.
 */
import type { JsonRpcHandlerOptions, JsonRpcRequest } from '../types';

/** Options for {@link MockJsonRpcHandler.fromOpenRpc}. */
export interface MockJsonRpcHandlerOptions {
  /**
   * Seed for deterministic mock generation: the same seed and the same
   * sequence of calls always produce the same responses. When omitted, a
   * random seed is used and every run produces different values.
   */
  seed?: number;
}

/**
 * A single mocked JSON-RPC call, as recorded in the dry-run trace.
 * Deliberately minimal and JSON-serializable: issue #153 (record/replay)
 * reuses this shape, lifting it into a `RecordedCall` by adding `step`,
 * `durationMs`, and `timestamp` (the `step` name derives from `path`).
 */
export interface MockedCall {
  /**
   * Execution path of the step that made this call, e.g. `'fetchUsers'` or
   * `'processUsers[2].fetchUser'`. Taken from
   * `JsonRpcHandlerOptions.stepPath` when the executor supplies it (#177);
   * falls back to the method name for direct handler use.
   */
  path: string;
  /** The JSON-RPC method that was called. */
  method: string;
  /** The params the flow sent. */
  params: Record<string, unknown> | unknown[];
  /** The mocked result that was returned. */
  result: unknown;
}

/**
 * The handler function returned by {@link MockJsonRpcHandler.fromOpenRpc}.
 * Directly assignable to `JsonRpcHandler`, so it can be passed to
 * `new FlowExecutor(flow, handler)` with no executor changes.
 */
export interface MockJsonRpcHandlerFn {
  (request: JsonRpcRequest, options?: JsonRpcHandlerOptions): Promise<unknown>;
  /**
   * Returns a copy of the dry-run trace: one {@link MockedCall} per mocked
   * request, in call order. Mutating the returned array does not affect the
   * handler's internal trace.
   */
  getTrace(): MockedCall[];
}
