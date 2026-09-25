/**
 * Contract-driven mock JSON-RPC handler for dry-running flows with zero
 * live services. See issue #152.
 *
 * Mock selection per method, in priority order:
 * 1. **Examples first** — `methods[].examples` (OpenRPC ExamplePairings).
 *    The example whose params deep-equal the incoming request wins;
 *    otherwise the method's first example is used as a fallback.
 * 2. **Schema-generated fallback** — a value generated from the method's
 *    result schema (see `generateFromSchema`).
 *
 * Matching is deliberately simple: by-name example params (`[{name, value}]`
 * pairs) only match by-name requests, and by-position examples only match
 * by-position requests. No cross-shape matching is attempted.
 */
import type { JsonRpcHandlerOptions, JsonRpcRequest } from '../types';
import type { OpenRpcDocument, OpenRpcMethodDescriptor } from '../flow-doctor';
import { ErrorCode } from '../errors/codes';
import { ExecutionError, ValidationError } from '../errors';
import { JsonRpcRequestError } from '../step-executors/types';
import { generateFromSchema } from './generate';
import { mulberry32 } from './prng';
import type {
  ChaosConfig,
  ChaosOutcome,
  MockedCall,
  MockJsonRpcHandlerFn,
  MockJsonRpcHandlerOptions,
} from './types';

/** An OpenRPC example pairing, normalized for matching. */
interface NormalizedExample {
  params: unknown;
  result: unknown;
}

/** True for `{ name: string, value: unknown }` example param pairs. */
function isNameValuePair(value: unknown): value is { name: string; value: unknown } {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { name?: unknown }).name === 'string' &&
    'value' in value
  );
}

/**
 * Normalizes example params: OpenRPC `{name, value}` pairs become a
 * by-name object; anything else (plain objects, positional arrays) passes
 * through untouched so it can deep-equal the incoming request params.
 */
function normalizeExampleParams(params: unknown): unknown {
  if (!Array.isArray(params)) {
    return params;
  }
  const byName: Record<string, unknown> = {};
  for (const pair of params) {
    if (!isNameValuePair(pair)) {
      return params;
    }
    byName[pair.name] = pair.value;
  }
  return byName;
}

/**
 * Normalizes an example result: OpenRPC `{name, value}` results unwrap to
 * the value; anything else passes through untouched.
 */
function normalizeExampleResult(result: unknown): unknown {
  if (
    result !== null &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    'value' in result
  ) {
    return (result as { value: unknown }).value;
  }
  return result;
}

/** Extracts the method's examples in normalized form; never throws. */
function methodExamples(method: OpenRpcMethodDescriptor): NormalizedExample[] {
  const examples = method.examples;
  if (!Array.isArray(examples)) {
    return [];
  }
  const normalized: NormalizedExample[] = [];
  for (const example of examples) {
    if (example !== null && typeof example === 'object' && !Array.isArray(example)) {
      const pairing = example as { params?: unknown; result?: unknown };
      normalized.push({
        params: normalizeExampleParams(pairing.params),
        result: normalizeExampleResult(pairing.result),
      });
    }
  }
  return normalized;
}

/** Structural deep equality for example param matching. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== typeof b || a === null || b === null) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, (b as unknown[])[index]))
    );
  }
  if (typeof a === 'object') {
    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    return (
      aKeys.length === Object.keys(bRecord).length &&
      aKeys.every((key) => deepEqual(aRecord[key], bRecord[key]))
    );
  }
  return false;
}

/** Picks the mock result for one method call. */
function mockResult(
  method: OpenRpcMethodDescriptor,
  params: Record<string, unknown> | unknown[],
  rand: () => number,
): unknown {
  const examples = methodExamples(method);
  if (examples.length > 0) {
    const match = examples.find((example) => deepEqual(example.params, params));
    return (match ?? examples[0]).result;
  }
  return generateFromSchema(method.result?.schema, rand);
}

/**
 * Contract-driven mock JSON-RPC handler. Create via
 * {@link MockJsonRpcHandler.fromOpenRpc}; the returned function is directly
 * usable as the executor's `JsonRpcHandler`.
 *
 * ```ts
 * const handler = MockJsonRpcHandler.fromOpenRpc(openrpcDocument, { seed: 42 });
 * const executor = new FlowExecutor(flow, handler);
 * await executor.execute();
 * const trace = handler.getTrace();
 * ```
 *
 * Pass `options.chaos` for scripted, deterministic failure/latency
 * injection (issue #197): per-method outcome scripts consumed FIFO, one
 * entry per call, falling back to normal mock behavior after exhaustion.
 * Calls that fail via a chaos `error`/`malformed` outcome throw and are not
 * recorded in the trace — the trace holds mocked results.
 */
