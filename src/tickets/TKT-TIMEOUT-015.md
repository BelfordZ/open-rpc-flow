# TKT-TIMEOUT-015: Implement Timeout Retry Policies

## Description
Enhance the retry mechanism to handle timeout errors appropriately, allowing users to configure specific retry policies for timeout-related failures. This will improve resilience for operations that may occasionally time out due to transient issues.

## Acceptance Criteria
- Update retry policy handling to specifically handle TimeoutError
- Add timeout-specific retry options to the retry policy configuration
- Allow configuration of different backoff strategies for timeout retries
- Add support for retrying only specific step types when timeouts occur
- Add examples demonstrating timeout retry configuration
- Add tests for timeout retry functionality

## Proposed Implementation

```typescript
/**
 * Extended retry policy configuration with timeout-specific options
 */
export interface RetryPolicyOptions {
  // Existing retry options
  maxRetries?: number;
  backoffStrategy?: BackoffStrategy;
  retryableErrors?: ErrorCode[];
  
  // New timeout-specific retry options
  timeoutRetry?: {
    /**
     * Maximum number of retries for timeout errors
     * Default: 3
     */
    maxRetries?: number;
    
    /**
     * Backoff strategy for timeout retries
     * Default: exponential
     */
    backoffStrategy?: BackoffStrategy;
    
    /**
     * Whether to reset the timeout for retry attempts
     * If true, each retry gets the full timeout duration
     * If false, the original timeout continues to apply
     * Default: true
     */
    resetTimeout?: boolean;
    
    /**
     * Factor to apply to timeout duration for retries
     * Values > 1 increase timeout for retries
     * Values < 1 decrease timeout for retries
     * Default: 1.5 (increase timeout by 50% on retries)
     */
    timeoutMultiplier?: number;
    
    /**
     * Step types to retry on timeout
     * If not specified, all retryable step types are included
     */
    retryableStepTypes?: StepType[];
  };
}

/**
 * Enhancement to RetryPolicy class
 */
export class RetryPolicy {
  private readonly options: Required<RetryPolicyOptions>;
  
  constructor(options: RetryPolicyOptions = {}) {
    // Default options
    this.options = {
      maxRetries: 3,
      backoffStrategy: BackoffStrategy.Exponential,
      retryableErrors: [ErrorCode.EXECUTION_ERROR, ErrorCode.JSON_RPC_ERROR],
      
      // Default timeout retry options
      timeoutRetry: {
        maxRetries: 3,
        backoffStrategy: BackoffStrategy.Exponential,
        resetTimeout: true,
        timeoutMultiplier: 1.5,
        retryableStepTypes: [
          StepType.Request,
          StepType.Loop,
          StepType.Sequence,
          StepType.Parallel,
        ],
        ...options.timeoutRetry,
      },
      
      ...options,
    };
  }
  
  /**
   * Determine if an error is retryable based on policy configuration
   */
  public isRetryable(error: Error, step: Step, retryCount: number): boolean {
    // Handle timeout errors specially
    if (error instanceof TimeoutError) {
      return this.isTimeoutRetryable(error, step, retryCount);
    }
    
    // Handle other errors (existing logic)
    if (retryCount >= this.options.maxRetries) {
      return false;
    }
    
    if ('code' in error && typeof (error as any).code === 'string') {
      const errorCode = (error as any).code as ErrorCode;
      return this.options.retryableErrors.includes(errorCode);
    }
    
    return false;
  }
  
  /**
   * Determine if a timeout error is retryable
   */
  private isTimeoutRetryable(
    error: TimeoutError, 
    step: Step, 
    retryCount: number
  ): boolean {
    const { timeoutRetry } = this.options;
    
    // Check retry count
    if (retryCount >= timeoutRetry.maxRetries) {
      return false;
    }
    
    // Check if this step type is retryable for timeouts
    if (
      timeoutRetry.retryableStepTypes && 
      !timeoutRetry.retryableStepTypes.includes(step.type)
    ) {
      return false;
    }
    
    // Check if the error itself indicates it's retryable
    if (error.isRetryable === false) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Calculate the delay before the next retry attempt
   */
  public calculateRetryDelay(retryCount: number, error?: Error): number {
    // Use timeout-specific backoff strategy for timeout errors
    const backoffStrategy = error instanceof TimeoutError
      ? this.options.timeoutRetry.backoffStrategy
      : this.options.backoffStrategy;
    
    // Calculate delay based on strategy
    switch (backoffStrategy) {
      case BackoffStrategy.Constant:
        return 1000; // 1 second
        
      case BackoffStrategy.Linear:
        return 1000 * retryCount; // linear increase
        
      case BackoffStrategy.Exponential:
      default:
        return 1000 * Math.pow(2, retryCount); // exponential increase
    }
  }
  
  /**
   * Calculate the adjusted timeout for a retry after a timeout error
   */
  public calculateRetryTimeout(originalTimeout: number | null): number | null {
    if (originalTimeout === null) {
      return null;
    }
    
    if (!this.options.timeoutRetry.resetTimeout) {
      return originalTimeout;
    }
    
    // Apply multiplier to the original timeout
    return Math.round(originalTimeout * this.options.timeoutRetry.timeoutMultiplier);
  }
}
```

## Integration with step executors

```typescript
// Example integration with RequestStepExecutor
export class RequestStepExecutor implements StepExecutor {
  // ... existing code ...
  
  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    // ... existing code ...
    
    // Get retry policy from context
    const retryPolicy = context.retryPolicy || new RetryPolicy();
    
    // Execute with retry
    let retryCount = 0;
    let lastError: Error | null = null;
    
    while (true) {
      try {
        // Execute request with timeout
        // ... existing code ...
        
        return result;
      } catch (error: any) {
        lastError = error;
        
        // Check if the error is retryable
        if (retryPolicy.isRetryable(error, step, retryCount)) {
          retryCount++;
          
          // Calculate delay before retry
          const delay = retryPolicy.calculateRetryDelay(retryCount, error);
          
          // Log retry attempt
          this.log(`Retrying request step "${step.name}" after error: ${error.message} (attempt ${retryCount})`);
          
          // Adjust timeout for retry if this is a timeout error
          if (error instanceof TimeoutError) {
            const originalTimeout = (context as any).timeout;
            const adjustedTimeout = retryPolicy.calculateRetryTimeout(originalTimeout);
            
            // Update context with new timeout
            (context as any).timeout = adjustedTimeout;
            
            this.log(`Adjusted timeout for retry: ${adjustedTimeout}ms (original: ${originalTimeout}ms)`);
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // Error is not retryable, re-throw
        throw error;
      }
    }
  }
}
```

## Dependencies
- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces
- TKT-TIMEOUT-012: Implement TimeoutError Class
- TKT-TIMEOUT-013: Update Flow Executor with Timeout Resolution Support

## Estimation
4 story points (8-12 hours) 