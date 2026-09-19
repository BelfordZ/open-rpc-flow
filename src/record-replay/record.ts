/**
 * Recording handler: wraps any `JsonRpcHandler` and captures every
 * request/response pair (with timing) into a portable `RecordedTrace`.
 * See issue #153.
 */
import type { JsonRpcHandler, JsonRpcRequest } from '../types';
import { snapshot } from './snapshot';
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

function toRecordedCall(request: JsonRpcRequest, result: unknown, start: number): RecordedCall {
  return {
    // The handler layer cannot see step names; the method name is the
    // finest-grained identity available here (see RecordedCall docs).
    step: request.method,
    method: request.method,
    params: snapshot(request.params) as Record<string, unknown> | unknown[],
    result: snapshot(result),
    durationMs: Date.now() - start,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Wraps `inner` in a recording handler. Every call is timed and captured;
 * thrown errors are recorded as `{ error: { message, code? } }` and then
 * re-thrown unchanged, so recording is fully transparent to the flow.
 *
 * `getTrace(flowName)` returns the portable trace. Values are snapshotted at
 * record time, so later mutation can't corrupt the trace.
 */
export function createRecordingHandler(inner: JsonRpcHandler): {
  handler: JsonRpcHandler;
  getTrace: (flowName: string) => RecordedTrace;
} {
  const steps: RecordedCall[] = [];

  const handler: JsonRpcHandler = async (request, options) => {
    const start = Date.now();
    try {
      const result = await inner(request, options);
      steps.push(toRecordedCall(request, result, start));
      return result;
    } catch (thrown) {
      steps.push(toRecordedCall(request, captureError(thrown), start));
      throw thrown;
    }
  };

  const getTrace = (flowName: string): RecordedTrace => ({
    flowName,
    recordedAt: new Date().toISOString(),
    steps: steps.map((entry) => ({ ...entry })),
  });

  return { handler, getTrace };
}
