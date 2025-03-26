# TKT-TIMEOUT-009: Implement Parallel Step Timeout Support

## Description
Add timeout support to the ParallelStepExecutor, ensuring that steps executed in parallel respect configured timeout limits. This is particularly important for preventing scenarios where one or more slow parallel operations cause the entire flow to hang.

## Acceptance Criteria
- Update ParallelStepExecutor to utilize configurable timeouts
- Implement a mechanism to abort all parallel executions when a timeout occurs
- Ensure timeout applies to the entire parallel execution, not individual steps
- Add tests for parallel step timeout scenarios
- Handle partial results/errors appropriately when a timeout occurs

## Proposed Implementation

```typescript
export class ParallelStepExecutor implements StepExecutor {
  constructor(
    private executors: Map<StepType, StepExecutor>,
  ) {}
  
  canExecute(step: Step): boolean {
    return step.type === StepType.Parallel;
  }
  
  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new Error('Invalid step type for ParallelStepExecutor');
    }
    
    const parallelStep = step as ParallelStep;
    
    // Get timeout from context (set by TimeoutResolver)
    const timeout = (context as any).timeout;
    
    // Start tracking execution time
    const startTime = Date.now();
    
    // Prepare execution with timeout
    const executeWithTimeout = async () => {
      // Set up AbortController for parallel execution
      const controller = new AbortController();
      const signal = controller.signal;
      
      // Set up timeout if configured
      const timeoutId = timeout 
        ? setTimeout(() => controller.abort(), timeout) 
        : null;
      
      try {
        // Execute all steps in parallel
        const executeSteps = parallelStep.steps.map(async (step, index) => {
          // Find the appropriate executor
          const executor = this.executors.get(step.type);
          if (!executor) {
            throw new Error(`No executor found for step type: ${step.type}`);
          }
          
          // Create child context with signal
          const stepContext = {
            ...context,
            signal, // Pass abort signal to child steps
          };
          
          try {
            // Execute the step
            return await executor.execute(step, stepContext, extraContext);
          } catch (error) {
            // Check if aborted (timeout)
            if (signal.aborted) {
              const elapsedTime = Date.now() - startTime;
              throw new TimeoutError(
                `Parallel step "${parallelStep.name}" timed out after ${elapsedTime}ms during execution of child step "${step.name}"`,
                {
                  code: ErrorCode.TIMEOUT_ERROR,
                  stepName: parallelStep.name,
                  childStepName: step.name,
                  childStepIndex: index,
                  timeout,
                  elapsed: elapsedTime,
                  retryable: true,
                }
              );
            }
            
            // Re-throw other errors
            throw error;
          }
        });
        
        // Wait for all steps to complete or timeout
        const results = await Promise.all(executeSteps);
        
        // Extract results from each execution
        const parallelResults = results.map(result => result.result);
        
        return {
          result: parallelResults,
          type: StepType.Parallel,
          metadata: {
            count: parallelStep.steps.length,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error: any) {
        // Handle AbortError (from timeout) 
        if (error.name === 'AbortError') {
          const elapsedTime = Date.now() - startTime;
          throw new TimeoutError(
            `Parallel step "${parallelStep.name}" timed out after ${elapsedTime}ms`,
            {
              code: ErrorCode.TIMEOUT_ERROR,
              stepName: parallelStep.name,
              timeout,
              elapsed: elapsedTime,
              retryable: true,
            }
          );
        }
        
        // Re-throw other errors (including TimeoutError from child steps)
        throw error;
      } finally {
        // Clean up timeout
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }
    };
    
    return await executeWithTimeout();
  }
}
```

## Dependencies
- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces
- TKT-TIMEOUT-004: Implement Timeout Resolution Logic

## Estimation
4 story points (8-12 hours) 