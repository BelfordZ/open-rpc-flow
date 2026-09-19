/**
 * Record & replay types: capture a flow run as a portable trace file, replay
 * it later with zero network calls, substitute responses for what-if
 * debugging, and detect contract drift. See issue #153.
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
 * `step`, `durationMs`, and `timestamp`.
 */
export interface RecordedCall {
  /**
   * Step identity for this call. The handler-level recorder cannot see step
   * names (that would need executor cooperation), so this records the method
   * name — the finest-grained identity available at this layer.
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
  /** Recorded calls, in the order they happened. */
  steps: RecordedCall[];
}

/** Options for {@link createReplayHandler}. */
export interface ReplayOptions {
  /**
   * Substitute responses by method name: `overrides[method]` is returned
   * instead of the recorded result for every call to `method`. This is the
   * what-if debugging knob ("what if `getUser` had returned an admin?").
   *
   * Notes:
   * - Overrides are keyed by method name, not step name — the handler layer
   *   cannot see step names. Step-name-keyed overrides would need executor
   *   cooperation (future work).
   * - When any override is supplied, request matching relaxes to method name
   *   + call order (params are not compared), because a substituted response
   *   legitimately changes downstream request params.
   */
  overrides?: Record<string, unknown>;
  /**
   * Skip trace entries before the first entry for this step. In
   * handler-recorded traces `step` is the method name (see {@link RecordedCall}).
   * Throws {@link ReplayError} at creation time when no entry matches.
   */
  fromStep?: string;
}

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
 * Error thrown for unrecoverable replay problems: request mismatch, trace
 * exhaustion, or an unknown `fromStep`.
 */
export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReplayError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
