# TKT-TIMEOUT-009: Implement Flow-level Execution Timeout Support

## Description

Add comprehensive timeout support to the FlowExecutor, ensuring that the flow execution respects configured timeout limits. This is particularly important for preventing scenarios where a flow with multiple steps takes too long to complete.

## Acceptance Criteria

- Implement flow-level timeout that applies to the entire flow execution
- Ensure proper timeout propagation to individual steps based on the time already spent in the flow
- Add ability to abort all in-progress operations when the flow timeout is reached
- Add tests for flow-level timeout scenarios
- Handle partial results appropriately when a timeout occurs

## Proposed Implementation

```typescript
export class FlowExecutor {
  // Existing properties...
  private flowTimeoutMs: number | null = null;
  private flowStartTime: number | null = null;
  private abortController: AbortController | null = null;

  constructor(
    private flow: Flow,
    private jsonRpcHandler: (request: JsonRpcRequest, options?: { signal?: AbortSignal }) => Promise<any>,
    options?: FlowExecutorOptions,
  ) {
    // Existing initialization...
    
    // Initialize flow timeout if provided
    this.flowTimeoutMs = flow.timeouts?.global || null;
    this.abortController = new AbortController();
    
    // Update jsonRpcHandler reference to support abort signals
    const originalHandler = this.jsonRpcHandler;
    this.jsonRpcHandler = async (request, options) => {
      return originalHandler(request, {
        ...options,
        signal: this.abortController?.signal,
      });
    };
  }

  /**
   * Execute the flow with timeout support
   */
  async execute(): Promise<Map<string, any>> {
    // Start tracking execution time
    this.flowStartTime = Date.now();
    
    // Set up flow-level timeout if configured
    let timeoutId: NodeJS.Timeout | null = null;
    if (this.flowTimeoutMs !== null) {
      timeoutId = setTimeout(() => {
        this.abortController?.abort();
      }, this.flowTimeoutMs);
    }

    try {
      // Get steps in dependency order
      const orderedSteps = this.dependencyResolver.getExecutionOrder();
      const orderedStepNames = orderedSteps.map((s) => s.name);

      this.events.emitDependencyResolved(orderedStepNames);
      this.events.emitFlowStart(this.flow.name, orderedStepNames);

      this.logger.log('Executing steps in order:', orderedStepNames);

      for (const step of orderedSteps) {
        // Check if we've exceeded the flow timeout
        this.checkFlowTimeout();
        
        // Calculate remaining time for the step
        const remainingTime = this.calculateRemainingTime();
        
        // Add remaining time to the execution context
        const stepContext = {
          ...this.executionContext,
          timeout: remainingTime,
          signal: this.abortController?.signal,
        };

        const stepStartTime = Date.now();

        try {
          this.events.emitStepStart(step, stepContext);

          // Execute the step with the updated context
          const result = await this.executeStep(step, {}, stepContext);
          this.stepResults.set(step.name, result);

          this.events.emitStepComplete(step, result, stepStartTime);

          // Check if the step or any nested step resulted in a stop
          const shouldStop = this.checkForStopResult(result);

          if (shouldStop) {
            this.logger.log('Workflow stopped by step:', step.name);
            this.events.emitStepSkip(step, 'Workflow stopped by previous step');
            break;
          }
        } catch (error: any) {
          // Check if timeout occurred
          if (error.name === 'AbortError' || error.code === ErrorCode.TIMEOUT_ERROR) {
            const elapsed = Date.now() - this.flowStartTime!;
            throw new TimeoutError(
              `Flow execution timed out after ${elapsed}ms during execution of step "${step.name}"`,
              {
                code: ErrorCode.TIMEOUT_ERROR,
                flowName: this.flow.name,
                stepName: step.name,
                timeout: this.flowTimeoutMs,
                elapsed,
              }
            );
          }
          
          this.events.emitStepError(step, error, stepStartTime);
          throw error;
        }
      }

      this.events.emitFlowComplete(this.flow.name, this.stepResults, this.flowStartTime);
      return this.stepResults;
    } catch (error: any) {
      this.events.emitFlowError(this.flow.name, error, this.flowStartTime);
      throw error;
    } finally {
      // Clean up timeout
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Check if the flow execution has exceeded the timeout
   */
  private checkFlowTimeout(): void {
    if (this.flowTimeoutMs === null || this.flowStartTime === null) {
      return;
    }
    
    const elapsed = Date.now() - this.flowStartTime;
    if (elapsed >= this.flowTimeoutMs) {
      throw new TimeoutError(`Flow execution timed out after ${elapsed}ms`, {
        code: ErrorCode.TIMEOUT_ERROR,
        flowName: this.flow.name,
        timeout: this.flowTimeoutMs,
        elapsed,
      });
    }
  }

  /**
   * Calculate the remaining time for step execution
   */
  private calculateRemainingTime(): number | null {
    if (this.flowTimeoutMs === null || this.flowStartTime === null) {
      return null;
    }
    
    const elapsed = Date.now() - this.flowStartTime;
    const remaining = Math.max(0, this.flowTimeoutMs - elapsed);
    
    return remaining;
  }

  // Existing methods...
}
```

## Dependencies

- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces
- TKT-TIMEOUT-004: Implement Timeout Resolution Logic

## Estimation

3 story points (5-8 hours)

## Status

**NOT IMPLEMENTED**

The current FlowExecutor has basic timeout support through the TimeoutResolver system for individual steps, but lacks comprehensive flow-level timeout management. This ticket proposes adding:

1. Flow-level timeout tracking with AbortController support
2. Dynamic calculation of remaining time for steps based on flow execution progress
3. Proper propagation of timeout signals to all step executors
4. Comprehensive error handling for flow-level timeouts

These enhancements would make the timeout system more robust and prevent long-running flows from consuming excessive resources.

**Recommendation:** Implement the proposed flow-level timeout management to complement the existing step-level timeout capabilities.
