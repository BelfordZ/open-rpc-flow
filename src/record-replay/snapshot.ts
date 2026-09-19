/**
 * Snapshots a value into JSON-serializable form. Used to freeze trace data at
 * record time (so later mutation can't corrupt the trace) and to isolate
 * replay consumers from each other.
 *
 * Never throws: unserializable values (circular structures, BigInt, ...)
 * degrade to `null` rather than breaking the flow being recorded or replayed.
 */
export function snapshot(value: unknown): unknown {
  try {
    if (value === undefined) {
      return null;
    }
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}
