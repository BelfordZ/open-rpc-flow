# TKT-TIMEOUT-006: Implement Request Step Timeout Support

## Description
Add timeout support to the RequestStepExecutor, ensuring that network requests don't exceed configured timeout limits. This will help prevent long-running or stalled requests from blocking flow execution.

## Acceptance Criteria
- Implement timeout enforcement using AbortController or equivalent mechanism
- Properly handle timeout errors and convert to TimeoutError
- Include timeout information in error metadata
- Add tests for request timeout scenarios

## Proposed Interface Changes

```typescript
export class RequestStepExecutor implements StepExecutor {
  // Existing properties and methods
  
  /**
   * Execute a request step with timeout support
   */
  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    // Validate step
    if (!this.canExecute(step)) {
      throw new Error('Invalid step type for RequestStepExecutor');
    }

    const requestStep = step as RequestStep;
    const requestId = this.getNextRequestId();
    
    // Get timeout from context (set by TimeoutResolver)
    const timeout = (context as any).timeout;
    
    // Execute with timeout
    const executeRequest = async () => {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout) : null;
      
      try {
        // Existing request logic, modified to use the abort signal
        
        // Add signal to fetch or other async operations
        const result = await this.jsonRpcHandler({
          jsonrpc: '2.0',
          method: requestStep.request.method,
          params: resolvedParams,
          id: requestId,
        }, { signal: controller.signal });
        
        // Return result
        return {
          result,
          type: StepType.Request,
          metadata: {
            hasError: result && 'error' in result,
            method: requestStep.request.method,
            requestId,
            timestamp: new Date().toISOString(),
          },
        };
      } catch (error: any) {
        // Handle abort error as timeout
        if (error.name === 'AbortError') {
          throw new TimeoutError(
            `Request step "${step.name}" timed out after ${timeout}ms`,
            {
              code: ErrorCode.TIMEOUT_ERROR,
              stepName: step.name,
              requestId,
              timeout,
              retryable: true
            }
          );
        }
        
        // Handle other errors
        throw error;
      } finally {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
      }
    };
    
    // Execute with retry and circuit breaker if configured
    // ... rest of the method
  }
}
```

## Dependencies
- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces
- TKT-TIMEOUT-004: Implement Timeout Resolution Logic

## Estimation
3 story points (5-8 hours) 