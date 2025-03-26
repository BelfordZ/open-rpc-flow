# TKT-TIMEOUT-011: Implement Loop Step Timeout Support

## Description
Add timeout support to the LoopStepExecutor, ensuring that loop executions respect configured timeout limits. This is critical for preventing infinite loops or excessively long loop executions from hanging the application.

## Acceptance Criteria
- Update LoopStepExecutor to utilize configurable timeouts
- Implement a mechanism to track cumulative execution time across all loop iterations
- Pass remaining timeout to each loop iteration
- Add a safety mechanism to prevent infinite loops
- Add tests for loop step timeout scenarios
- Include iteration count in error information when timeout occurs

## Proposed Implementation

```typescript
export class LoopStepExecutor implements StepExecutor {
  constructor(
    private expressionEvaluator: SafeExpressionEvaluator,
    private executors: Map<StepType, StepExecutor>,
  ) {}
  
  canExecute(step: Step): boolean {
    return step.type === StepType.Loop;
  }
  
  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new Error('Invalid step type for LoopStepExecutor');
    }
    
    const loopStep = step as LoopStep;
    
    // Get timeout from context (set by TimeoutResolver)
    const timeout = (context as any).timeout;
    
    // Start tracking execution time
    const startTime = Date.now();
    let currentIterationIndex = 0;
    const results: any[] = [];
    
    try {
      // Get the items to iterate over
      const itemsToIterate = await this.expressionEvaluator.evaluateExpression(
        loopStep.over,
        { ...context, ...extraContext },
        timeout
      );
      
      if (!Array.isArray(itemsToIterate)) {
        throw new Error(`Loop step requires an array to iterate over, got: ${typeof itemsToIterate}`);
      }
      
      // Set a maximum number of iterations as a safety measure
      // This can be overridden by configuration in the future
      const maxIterations = 1000; // Reasonable default
      const itemCount = Math.min(itemsToIterate.length, maxIterations);
      
      // Execute the loop
      for (currentIterationIndex = 0; currentIterationIndex < itemCount; currentIterationIndex++) {
        // Check if we've already exceeded the timeout
        this.checkTimeout(startTime, timeout, step.name, currentIterationIndex);
        
        // Get the current item
        const currentItem = itemsToIterate[currentIterationIndex];
        
        // Calculate remaining timeout for this iteration
        const elapsedTime = Date.now() - startTime;
        const remainingTimeout = timeout ? Math.max(0, timeout - elapsedTime) : null;
        
        // Create iteration context
        const iterationContext = {
          ...context,
          [loopStep.as]: currentItem,
          currentItem, // Also provide the current item generically
          currentIndex: currentIterationIndex,
          timeout: remainingTimeout,
        };
        
        // Find the appropriate executor for the do step
        const executor = this.executors.get(loopStep.do.type);
        if (!executor) {
          throw new Error(`No executor found for step type: ${loopStep.do.type}`);
        }
        
        // Execute the step for this iteration
        const iterationResult = await executor.execute(
          loopStep.do,
          iterationContext,
          extraContext
        );
        
        results.push(iterationResult.result);
      }
      
      return {
        result: results,
        type: StepType.Loop,
        metadata: {
          iterationCount: currentIterationIndex,
          totalItems: itemsToIterate.length,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      // Handle timeout errors with loop-specific context
      if (error.code === ErrorCode.TIMEOUT_ERROR) {
        const elapsedTime = Date.now() - startTime;
        throw new TimeoutError(
          `Loop step "${step.name}" timed out after ${elapsedTime}ms during iteration ${currentIterationIndex}`,
          {
            code: ErrorCode.TIMEOUT_ERROR,
            stepName: step.name,
            timeout,
            elapsed: elapsedTime,
            currentIteration: currentIterationIndex,
            completedIterations: currentIterationIndex,
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
  private checkTimeout(startTime: number, timeout: number | null, stepName: string, iteration: number): void {
    if (timeout === null) return;
    
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime >= timeout) {
      throw new TimeoutError(
        `Loop step "${stepName}" timed out after ${timeout}ms during iteration ${iteration}`,
        {
          code: ErrorCode.TIMEOUT_ERROR,
          stepName,
          timeout,
          elapsed: elapsedTime,
          currentIteration: iteration,
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
- TKT-TIMEOUT-005: Update Expression Evaluator with Configurable Timeouts

## Estimation
4 story points (8-12 hours) 