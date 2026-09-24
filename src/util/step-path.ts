/**
 * Execution-path helpers.
 *
 * Every handler call made by a flow step is tagged with an execution path
 * that identifies which step (and, for loop bodies, which iteration and
 * sub-step) made the call:
 *
 * - top-level step: `fetchUsers`
 * - sub-step of a loop iteration: `processUsers[2].fetchUser`
 * - nested loops compose: `outer[1].inner[0].fetch`
 *
 * Paths are built by `FlowExecutor.executeStep` from the parent path carried
 * in the step's extra context (`_stepPath`), so nested executors (loop,
 * condition, delay) only need to forward the right parent segment. The
 * request executor forwards the computed path to the handler via
 * `JsonRpcHandlerOptions.stepPath`, where recording/replay handlers use it
 * to group calls per path. Grouping (rather than a flat call log) is what
 * keeps recording and replay correct when loop iterations run concurrently:
 * calls are attributed by tag, so interleave order does not matter.
 */

/**
 * Join a path segment onto a parent execution path.
 * A missing parent means the segment is a top-level step.
 */
export function joinStepPath(parentPath: string | undefined, segment: string): string {
  return parentPath ? `${parentPath}.${segment}` : segment;
}

/**
 * Build the path segment for one loop iteration, e.g. `processUsers[2]`.
 * Sub-steps executed inside the iteration append their own segment via
 * {@link joinStepPath}.
 */
export function iterationPathSegment(stepName: string, index: number): string {
  return `${stepName}[${index}]`;
}

/**
 * Extract the owning step name from an execution path (the last segment,
 * e.g. `fetchUser` from `processUsers[2].fetchUser`).
 */
export function stepNameFromPath(path: string): string {
  const lastSegment = path.split('.').pop() ?? path;
  return lastSegment.replace(/\[\d+\]$/, '');
}
