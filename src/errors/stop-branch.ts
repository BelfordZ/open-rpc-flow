import type { StepExecutionResult } from '../step-executors/types';

/**
 * Internal control-flow signal thrown by {@link StopStepExecutor} when a
 * stop step does NOT request `endWorkflow`.
 *
 * A bare `stop: {}` terminates the enclosing branch (the rest of a switch
 * case, the rest of a loop iteration, or the rest of the top-level step
 * list) instead of aborting the whole workflow. This class carries that
 * intent up the call stack to the nearest branch boundary.
 *
 * This is NOT an error: it must never be wrapped (e.g. in an
 * ExecutionError), reported as a step failure, or retried. Branch
 * boundaries — the switch case runner, the loop iteration body runner, and
 * the top-level step loop — catch it, report the stop step itself as
 * complete, emit `step:skip` for the steps that will never run, and continue
 * normally. Everything else rethrows it untouched.
 */
export class StopBranch extends Error {
  /** Name of the stop step that terminated the branch. */
  public readonly stepName: string;
  /**
   * The result the stop step would have returned had it completed normally,
   * so boundaries can record and report it as the step's result.
   */
  public readonly result: StepExecutionResult;

  constructor(stepName: string, result: StepExecutionResult) {
    super(`Stop step "${stepName}" terminated its branch`);
    this.name = 'StopBranch';
    this.stepName = stepName;
    this.result = result;

    // Ensure the prototype chain is set up correctly for instanceof checks
    Object.setPrototypeOf(this, StopBranch.prototype);
  }
}
