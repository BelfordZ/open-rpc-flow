# TKT-TIMEOUT-005: Update Expression Evaluator with Configurable Timeouts

## Description
Modify the SafeExpressionEvaluator to use dynamic timeouts instead of the current hardcoded value (1000ms). This will allow for more flexible timeout configuration in expressions.

## Acceptance Criteria
- Add timeout parameter to the evaluator constructor
- Update checkTimeout method to use configured timeout
- Add method to dynamically update timeout value
- Add tests for different timeout scenarios

## Proposed Interface Changes

```typescript
export class SafeExpressionEvaluator {
  // Existing properties
  private static readonly MAX_EXPRESSION_LENGTH = 1000;
  private timeoutMs: number; // Changed from const 1000ms to variable
  private logger: Logger;

  /**
   * Create a new SafeExpressionEvaluator with configurable timeout
   */
  constructor(
    logger: Logger,
    private referenceResolver: ReferenceResolver,
    timeoutMs?: number // New optional parameter
  ) {
    this.logger = logger.createNested('SafeExpressionEvaluator');
    this.timeoutMs = timeoutMs || 1000; // Default to 1000ms if not specified
  }

  /**
   * Set a new timeout value for expression evaluation
   * @param timeoutMs The new timeout value in milliseconds
   */
  setTimeoutMs(timeoutMs: number): void {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Get the current timeout value
   * @returns The current timeout in milliseconds
   */
  getTimeoutMs(): number {
    return this.timeoutMs;
  }

  /**
   * Check if evaluation has exceeded timeout
   * Uses the configured timeout value instead of hardcoded 1000ms
   */
  private checkTimeout(startTime: number): void {
    const elapsed = Date.now() - startTime;
    if (elapsed > this.timeoutMs) {
      throw new ExpressionError(`Expression evaluation timed out after ${elapsed}ms`);
    }
  }

  // Rest of the class remains the same
}
```

## Dependencies
- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces
- TKT-TIMEOUT-004: Implement Timeout Resolution Logic

## Estimation
2 story points (3-4 hours) 