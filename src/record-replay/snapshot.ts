/**
 * Snapshots a value into JSON-serializable form. Used to freeze trace data at
 * record time (so later mutation can't corrupt the trace) and to isolate
 * replay consumers from each other.
 *
 * Throws on values that are not JSON-serializable (circular structures,
 * BigInt, ...). This matches the checkpoint policy (#179): a trace that
 * silently degrades values to `null` would replay corrupted responses, and a
 * replay that silently returns the wrong response is worse than one that
 * fails. `undefined` still maps to `null` (JSON has no undefined).
 */
export function snapshot(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (thrown) {
    const reason = thrown instanceof Error ? thrown.message : String(thrown);
    throw new Error(`Cannot record or replay a value that is not JSON-serializable: ${reason}`);
  }
}
