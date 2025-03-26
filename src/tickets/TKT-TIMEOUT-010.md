# TKT-TIMEOUT-010: Implement Sequence Step Timeout Support

## Description
Add timeout support to the SequenceStepExecutor, ensuring that sequences of steps respect configured timeout limits. This will prevent long-running sequences from blocking flow execution and provide better control over sequence execution time.

## Acceptance Criteria
- Update SequenceStepExecutor to utilize configurable timeouts
- Implement a mechanism to track cumulative execution time across all steps in the sequence
- Pass remaining timeout to each step in the sequence
- Add tests for sequence step timeout scenarios
- Handle partial sequence execution when a timeout occurs

## Proposed Implementation

```typescript
export class SequenceStepExecutor implements StepExecutor {
  constructor(
    private executors: Map<StepType, StepExecutor>,
  ) {}
  
  canExecute(step: Step): boolean {
    return step.type === StepType.Sequence;
  }
  
  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new Error('Invalid step type for SequenceStepExecutor');
    }
    
    const sequenceStep = step as SequenceStep;
    
    // Get timeout from context (set by TimeoutResolver)
    const timeout = (context as any).timeout;
    
    // Start tracking execution time
    const startTime = Date.now();
    const results: any[] = [];
    let lastSuccessfulStep = -1;
    
    try {
      // Execute steps in sequence
      for (let i = 0; i < sequenceStep.steps.length; i++) {
        const currentStep = sequenceStep.steps[i];
        
        // Check if we've already exceeded the timeout
        this.checkTimeout(startTime, timeout, step.name);
        
        // Calculate remaining timeout for the current step
        const elapsedTime = Date.now() - startTime;
        const remainingTimeout = timeout ? Math.max(0, timeout - elapsedTime) : null;
        
        // Create step context with remaining timeout
        const stepContext = {
          ...context,
          timeout: remainingTimeout,
        };
        
        // Find the appropriate executor
        const executor = this.executors.get(currentStep.type);
        if (!executor) {
          throw new Error(`No executor found for step type: ${currentStep.type}`);
        }
        
        // Execute the step
        const stepResult = await executor.execute(currentStep, stepContext, extraContext);
        results.push(stepResult.result);
        lastSuccessfulStep = i;
      }
      
      return {
        result: results,
        type: StepType.Sequence,
        metadata: {
          count: sequenceStep.steps.length,
          completedSteps: lastSuccessfulStep + 1,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      // Handle timeout errors with sequence-specific context
      if (error.code === ErrorCode.TIMEOUT_ERROR) {
        const elapsedTime = Date.now() - startTime;
        throw new TimeoutError(
          `Sequence step "${step.name}" timed out after ${elapsedTime}ms`,
          {
            code: ErrorCode.TIMEOUT_ERROR,
            stepName: step.name,
            timeout,
            elapsed: elapsedTime,
            completedSteps: lastSuccessfulStep + 1,
            totalSteps: sequenceStep.steps.length,
            partialResults: results,
            retryable: true,
          }
        );
      }
      
      // Re-throw other errors
      throw error;
    }
  }
  
  /**
   * Check if execution has exceeded the configured timeout
   */
  private checkTimeout(startTime: number, timeout: number | null, stepName: string): void {
    if (timeout === null) return;
    
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime >= timeout) {
      throw new TimeoutError(
        `Sequence step "${stepName}" timed out after ${timeout}ms`,
        {
          code: ErrorCode.TIMEOUT_ERROR,
          stepName,
          timeout,
          elapsed: elapsedTime,
          retryable: true,
        }
      );
    }
  }
}
```

## Dependencies
- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces
- TKT-TIMEOUT-004: Implement Timeout Resolution Logic

## Estimation
3 story points (5-8 hours) 