/**
 * Recording handler: wraps any `JsonRpcHandler` and captures every
 * request/response pair (with timing) into a portable `RecordedTrace`.
 * See issue #153.
 *
 * Each call is tagged with the execution path the executor supplied via
 * `JsonRpcHandlerOptions.stepPath` (e.g. `'fetchUsers'` or
 * `'processUsers[2].fetchUser'`); untagged calls (direct handler use) fall
 * back to the method name. Grouping by path is what keeps the trace correct
 * when loop iterations run concurrently — attribution is by tag, so
 * interleave order does not matter.
 */
import type { JsonRpcHandler } from '../types';
import { snapshot } from './snapshot';
import { stepNameFromPath } from '../util/step-path';
import type { RecordedCall, RecordedError, RecordedTrace } from './types';

/** Reads a numeric error code from a thrown value, if it carries one. */
function readErrorCode(thrown: unknown): number | undefined {
  if (thrown === null || typeof thrown !== 'object') {
    return undefined;
  }
  // Handlers may throw `{ code, message }` directly ...
  const direct = (thrown as { code?: unknown }).code;
  if (typeof direct === 'number') {
    return direct;
  }
  // ... or a `JsonRpcRequestError`, which nests it under `.error`.
  const nested = (thrown as { error?: unknown }).error;
  if (nested !== null && typeof nested === 'object') {
    const nestedCode = (nested as { code?: unknown }).code;
    if (typeof nestedCode === 'number') {
      return nestedCode;
    }
  }
  return undefined;
}

/** Captures a thrown value as a JSON-serializable `RecordedError`. */
function captureError(thrown: unknown): RecordedError {
  let message = 'Unknown error';
  if (thrown instanceof Error) {
    message = thrown.message;
  } else if (typeof thrown === 'string') {
    message = thrown;
  } else if (thrown !== null && typeof thrown === 'object') {
    const maybeMessage = (thrown as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') {
      message = maybeMessage;
    }
  }
  const code = readErrorCode(thrown);
  return code === undefined ? { error: { message } } : { error: { message, code } };
}

/**
 * Wraps `inner` in a recording handler. Every call is timed and captured;
 * thrown errors are recorded as `{ error: { message, code? } }` and then
 * re-thrown unchanged, so recording is fully transparent to the flow.
 *
 * `getTrace(flowName, stepHashes?)` returns the portable trace. Values are
 * snapshotted at record time, so later mutation can't corrupt the trace.
 * Pass per-step definition digests as `stepHashes` (same shape as checkpoint
 * `stepHashes`, #179) to enable stale-trace detection via
 * `validateTraceForFlow`.
 */
export function createRecordingHandler(inner: JsonRpcHandler): {
  handler: JsonRpcHandler;
  getTrace: (flowName: string, stepHashes?: Record<string, string>) => RecordedTrace;
} {
  const steps: RecordedCall[] = [];

  const handler: JsonRpcHandler = async (request, options) => {
    const start = Date.now();
    // A params serialization failure means the call was never made: fail
    // loudly without recording a phantom entry.
    const params = snapshot(request.params) as Record<string, unknown> | unknown[];
    const path = options?.stepPath ?? request.method;
    let result: unknown;
    let thrown: unknown;
    let failed = false;
    try {
      result = await inner(request, options);
    } catch (error) {
      failed = true;
      thrown = error;
    }
    // A result serialization failure is also loud: the trace must never
    // silently degrade values (a corrupted trace replays corrupted responses).
    // It throws outside the inner try/catch so no phantom entry is recorded.
    const recordedResult = failed ? captureError(thrown) : snapshot(result);
    steps.push({
      path,
      step: stepNameFromPath(path),
      method: request.method,
      params,
      result: recordedResult,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
    });
    if (failed) {
      throw thrown;
    }
    return result;
  };

  const getTrace = (flowName: string, stepHashes?: Record<string, string>): RecordedTrace => ({
    flowName,
    recordedAt: new Date().toISOString(),
    steps: steps.map((entry) => ({ ...entry })),
    ...(stepHashes !== undefined ? { stepHashes: { ...stepHashes } } : {}),
  });

  return { handler, getTrace };
}
