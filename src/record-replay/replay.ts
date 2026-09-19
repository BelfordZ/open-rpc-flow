/**
 * Replay handler: serves recorded responses in order with zero network calls,
 * plus what-if response overrides. See issue #153.
 */
import { JsonRpcRequestError } from '../step-executors/types';
import type { JsonRpcHandler } from '../types';
import { snapshot } from './snapshot';
import type { RecordedCall, RecordedTrace, ReplayOptions } from './types';
import { ReplayError } from './types';

/** Structural deep equality for request param matching. */
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

/** Short, safe rendering of a value for error messages; never throws. */
function brief(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  } catch {
    return '<unserializable>';
  }
}

/**
 * True when a recorded result is a captured handler throw
 * (`{ error: { message, code? } }`) rather than a returned value.
 *
 * The shape check is deliberately strict (exactly one `error` key holding an
 * object with a string `message`): a successful result that merely *contains*
 * an `error` field alongside other data is treated as data, not as a throw.
 */
export function isRecordedError(
  result: unknown,
): result is { error: { message: string; code?: number } } {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    return false;
  }
  const keys = Object.keys(result);
  if (keys.length !== 1 || keys[0] !== 'error') {
    return false;
  }
  const error = (result as { error: unknown }).error;
  return (
    error !== null &&
    typeof error === 'object' &&
    typeof (error as { message?: unknown }).message === 'string'
  );
}

/**
 * Builds a `JsonRpcHandler` that replays a recorded trace with zero network
 * calls. Incoming requests are matched to trace entries by method +
 * deep-equal params, consuming entries in order; a mismatch or an exhausted
 * trace throws `ReplayError` — a replay that silently returns the wrong
 * response is worse than failing.
 *
 * `overrides[method]` substitutes the response for every call to `method`
 * (what-if debugging). While any override is supplied, matching relaxes to
 * method name + call order, since a substituted response legitimately changes
 * downstream request params.
 *
 * `fromStep` skips entries before the first entry for the named step
 * (a `ReplayError` is thrown at creation time when the step isn't recorded).
 */
export function createReplayHandler(
  trace: RecordedTrace,
  opts: ReplayOptions = {},
): JsonRpcHandler {
  const allEntries: RecordedCall[] = Array.isArray(trace?.steps) ? [...trace.steps] : [];
  let entries = allEntries;
  if (opts.fromStep !== undefined) {
    const index = allEntries.findIndex((entry) => entry?.step === opts.fromStep);
    if (index === -1) {
      throw new ReplayError(
        `Cannot replay from step "${opts.fromStep}": no recorded call for that step.`,
      );
    }
    entries = allEntries.slice(index);
  }
  const overrides = opts.overrides ?? {};
  const hasOverrides = Object.keys(overrides).length > 0;
  let cursor = 0;

  return async (request) => {
    const entry = entries[cursor];
    if (!entry) {
      throw new ReplayError(
        `Replay exhausted: the trace has no more recorded calls, but received a call to method "${request.method}".`,
      );
    }
    if (entry.method !== request.method) {
      throw new ReplayError(
        `Replay mismatch at recorded call ${cursor + 1}: expected method "${entry.method}", ` +
          `but received "${request.method}".`,
      );
    }
    if (!hasOverrides && !deepEqual(entry.params, request.params)) {
      throw new ReplayError(
        `Replay mismatch at recorded call ${cursor + 1} (method "${request.method}"): ` +
          `params do not deep-equal the recorded params. ` +
          `Recorded: ${brief(entry.params)}; received: ${brief(request.params)}.`,
      );
    }
    cursor += 1;

    if (Object.prototype.hasOwnProperty.call(overrides, request.method)) {
      return snapshot(overrides[request.method]);
    }
    if (isRecordedError(entry.result)) {
      // The original call threw: re-throw faithfully as a JSON-RPC error.
      throw new JsonRpcRequestError(entry.result.error.message, {
        code: entry.result.error.code ?? -32603,
        message: entry.result.error.message,
      });
    }
    return snapshot(entry.result);
  };
}
