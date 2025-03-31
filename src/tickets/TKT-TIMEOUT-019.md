# TKT-TIMEOUT-019: Implement Timeout Context Propagation Utility

## Description

Implement a utility to handle proper timeout propagation through nested step execution context. This will ensure that parent step timeouts are correctly inherited and adjusted by child steps, preventing issues with nested step execution.

## Acceptance Criteria

- Create a TimeoutContext class to track and propagate timeout information
- Implement mechanisms to pass remaining time to child steps
- Support overriding parent timeouts with step-specific timeouts
- Add utilities for checking if timeouts are exceeded
- Create helpers for calculating remaining time
- Add test coverage for various nesting scenarios
- Document the approach with examples

## Proposed Implementation

```typescript
/**
 * Handles timeout context propagation through nested step execution
 */
export class TimeoutContext {
  /**
   * Start time of the current execution context
   */
  private readonly startTime: number;

  /**
   * Create a new timeout context
   *
   * @param timeout The timeout value in milliseconds, or null for no timeout
   * @param parentContext Optional parent context for nested execution
   */
  constructor(
    private readonly timeout: number | null,
    private readonly parentContext?: TimeoutContext,
  ) {
    this.startTime = Date.now();
  }

  /**
   * Get the current timeout value
   *
   * @returns The timeout in milliseconds, or null if no timeout is set
   */
  public getTimeout(): number | null {
    return this.timeout;
  }

  /**
   * Check if execution has exceeded the configured timeout
   *
   * @param stepName Name of the step being checked
   * @returns Nothing if within timeout, throws TimeoutError if exceeded
   * @throws TimeoutError if the timeout has been exceeded
   */
  public checkTimeout(stepName: string): void {
    if (this.timeout === null) return;

    const elapsed = this.getElapsedTime();
    if (elapsed >= this.timeout) {
      throw new TimeoutError(
        `Step "${stepName}" timed out after ${elapsed}ms (limit: ${this.timeout}ms)`,
        {
          code: ErrorCode.TIMEOUT_ERROR,
          stepName,
          timeout: this.timeout,
          elapsed,
          retryable: true,
        },
      );
    }
  }

  /**
   * Get the elapsed time since this context was created
   *
   * @returns Elapsed time in milliseconds
   */
  public getElapsedTime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Get the remaining time before timeout
   *
   * @returns Remaining time in milliseconds, or null if no timeout
   */
  public getRemainingTime(): number | null {
    if (this.timeout === null) return null;

    const elapsed = this.getElapsedTime();
    return Math.max(0, this.timeout - elapsed);
  }

  /**
   * Create a child timeout context for nested step execution
   *
   * @param childTimeout Optional specific timeout for the child context
   * @returns A new TimeoutContext with appropriate timeout inheritance
   */
  public createChildContext(childTimeout?: number | null): TimeoutContext {
    // If child has explicit timeout, use it
    if (childTimeout !== undefined) {
      return new TimeoutContext(childTimeout, this);
    }

    // Otherwise inherit remaining time from parent
    return new TimeoutContext(this.getRemainingTime(), this);
  }

  /**
   * Get the total elapsed time including all parent contexts
   *
   * @returns Total elapsed time across the context hierarchy
   */
  public getTotalElapsedTime(): number {
    let elapsed = this.getElapsedTime();

    if (this.parentContext) {
      elapsed += this.parentContext.getTotalElapsedTime();
    }

    return elapsed;
  }

  /**
   * Check if any timeout in the context hierarchy has been exceeded
   *
   * @param stepName Name of the step being checked
   * @throws TimeoutError if any timeout in the hierarchy has been exceeded
   */
  public checkHierarchyTimeout(stepName: string): void {
    // Check current context timeout
    this.checkTimeout(stepName);

    // Check parent context timeout if exists
    if (this.parentContext) {
      this.parentContext.checkHierarchyTimeout(stepName);
    }
  }
}
```

## Integration with StepExecutionContext

```typescript
/**
 * Enhanced Step Execution Context with timeout context
 */
export interface StepExecutionContext {
  // Existing properties
  initialContext: Record<string, any>;
  flowResults: Record<string, StepExecutionResult>;

  // New timeout context
  timeoutContext: TimeoutContext;
}

/**
 * Usage in FlowExecutor
 */
export class FlowExecutor {
  // ...existing code...

  private async executeStep(
    step: Step,
    context: StepExecutionContext,
  ): Promise<StepExecutionResult> {
    // Get the appropriate executor
    const executor = this.stepExecutors.get(step.type);
    if (!executor) {
      throw new Error(`No executor found for step type: ${step.type}`);
    }

    // Check timeout before execution
    context.timeoutContext.checkTimeout(step.name);

    // Execute the step
    return await executor.execute(step, context);
  }

  async execute(
    flow: Flow,
    initialContext: Record<string, any> = {},
  ): Promise<FlowExecutionResult> {
    try {
      // Resolve the top-level timeout for the flow's main step
      const timeout = this.resolveTimeout(flow.steps[0], flow);

      // Create the initial timeout context
      const timeoutContext = new TimeoutContext(timeout);

      // Create execution context
      const context: StepExecutionContext = {
        initialContext,
        flowResults: {},
        timeoutContext,
      };

      // Execute the flow
      // ...existing code...
    } catch (error) {
      // ...existing error handling...
    }
  }
}
```

## Usage in Nested Step Executors

```typescript
// Example usage in SequenceStepExecutor
export class SequenceStepExecutor implements StepExecutor {
  // ...existing code...

  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new Error('Invalid step type for SequenceStepExecutor');
    }

    const sequenceStep = step as SequenceStep;
    const results: any[] = [];

    // Execute steps in sequence
    for (const childStep of sequenceStep.steps) {
      // Check current timeout before starting the child step
      context.timeoutContext.checkTimeout(step.name);

      // Create child context with timeout inheritance
      const childContext: StepExecutionContext = {
        ...context,
        // Create child timeout context, possibly with step-specific timeout
        timeoutContext: context.timeoutContext.createChildContext(childStep.timeout),
      };

      // Find the appropriate executor
      const executor = this.executors.get(childStep.type);
      if (!executor) {
        throw new Error(`No executor found for step type: ${childStep.type}`);
      }

      // Execute the child step
      const childResult = await executor.execute(childStep, childContext, extraContext);
      results.push(childResult.result);
    }

    return {
      result: results,
      type: StepType.Sequence,
      metadata: {
        count: sequenceStep.steps.length,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
```

## Dependencies

- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces
- TKT-TIMEOUT-004: Implement Timeout Resolution Logic
- TKT-TIMEOUT-012: Implement TimeoutError Class

## Estimation

3 story points (5-8 hours)
