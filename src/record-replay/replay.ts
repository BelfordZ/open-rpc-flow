/**
 * Replay handler: serves recorded responses per execution path with zero
 * network calls, plus what-if response overrides. See issue #153.
 *
 * Incoming calls carry their execution path (`JsonRpcHandlerOptions.stepPath`,
 * e.g. `'fetchUsers'` or `'processUsers[2].fetchUser'`); each path gets its
 * own ordered group of recorded entries, consumed by a per-group cursor. This
 * is what keeps replay deterministic when loop iterations ran concurrently at
 * record time: attribution is by tag, not by global call order. A mismatch or
 * an exhausted group throws `ReplayError` — a replay that silently returns
 * the wrong response is worse than failing.
 *
 * Call-count changes degrade loudly, not silently: fewer calls than recorded
 * leave unconsumed entries (reported by `getReplayReport()`, fatal with
 * `strict: true`); more calls than recorded throw `ReplayError`, because a
 * trace cannot invent responses it never captured.
 */
import { JsonRpcRequestError } from '../step-executors/types';
import type { JsonRpcHandlerOptions } from '../types';
import { snapshot } from './snapshot';
import type { RecordedCall, RecordedTrace, ReplayOptions, ReplayHandler } from './types';
import { ReplayError, ReplaySequence } from './types';

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

/** One path's recorded entries plus its consumption cursor. */
interface CallGroup {
  entries: RecordedCall[];
  cursor: number;
}

/**
 * Whether a recorded entry path matches a `fromStep` selector: an exact
 * path, or a step-name prefix covering its iterations and nested sub-steps
 * (`'processUsers'` matches `'processUsers[2].fetchUser'`).
 */
function matchesFromStep(entryPath: string, fromStep: string): boolean {
  return (
    entryPath === fromStep ||
    entryPath.startsWith(`${fromStep}[`) ||
    entryPath.startsWith(`${fromStep}.`)
  );
}

/**
 * Builds a replay handler for a recorded trace with zero network calls.
 * Incoming requests are matched to their path's group by method +
 * deep-equal params, consuming that group's entries in order; a mismatch or
 * an exhausted group throws `ReplayError`.
 *
 * `overrides[path]` substitutes the response for calls with that execution
 * path (what-if debugging); see {@link ReplayOptions} and
 * {@link overrideSequence}. While any override is supplied, param matching
 * relaxes to path + call order, since a substituted response legitimately
 * changes downstream request params.
 *
 * `fromStep` skips entries before the first entry whose path matches (a
 * `ReplayError` is thrown at creation time when nothing matches).
 *
 * The returned handler also exposes `getReplayReport()` — call it after the
 * replayed run completes to see per-path consumption and any unconsumed
 * entries (fatal instead of reported with `strict: true`).
 */
