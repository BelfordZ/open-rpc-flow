import { LoopStep, Step } from './types';

/**
 * The outcome of the parallel-safety analysis for a loop step.
 */
export interface ParallelSafetyDecision {
  /** True when the loop's iterations may run concurrently. */
  parallel: boolean;
  /** Human-readable explanation of the decision (also emitted in debug logs). */
  reason: string;
}

/**
 * Decides whether a loop's iterations may run concurrently.
 *
 * Iterations are independent when no iteration can observe or affect another
 * one: they share only read-only state (outer step results, the frozen flow
 * context, the per-iteration loop variable). A loop runs in parallel unless
 * the loop body — nested steps of any kind plus the loop's own `condition`
 * expression — contains:
 *
 * 1. A `stop` step. Stopping aborts the whole flow through the shared
 *    AbortController, so its effect depends on iteration timing.
 * 2. A reference rooted at the loop step's own name (e.g.
 *    `${processItems.result.value[0]}`): a self-dependency / fold pattern,
 *    since the loop's result only exists once the loop completes. (The loop
 *    variable `as` and `metadata` shadow step results during resolution, so a
 *    root equal to either of those is a per-iteration value, not a self-dep.)
 * 3. A read of `metadata.iteration` (or bare `metadata`, which includes it):
 *    the cross-iteration history array whose contents depend on execution
 *    order. (`metadata.current` describes only the current iteration, so it
 *    is safe.)
 *
 * The analysis is conservative: anything it cannot prove safe runs
 * sequentially, exactly as before. `name`/`description` fields are labels,
 * not expressions, and are excluded from the scan.
 */
export function canRunLoopInParallel(loopStep: LoopStep): ParallelSafetyDecision {
  const references: string[] = [];
  for (const step of nestedSteps(loopStep)) {
    if ('stop' in step) {
      return {
        parallel: false,
        reason: `loop body contains a stop step ('${step.name}'), which aborts the whole flow`,
      };
    }
    collectReferencePaths(step, references);
  }

  for (const raw of references) {
    const segments = referenceSegments(raw);
    const root = segments[0];
    if (root === loopStep.name && root !== loopStep.loop.as && root !== 'metadata') {
      return {
        parallel: false,
        reason:
          "loop body references the loop's own result (${" +
          raw +
          '}); self-dependent loops run sequentially',
      };
    }
    if (root === 'metadata' && (segments.length === 1 || segments[1] === 'iteration')) {
      return {
        parallel: false,
        reason:
          'loop body reads cross-iteration history (${' +
          raw +
          '}); order-dependent loops run sequentially',
      };
    }
  }

  return { parallel: true, reason: 'no self-dependencies detected' };
}

/**
 * Yields a step and every step nested inside it (loop bodies, condition
 * branches, delay steps), so the safety scan sees the whole body subtree.
 */
function* nestedSteps(step: Step): Generator<Step> {
  yield step;
  const record = step as unknown as Record<string, unknown>;

  const loop = record.loop as LoopStep['loop'] | undefined;
  if (loop !== null && typeof loop === 'object') {
    if (loop.step) {
      yield* nestedSteps(loop.step);
    }
    if (Array.isArray(loop.steps)) {
      for (const nested of loop.steps) {
        yield* nestedSteps(nested);
      }
    }
  }

  const condition = record.condition as { then?: Step; else?: Step } | undefined;
  if (condition !== null && typeof condition === 'object') {
    if (condition.then) {
      yield* nestedSteps(condition.then);
    }
    if (condition.else) {
      yield* nestedSteps(condition.else);
    }
  }

  const delay = record.delay as { step?: Step } | undefined;
  if (delay !== null && typeof delay === 'object' && delay.step) {
    yield* nestedSteps(delay.step);
  }
}

/**
 * Collects the inner paths of every `${...}` reference in a value.
 * `name` and `description` are labels, not expressions, and are skipped.
 */
function collectReferencePaths(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    extractReferencePaths(value, out);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectReferencePaths(item, out);
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'name' || key === 'description') {
        continue;
      }
      collectReferencePaths(entry, out);
    }
  }
}

/**
 * Extracts the inner paths of `${...}` references from a string, handling
 * nested `${...}` inside a path (each level is reported).
 */
function extractReferencePaths(value: string, out: string[]): void {
  let i = 0;
  while (i < value.length) {
    const start = value.indexOf('${', i);
    if (start === -1) {
      break;
    }
    let depth = 1;
    let j = start + 2;
    while (j < value.length && depth > 0) {
      if (value.startsWith('${', j)) {
        depth++;
        j += 2;
      } else if (value[j] === '}') {
        depth--;
        j++;
      } else {
        j++;
      }
    }
    if (depth !== 0) {
      break; // Unbalanced; nothing more to extract.
    }
    const inner = value.slice(start + 2, j - 1);
    out.push(inner);
    extractReferencePaths(inner, out);
    i = j;
  }
}

/**
 * Splits a reference path into segments: `steps['a'].result` becomes
 * `['steps', 'a', 'result']`. Surrounding whitespace (insignificant around
 * `.`) and quote characters are stripped.
 */
function referenceSegments(path: string): string[] {
  return path
    .split(/[.[\]]/)
    .map((segment) => segment.trim().replace(/^['"]|['"]$/g, ''))
    .filter((segment) => segment.length > 0);
}
