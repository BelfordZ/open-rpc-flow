# TKT-TIMEOUT-004: Implement Timeout Resolution Logic

## Description
Create a resolver that determines the effective timeout for a step based on the defined precedence order.

## Acceptance Criteria
- Implement resolution algorithm following the defined precedence order:
  1. Step-level timeout
  2. Flow-level type-specific timeout
  3. Flow-level global timeout
  4. System default for step type
- Handle resolution for all step types
- Handle special case for expression evaluation timeouts
- Include unit tests for all precedence combinations

## Proposed Interface

```typescript
export class TimeoutResolver {
  /**
   * Creates a new TimeoutResolver
   * @param flow The flow containing timeout configurations
   * @param executorOptions Additional timeout options (optional)
   */
  constructor(
    flow: Flow,
    executorOptions?: TimeoutOptions
  );

  /**
   * Maps StepType enum to TimeoutOptions property key
   * @param stepType The step type enum value
   * @returns The corresponding key in TimeoutOptions
   */
  private getTimeoutKey(stepType: StepType): keyof TimeoutOptions;

  /**
   * Get default timeout for a step type using executor classes
   * @param stepType The step type enum value
   * @returns The default timeout for that step type
   */
  private getDefaultTimeoutForType(stepType: StepType): number;

  /**
   * Resolves the timeout for a given step based on the precedence order
   * @param step The step to resolve timeout for
   * @param stepType The type of the step
   * @returns The resolved timeout value in milliseconds
   */
  resolveStepTimeout(step: Step, stepType: StepType): number;

  /**
   * Resolves the timeout specifically for expression evaluation
   * @param step Optional step context for the expression
   * @returns The resolved timeout value in milliseconds
   */
  resolveExpressionTimeout(step?: Step): number;
  
  /**
   * Get the current timeout configuration
   * @returns The current timeout options
   */
  getCurrentTimeouts(): TimeoutOptions;
}
```

## Dependencies
- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces
- TKT-TIMEOUT-002: Define Default Timeout Values
- TKT-TIMEOUT-003: Implement Timeout Validation

## Estimation
2 story points (3-4 hours) 