export class MockJsonRpcHandler {
  /* istanbul ignore next -- factory-only by design; use fromOpenRpc() */
  private constructor() {
    // Factory-only: use MockJsonRpcHandler.fromOpenRpc().
  }

  /**
   * Builds a mock handler from a single OpenRPC document.
   *
   * @param document the OpenRPC document describing the mocked services
   * @param options `{ seed }` for deterministic generation (omit for a
   *   random seed), plus optional `{ chaos }` for scripted failure/latency
   *   injection (issue #197)
   */
  static fromOpenRpc(
    document: OpenRpcDocument,
    options: MockJsonRpcHandlerOptions = {},
  ): MockJsonRpcHandlerFn {
    const seed = options.seed ?? Math.floor(Math.random() * 0xffffffff);
    const rand = mulberry32(seed);
    const methods = new Map<string, OpenRpcMethodDescriptor>();
    const declared = Array.isArray(document.methods) ? document.methods : [];
    for (const method of declared) {
      if (method !== null && typeof method === 'object' && typeof method.name === 'string') {
        methods.set(method.name, method);
      }
    }
    // Copied and validated up front: later mutation of the caller's config
    // can't change a running script (error `data` payloads excepted, see
    // compileChaosScripts), keeping runs deterministic.
    const chaosScripts = compileChaosScripts(options.chaos);
    const trace: MockedCall[] = [];

    const handle = async (
      request: JsonRpcRequest,
      options?: JsonRpcHandlerOptions,
    ): Promise<unknown> => {
      const script = chaosScripts.get(request.method);
      if (script !== undefined && script.length > 0) {
        // Consumed FIFO, one entry per call. May sleep and/or throw; benign
        // outcomes fall through to the normal mock below.
        const outcome = script.shift() as 'success' | ChaosOutcome;
        await applyChaosOutcome(request.method, outcome, options?.signal);
      }
      const method = methods.get(request.method);
      // Unknown methods mock as null rather than throwing: a dry run never
      // crashes, and Flow Doctor (#151) flags unknown methods statically.
      const result = method ? mockResult(method, request.params, rand) : null;
      // Attribution for the trace: when the executor tags the call with its
      // execution path (JsonRpcHandlerOptions.stepPath, #177), record it so
      // dry-run traces carry the same path tagging as recorded traces.
      const path = options?.stepPath ?? request.method;
      trace.push({ path, method: request.method, params: request.params, result });
      return result;
    };

    return Object.assign(handle, {
      getTrace: (): MockedCall[] => [...trace],
    });
  }
}

/** Outcome object keys accepted in a chaos script. Anything else is a typo. */
const CHAOS_OUTCOME_KEYS = ['latencyMs', 'error', 'malformed'] as const;

/**
 * Validates the chaos config and returns per-method FIFO scripts. The
 * scripts, outcomes, and error descriptors are copies: mutating the
 * caller's config after `fromOpenRpc` returns cannot change a running
 * script. (An error descriptor's `data` payload is passed through by
 * reference — it is observational test data, never mutated by the handler.)
 */
function compileChaosScripts(
  chaos: ChaosConfig | undefined,
): Map<string, Array<'success' | ChaosOutcome>> {
  const scripts = new Map<string, Array<'success' | ChaosOutcome>>();
  if (chaos === undefined) {
    return scripts;
  }
  if (typeof chaos !== 'object' || chaos === null || Array.isArray(chaos)) {
    throw new ValidationError('MockJsonRpcHandler chaos must be an object keyed by method name', {
      chaos,
    });
  }
  for (const [method, script] of Object.entries(chaos)) {
    if (!Array.isArray(script)) {
      throw new ValidationError(
        `MockJsonRpcHandler chaos script for method "${method}" must be an array`,
        { method, script },
      );
    }
    scripts.set(
      method,
      script.map((outcome, index) => validateChaosOutcome(method, index, outcome)),
    );
  }
  return scripts;
}

