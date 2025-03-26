# TKT-TIMEOUT-008: Implement Branch Step Timeout Support

## Description
Add timeout support to the BranchStepExecutor, ensuring that conditional evaluations and branch executions respect configured timeout limits. This will prevent infinite loops or excessively long branch evaluations from hanging the application.

## Acceptance Criteria
- Update BranchStepExecutor to utilize configurable timeouts for condition evaluation
- Pass appropriate timeout values to child branches
- Implement a mechanism to track cumulative execution time across all branches
- Add tests for branch step timeout scenarios

## Proposed Implementation

```typescript
export class BranchStepExecutor implements StepExecutor {
  constructor(
    private expressionEvaluator: SafeExpressionEvaluator,
    private executors: Map<StepType, StepExecutor>,
  ) {}
  
  canExecute(step: Step): boolean {
    return step.type === StepType.Branch;
  }
  
  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new Error('Invalid step type for BranchStepExecutor');
    }
    
    const branchStep = step as BranchStep;
    
    // Get timeout from context (set by TimeoutResolver)
    const timeout = (context as any).timeout;
    
    // Start tracking execution time
    const startTime = Date.now();
    
    try {
      // Evaluate condition with timeout
      const conditionResult = await this.expressionEvaluator.evaluateExpression(
        branchStep.condition,
        { ...context, ...extraContext },
        timeout
      );
      
      // Check if we've already exceeded the timeout
      this.checkTimeout(startTime, timeout, step.name);
      
      // Determine which branch to take
      const branch = conditionResult ? branchStep.then : branchStep.else;
      
      if (!branch) {
        // No branch to execute
        return {
          result: conditionResult,
          type: StepType.Branch,
          metadata: {
            condition: branchStep.condition,
            conditionResult,
            timestamp: new Date().toISOString(),
          },
        };
      }
      
      // Calculate remaining timeout for the branch execution
      const elapsedTime = Date.now() - startTime;
      const remainingTimeout = timeout ? Math.max(0, timeout - elapsedTime) : null;
      
      // Execute the selected branch with the remaining timeout
      const branchContext = {
        ...context,
        timeout: remainingTimeout,
      };
      
      // Get the appropriate executor for the branch step
      const executor = this.executors.get(branch.type);
      if (!executor) {
        throw new Error(`No executor found for step type: ${branch.type}`);
      }
      
      // Execute the branch
      const branchResult = await executor.execute(branch, branchContext, extraContext);
      
      return {
        result: branchResult.result,
        type: StepType.Branch,
        metadata: {
          condition: branchStep.condition,
          conditionResult,
          executedBranch: conditionResult ? 'then' : 'else',
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      // Handle timeout errors with additional context
      if (error.code === ErrorCode.TIMEOUT_ERROR) {
        throw new TimeoutError(
          `Branch step "${step.name}" timed out after ${timeout}ms`,
          {
            code: ErrorCode.TIMEOUT_ERROR,
            stepName: step.name,
            condition: branchStep.condition,
            timeout,
            originalError: error,
            retryable: false,
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
        `Branch step "${stepName}" timed out after ${timeout}ms`,
        {
          code: ErrorCode.TIMEOUT_ERROR,
          stepName,
          timeout,
          elapsed: elapsedTime,
          retryable: false,
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
3 story points (5-8 hours) 