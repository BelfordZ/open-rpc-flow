import type { JsonRpcHandler } from '../types';

/**
 * Record & replay types: capture a flow run as a portable trace file, replay
 * it later with zero network calls, substitute responses for what-if
 * debugging, and detect contract drift. See issue #153.
 *
 * Design: the transport layer stays dumb. The executor tags each handler
 * call with an execution path (`JsonRpcHandlerOptions.stepPath`, e.g.
 * `'fetchUsers'` or `'processUsers[2].fetchUser'`); the recorder groups
 * calls by path after the fact. Replay matches per path-group, so concurrent
 * loop iterations replay deterministically — grouping (not a flat call log)
 * is what makes interleaved calls attributable. Overrides are keyed by path
 * and may be sequences, which is what makes failure-injection what-ifs
 * ("fail twice, then succeed") expressible.
 */

/** A handler call that threw, captured in JSON-serializable form. */
export interface RecordedError {
  error: {
    message: string;
    code?: number;
  };
}

/**
 * A single recorded JSON-RPC call.
 *
 * `method`/`params`/`result` mirror the `MockedCall` shape from
 * contract-driven dry runs (#152), so dry-run traces and recorded traces
 * stay interchangeable: a `MockedCall` lifts into a `RecordedCall` by adding
 * `path`, `step`, `durationMs`, and `timestamp`.
 */
export interface RecordedCall {
  /**
   * Execution path of the step that made this call, e.g. `'fetchUsers'` or
   * `'processUsers[2].fetchUser'` for a sub-step inside a loop iteration.
   * Set from `JsonRpcHandlerOptions.stepPath` when the call comes from a
   * flow step; falls back to the method name for direct handler use.
   */
  path: string;
  /**
   * Name of the step that made this call (the last segment of {@link path}),
   * or the method name when the call was untagged.
   */
  step: string;
  /** The JSON-RPC method that was called. */
  method: string;
  /** The params the flow sent. */
  params: Record<string, unknown> | unknown[];
  /**
   * The result that came back — or a {@link RecordedError}
   * (`{ error: { message, code? } }`) when the handler call threw, so replay
   * can re-throw faithfully.
   */
  result: unknown;
  /** Wall-clock time the handler call took, in milliseconds. */
  durationMs: number;
  /** ISO timestamp of when the call completed. */
  timestamp: string;
}

/** A portable, JSON-serializable capture of a flow run's JSON-RPC traffic. */
export interface RecordedTrace {
  /** Name of the flow that was recorded (supplied by the caller). */
  flowName: string;
  /** ISO timestamp of when the trace was captured. */
  recordedAt: string;
  /** Recorded calls, in the order they happened. Replay groups them by `path`. */
  steps: RecordedCall[];
  /**
   * Per-step definition digests keyed by step name, in the same shape as
   * checkpoint `stepHashes` (#179): the same substrate, shared by the two
   * features. Omitted when the recorder never saw the flow definition —
   * pass them via `getTrace(flowName, stepHashes)` and validate later with
   * {@link validateTraceForFlow}.
   */
  stepHashes?: Record<string, string>;
}

/**
 * A per-call response sequence for one override path. Serve a different
 * response per successive call in the path's group — the primitive for
 * failure-injection what-ifs, e.g. `overrideSequence(err, err, ok)` replays
 * "the call failed twice, then succeeded" to exercise retry policy.
 * A bare array override is a single array-valued response, never a sequence.
 */
export class ReplaySequence {
  /** The responses to serve, in order, one per successive call. */
  readonly responses: readonly unknown[];
  constructor(...responses: unknown[]) {
    this.responses = responses;
  }
}

/** Build a {@link ReplaySequence} for a path-keyed override. */
export function overrideSequence(...responses: unknown[]): ReplaySequence {
  return new ReplaySequence(...responses);
}

/** Options for {@link createReplayHandler}. */
export interface ReplayOptions {
  /**
   * Substitute responses by execution path: `overrides[path]` is returned
   * instead of the recorded result for calls with that path (`'fetchUsers'`,
   * or `'processUsers[2].fetchUser'` for a loop sub-step). This is the
   * what-if debugging knob ("what if `getUser` had returned an admin?").
   *
   * A bare value replaces the recorded result for every call in the path's
   * group. Use {@link overrideSequence} to serve a different response per
   * successive call. When any override is supplied, param matching relaxes
   * to path + call order (params are not compared), because a substituted
   * response legitimately changes downstream request params.
   */
  overrides?: Record<string, unknown>;
  /**
   * Skip trace entries before the first entry whose path matches: an exact
   * path, or a step-name prefix covering its iterations and nested sub-steps
   * (`'processUsers'` matches `'processUsers[2].fetchUser'`). Throws
   * {@link ReplayError} at creation time when no entry matches.
   */
  fromStep?: string;
  /**
   * When true, `getReplayReport()` throws {@link ReplayError} if any
   * recorded entries were never consumed — i.e. the what-if changed the
   * call pattern and some recorded calls never happened. Default false:
   * leftovers are reported, not fatal. Call the report after the replayed
   * run completes.
   */
  strict?: boolean;
}

/** Consumption report for a replayed run (see `getReplayReport`). */
export interface ReplayReport {
  /** Number of recorded entries consumed, per execution path. */
  consumed: Record<string, number>;
  /** Recorded entries never consumed: the what-if changed the call pattern. */
  unconsumed: Array<{ path: string; remaining: number }>;
}

/**
 * A replay handler: a `JsonRpcHandler` serving recorded responses, plus a
 * `getReplayReport()` accessor for the consumption report. Call it after the
 * replayed run completes; with `strict: true` it throws on unconsumed
 * entries instead of just reporting them.
 */
export type ReplayHandler = JsonRpcHandler & {
  getReplayReport(): ReplayReport;
};

/** A single contract-drift finding from {@link detectContractDrift}. */
export interface DriftReport {
  /** The method whose recorded result no longer matches its schema. */
  method: string;
  /** JSON pointer (RFC 6901) into the result where the mismatch occurred; '' for the root. */
  path: string;
  /** Human-readable description of the mismatch. */
  message: string;
}

/**
 * Error thrown for unrecoverable record/replay problems: request mismatch,
 * trace exhaustion, an unknown `fromStep`, or a stale trace (see
 * {@link validateTraceForFlow}).
 */
export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
