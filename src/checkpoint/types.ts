/**
 * Durable checkpoints (issue #158): versioned, JSON-serializable snapshots of
 * a FlowExecutor's progress that can be persisted and resumed later — in the
 * same process or a different one, minutes or days later.
 */

/**
 * Schema version of {@link FlowCheckpoint}. Bump this when the shape changes;
 * {@link validateCheckpoint} rejects checkpoints from other versions.
 */
export const CHECKPOINT_VERSION = 2;

/**
 * A failed step's error, stored as plain data. Errors are never serialized
 * as `Error` instances: only the message and stack survive the JSON round
 * trip, and they are rehydrated into plain `Error` objects on import.
 */
export interface CheckpointStepError {
  message: string;
  stack?: string;
}

/**
 * Per-step execution status recorded in a checkpoint.
 */
export interface CheckpointStepStatus {
  status: 'success' | 'failed';
  error?: CheckpointStepError;
}

/**
 * A durable, portable snapshot of a flow execution's progress.
 *
 * Every field is JSON-serializable by construction: `exportState()` rejects
 * state that cannot survive `JSON.stringify` (functions, Maps, BigInts,
 * circular references, …) instead of silently corrupting it. The returned
 * object is also JSON-*normalized* — `JSON.parse(JSON.stringify(snapshot))`
 * deep-equals the snapshot — so what you persist is exactly what you get
 * back on import.
 */
export interface FlowCheckpoint {
  /** Schema version; see {@link CHECKPOINT_VERSION}. */
  version: typeof CHECKPOINT_VERSION;
  /** Name of the flow the checkpoint was exported from (informational). */
  flowName: string;
  /**
   * Per-step sha256 hex digests of the flow's step definitions, keyed by step
   * name. This is the compatibility anchor on import: each recorded step's
   * results are only meaningful if that step's definition is unchanged.
   * Steps added to the flow after export simply have no entry and run fresh;
   * steps whose definition changed are re-run (along with their dependents)
   * instead of trusting stale results. A renamed flow with identical steps
   * keeps identical digests and still imports.
   */
  stepHashes: Record<string, string>;
  /** ISO-8601 timestamp of when the checkpoint was exported. */
  exportedAt: string;
  /** Deep-cloned execution context. */
  context: Record<string, unknown>;
  /** Deep-cloned step results keyed by step name. */
  stepResults: Record<string, unknown>;
  /** Per-step status keyed by step name. */
  stepStatus: Record<string, CheckpointStepStatus>;
  /** Name of the most recently failed step, or `null` if none. */
  lastFailedStepName: string | null;
}
