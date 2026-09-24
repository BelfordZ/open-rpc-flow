/**
 * Stale-trace detection: compare a recorded trace's per-step digests against
 * current ones, so replay fails fast and clearly instead of dying mid-run in
 * param matching. See issue #153.
 *
 * The digests are opaque strings in the same shape as checkpoint `stepHashes`
 * (#179) — the shared substrate between resume and replay. This module
 * deliberately does not hash flow definitions itself; the caller supplies the
 * current digest map (record them with `getTrace(flowName, stepHashes)` and
 * recompute them the same way at replay time).
 */
import type { RecordedTrace } from './types';
import { ReplayError } from './types';

/**
 * Validate a recorded trace against current step-definition digests.
 *
 * Throws {@link ReplayError} naming the stale steps when a step recorded in
 * the trace has a different digest now — replaying it would serve calls the
 * flow no longer makes, so re-record instead. Steps absent from the current
 * map (removed steps) are ignored: their recorded groups simply go
 * unconsumed, which `getReplayReport()` surfaces.
 */
export function validateTraceForFlow(
  trace: RecordedTrace,
  currentStepHashes: Record<string, string>,
): void {
  const recorded = trace?.stepHashes;
  if (!recorded) {
    return;
  }
  const stale: string[] = [];
  for (const [name, digest] of Object.entries(recorded)) {
    const current = currentStepHashes[name];
    if (current !== undefined && current !== digest) {
      stale.push(name);
    }
  }
  if (stale.length > 0) {
    throw new ReplayError(
      `Recorded trace is stale for changed step(s): ${stale.map((name) => `"${name}"`).join(', ')}. ` +
        `Replaying would serve calls the flow no longer makes — re-record the trace.`,
    );
  }
}
