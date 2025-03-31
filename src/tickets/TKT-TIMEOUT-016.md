# TKT-TIMEOUT-016: Add Timeout Support to Flow API

## Description
Update the Flow class API to include timeout configuration methods. This will provide users with a clean, fluent interface for configuring timeouts at both the flow and individual step levels.

## Acceptance Criteria
- Add timeout configuration methods to the Flow class
- Support setting global and per-step-type timeouts at the flow level
- Support setting timeouts on individual steps
- Ensure backward compatibility with existing flow definitions
- Add validation for timeout values
- Update documentation with examples of the new API
- Add tests for the timeout configuration methods

## Proposed Implementation

```typescript
/**
 * Enhanced Flow class with timeout configuration methods
 */
export class Flow {
  private timeoutConfig: TimeoutOptions = {};
  
  /**
   * Set a global timeout for all steps in the flow
   * 
   * @param timeout Timeout in milliseconds, or null for no timeout
   * @returns The Flow instance for chaining
   */
  public setTimeout(timeout: number | null): Flow {
    this.validateTimeout(timeout);
    this.timeoutConfig.global = timeout;
    return this;
  }
  
  /**
   * Set timeouts for specific step types in the flow
   * 
   * @param timeouts Object mapping step types to timeout values
   * @returns The Flow instance for chaining
   */
  public setTimeouts(timeouts: Partial<Record<StepType, number | null>>): Flow {
    // Validate all timeout values
    Object.entries(timeouts).forEach(([_, timeout]) => {
      this.validateTimeout(timeout);
    });
    
    // Merge with existing timeouts
    this.timeoutConfig = {
      ...this.timeoutConfig,
      ...timeouts,
    };
    
    return this;
  }
  
  /**
   * Set timeout for a specific step by name
   * 
   * @param stepName Name of the step to configure
   * @param timeout Timeout in milliseconds, or null for no timeout
   * @returns The Flow instance for chaining
   */
  public setStepTimeout(stepName: string, timeout: number | null): Flow {
    this.validateTimeout(timeout);
    
    // Find the step and set its timeout
    this.applyToStep(stepName, step => {
      step.timeout = timeout;
    });
    
    return this;
  }
  
  /**
   * Validate a timeout value
   * 
   * @param timeout Timeout value to validate
   * @throws {Error} If the timeout is invalid
   */
  private validateTimeout(timeout: number | null): void {
    if (timeout !== null && (typeof timeout !== 'number' || timeout <= 0 || !Number.isInteger(timeout))) {
      throw new Error(`Invalid timeout value: ${timeout}. Timeout must be a positive integer or null.`);
    }
  }
  
  /**
   * Apply a function to a step with the given name
   * 
   * @param stepName Name of the step to modify
   * @param fn Function to apply to the step
   */
  private applyToStep(stepName: string, fn: (step: Step) => void): void {
    // Search for the step in the flow
    const findAndApply = (step: Step) => {
      if (step.name === stepName) {
        fn(step);
        return true;
      }
      
      // Search in nested steps if applicable
      switch (step.type) {
        case StepType.Sequence:
          return (step as SequenceStep).steps.some(findAndApply);
        case StepType.Parallel:
          return (step as ParallelStep).steps.some(findAndApply);
        case StepType.Branch:
          const branchStep = step as BranchStep;
          return (
            (branchStep.then && findAndApply(branchStep.then)) ||
            (branchStep.else && findAndApply(branchStep.else))
          );
        case StepType.Loop:
          return findAndApply((step as LoopStep).do);
        default:
          return false;
      }
    };
    
    // Start search from top-level steps
    const found = this.steps.some(findAndApply);
    
    if (!found) {
      throw new Error(`Step with name "${stepName}" not found in flow`);
    }
  }
  
  /**
   * Get the flow definition including timeout configuration
   */
  public toJSON(): any {
    const flowDefinition = {
      // Existing flow properties
      id: this.id,
      name: this.name,
      steps: this.steps,
      // Add timeout configuration if present
      ...(Object.keys(this.timeoutConfig).length > 0 ? { timeouts: this.timeoutConfig } : {}),
    };
    
    return flowDefinition;
  }
  
  // ... existing methods ...
}
```

## Example usage

```typescript
// Create a flow with various timeout configurations
const flow = new Flow()
  .name('My Flow')
  .description('A flow with timeout configuration')
  // Set a global timeout for all steps
  .setTimeout(30000) // 30 seconds global timeout
  // Set specific timeouts for different step types
  .setTimeouts({
    [StepType.Request]: 10000,    // 10 seconds for requests
    [StepType.Transform]: 5000,   // 5 seconds for transformations
    [StepType.Loop]: 60000,       // 1 minute for loops
  })
  // Add steps to the flow
  .addStep(
    // Request step
    new Step()
      .name('fetchData')
      .type(StepType.Request)
      .request({
        method: 'eth_getBalance',
        params: ['0x407d73d8a49eeb85d32cf465507dd71d507100c1', 'latest'],
      })
  )
  // Set a timeout for a specific step
  .setStepTimeout('fetchData', 15000) // Override with 15 seconds for this specific step
  // Continue building the flow
  .addStep(
    // ...
  );
```

## Dependencies
- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces
- TKT-TIMEOUT-003: Implement Timeout Validation

## Estimation
3 story points (5-8 hours) 