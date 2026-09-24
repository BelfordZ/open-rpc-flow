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
import { generateFromSchema } from './generate';
import { mulberry32 } from './prng';
import type { MockedCall, MockJsonRpcHandlerFn, MockJsonRpcHandlerOptions } from './types';

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
   * @param options `{ seed }` for deterministic generation; omit for a
   *   random seed (non-deterministic runs)
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
    const trace: MockedCall[] = [];

    const handle = async (
      request: JsonRpcRequest,
      options?: JsonRpcHandlerOptions,
    ): Promise<unknown> => {
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