export function createReplayHandler(trace: RecordedTrace, opts: ReplayOptions = {}): ReplayHandler {
  const allEntries: RecordedCall[] = Array.isArray(trace?.steps) ? [...trace.steps] : [];
  let entries = allEntries;
  if (opts.fromStep !== undefined) {
    const fromStep = opts.fromStep;
    const index = allEntries.findIndex((entry) => entry && matchesFromStep(entry.path, fromStep));
    if (index === -1) {
      throw new ReplayError(
        `Cannot replay from step "${fromStep}": no recorded call matches that path.`,
      );
    }
    entries = allEntries.slice(index);
  }

  // Group entries by execution path, preserving first-seen order.
  const groups = new Map<string, CallGroup>();
  for (const entry of entries) {
    let group = groups.get(entry.path);
    if (!group) {
      group = { entries: [], cursor: 0 };
      groups.set(entry.path, group);
    }
    group.entries.push(entry);
  }

  const overrides = opts.overrides ?? {};
  // The sharp edge: `overrideSequence(...)` is a *value* for one path, not
  // the top-level `overrides` argument. A bare sequence would silently match
  // no path (its keys are numeric), so fail loudly with a hint instead.
  if (overrides instanceof ReplaySequence) {
    throw new ReplayError(
      '`overrides` must be a path-keyed record like { getPrice: overrideSequence(50) } ' +
        '— did you pass overrideSequence(...) directly?',
    );
  }
  const hasOverrides = Object.keys(overrides).length > 0;
  // Remaining per-path sequence overrides; sequences are spent in order and
  // never fall back to recorded entries once exhausted (explicit scripts
  // should be total — silent fallback would mask an incomplete what-if).
  const sequences = new Map<string, unknown[]>();
  const consumed = new Map<string, number>();

  const handler = (async (request, options?: JsonRpcHandlerOptions) => {
    const path = options?.stepPath ?? request.method;
    const group = groups.get(path);
    if (!group) {
      throw new ReplayError(
        `Replay has no recorded calls for path "${path}" (method "${request.method}"). ` +
          `The flow diverged from the recording here — a what-if may have changed control flow or the iteration count.`,
      );
    }
    const entry = group.entries[group.cursor];
    if (!entry) {
      throw new ReplayError(
        `Replay exhausted for path "${path}": the trace recorded ${group.entries.length} call(s) ` +
          `for this path, but the replay made more.`,
      );
    }
    if (entry.method !== request.method) {
      throw new ReplayError(
        `Replay mismatch for path "${path}" at call ${group.cursor + 1}: expected method ` +
          `"${entry.method}", but received "${request.method}".`,
      );
    }
    if (!hasOverrides && !deepEqual(entry.params, request.params)) {
      throw new ReplayError(
        `Replay mismatch for path "${path}" at call ${group.cursor + 1} (method "${request.method}"): ` +
          `params do not deep-equal the recorded params. ` +
          `Recorded: ${brief(entry.params)}; received: ${brief(request.params)}.`,
      );
    }
    group.cursor += 1;
    consumed.set(path, (consumed.get(path) ?? 0) + 1);

    if (Object.prototype.hasOwnProperty.call(overrides, path)) {
      const override = overrides[path];
      let value: unknown;
      if (override instanceof ReplaySequence) {
        let remaining = sequences.get(path);
        if (!remaining) {
          remaining = [...override.responses];
          sequences.set(path, remaining);
        }
        if (remaining.length === 0) {
          throw new ReplayError(
            `Replay exhausted for path "${path}": the override sequence is spent, but the replay made another call.`,
          );
        }
        value = remaining.shift();
      } else {
        value = override;
      }
      if (isRecordedError(value)) {
        // An override shaped like a captured throw re-throws faithfully —
        // this is the failure-injection primitive
        // (`overrideSequence({ error: {...} }, ok)`).
        throw new JsonRpcRequestError(value.error.message, {
          code: value.error.code ?? -32603,
          message: value.error.message,
        });
      }
      return snapshot(value);
    }
    if (isRecordedError(entry.result)) {
      // The original call threw: re-throw faithfully as a JSON-RPC error.
      throw new JsonRpcRequestError(entry.result.error.message, {
        code: entry.result.error.code ?? -32603,
        message: entry.result.error.message,
      });
    }
    return snapshot(entry.result);
  }) as ReplayHandler;

  handler.getReplayReport = () => {
    const consumedByPath: Record<string, number> = {};
    for (const [path, count] of consumed) {
      consumedByPath[path] = count;
    }
    const unconsumed = [...groups.entries()]
      .filter(([, group]) => group.cursor < group.entries.length)
      .map(([path, group]) => ({ path, remaining: group.entries.length - group.cursor }));
    if (opts.strict && unconsumed.length > 0) {
      throw new ReplayError(
        `Strict replay: ${unconsumed.length} recorded path(s) were not fully consumed — ` +
          unconsumed.map((u) => `"${u.path}" (${u.remaining} call(s) left)`).join(', ') +
          `. The what-if changed the call pattern; re-record or turn strict mode off.`,
      );
    }
    return { consumed: consumedByPath, unconsumed };
  };

  return handler;
}
