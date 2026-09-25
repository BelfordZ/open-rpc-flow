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

  /**
   * Scripted, deterministic failure/latency injection per method (issue
   * #197) — the chaos harness for testing retry policies, timeouts, and
   * #193 error-handling paths without flaky hand-rolled handlers.
   *
   * Each method maps to a FIFO outcome script, consumed one entry per call;
   * once a script is exhausted the method falls back to normal mock
   * behavior. Methods without a script are never affected. `seed` still
   * governs the non-chaos mock values.
   */
  chaos?: ChaosConfig;
}

/**
 * A JSON-RPC error to throw for a chaos `error` outcome, mirroring what
 * {@link HttpJsonRpcHandler} surfaces when a real endpoint returns an error
 * envelope: the request executor passes it through as `JsonRpcRequestError`.
 */
export interface ChaosErrorDescriptor {
  code: number;
  message: string;
  data?: unknown;
}

/**
 * One scripted chaos outcome. Fields compose: `latencyMs` applies first,
 * then `error` or `malformed` throws. An empty object behaves like
 * `'success'` (normal mock, no delay).
 */
export interface ChaosOutcome {
  /**
   * Delay this long before producing the outcome. Honors the call's
   * `AbortSignal`: aborting during injected latency rejects with an
   * `AbortError`-named error, so executor step timeouts fire deterministically
   * without `setTimeout` races in test code.
   */
  latencyMs?: number;
  /**
   * Throw this JSON-RPC error after any latency, as `JsonRpcRequestError`.
   * Mutually exclusive with `malformed`.
   */
  error?: ChaosErrorDescriptor;
  /**
   * Throw a transport-level invalid-response error (`ExecutionError` with
   * `ErrorCode.NETWORK_ERROR`) after any latency, as if the endpoint
   * returned garbage. Mutually exclusive with `error`.
   */
  malformed?: boolean;
}

/**
 * A scripted per-method outcome sequence. `'success'` is an explicit no-op
 * marker: behave normally for this call and advance the script.
 */
export type ChaosScript = Array<'success' | ChaosOutcome>;

/**
 * Per-method chaos scripts, keyed by JSON-RPC method name. Only the methods
 * under test misbehave; everything else returns normal mock data.
 */
export interface ChaosConfig {
  [method: string]: ChaosScript;
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