/** Validates one script entry and returns a normalized copy of it. */
function validateChaosOutcome(
  method: string,
  index: number,
  outcome: unknown,
): 'success' | ChaosOutcome {
  const where = `chaos script for method "${method}" at index ${index}`;
  if (outcome === 'success') {
    return outcome;
  }
  if (typeof outcome !== 'object' || outcome === null || Array.isArray(outcome)) {
    throw new ValidationError(
      `MockJsonRpcHandler ${where} must be 'success' or an outcome object`,
      { method, index, outcome },
    );
  }
  const record = outcome as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(CHAOS_OUTCOME_KEYS as readonly string[]).includes(key)) {
      throw new ValidationError(`MockJsonRpcHandler ${where} has unknown key "${key}"`, {
        method,
        index,
        key,
      });
    }
  }
  const latencyMs = record.latencyMs;
  const error = record.error;
  const malformed = record.malformed;
  if (
    latencyMs !== undefined &&
    (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 0)
  ) {
    throw new ValidationError(
      `MockJsonRpcHandler ${where}: latencyMs must be a non-negative finite number`,
      { method, index, latencyMs },
    );
  }
  if (error !== undefined) {
    validateChaosErrorDescriptor(where, method, index, error);
  }
  if (malformed !== undefined && typeof malformed !== 'boolean') {
    throw new ValidationError(`MockJsonRpcHandler ${where}: malformed must be a boolean`, {
      method,
      index,
      malformed,
    });
  }
  if (error !== undefined && malformed === true) {
    throw new ValidationError(
      `MockJsonRpcHandler ${where}: error and malformed are mutually exclusive`,
      { method, index },
    );
  }
  const normalized: ChaosOutcome = {};
  if (latencyMs !== undefined) {
    normalized.latencyMs = latencyMs;
  }
  if (error !== undefined) {
    const descriptor = error as { code: number; message: string; data?: unknown };
    normalized.error = { code: descriptor.code, message: descriptor.message };
    if (descriptor.data !== undefined) {
      normalized.error.data = descriptor.data;
    }
  }
  if (malformed !== undefined) {
    normalized.malformed = malformed;
  }
  return normalized;
}

function validateChaosErrorDescriptor(
  where: string,
  method: string,
  index: number,
  error: unknown,
): void {
  const record =
    typeof error === 'object' && error !== null && !Array.isArray(error)
      ? (error as Record<string, unknown>)
      : undefined;
  const valid =
    record !== undefined && typeof record.code === 'number' && typeof record.message === 'string';
  if (!valid) {
    throw new ValidationError(
      `MockJsonRpcHandler ${where}: error must be { code: number, message: string, data?: unknown }`,
      { method, index, error },
    );
  }
  for (const key of Object.keys(record)) {
    if (!['code', 'message', 'data'].includes(key)) {
      throw new ValidationError(`MockJsonRpcHandler ${where}: error has unknown key "${key}"`, {
        method,
        index,
        key,
      });
    }
  }
}

/**
 * Applies one chaos outcome: sleeps for `latencyMs` (abort-aware), then
 * throws for `error`/`malformed`. Benign outcomes (`'success'`, empty, or
 * latency-only) return silently and the caller falls through to the normal
 * mock.
 */
async function applyChaosOutcome(
  method: string,
  outcome: 'success' | ChaosOutcome,
  signal?: AbortSignal,
): Promise<void> {
  if (outcome === 'success') {
    return;
  }
  if (outcome.latencyMs !== undefined && outcome.latencyMs > 0) {
    await abortableSleep(outcome.latencyMs, signal);
  }
  if (outcome.error !== undefined) {
    const { code, message, data } = outcome.error;
    // Same surface as HttpJsonRpcHandler on an error envelope: the request
    // executor passes JsonRpcRequestError through unwrapped.
    throw new JsonRpcRequestError(`JSON-RPC error ${code}: ${message}`, { code, message, data });
  }
  if (outcome.malformed === true) {
    throw new ExecutionError(`Mock chaos for method "${method}" injected a malformed response`, {
      code: ErrorCode.NETWORK_ERROR,
      method,
    });
  }
}

/** Sleep that rejects with an AbortError-named error when signal aborts. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(abortError());
  }
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * An abort error by name. The request executor detects aborts via
 * `error.name === 'AbortError'` (not instanceof), so a plain Error with the
 * name set is the portable choice — no DOMException dependency.
 */
function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}
