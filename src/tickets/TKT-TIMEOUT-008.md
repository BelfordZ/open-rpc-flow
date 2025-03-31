# TKT-TIMEOUT-008: Implement Condition Step Timeout Support

## Description

Add timeout support to the ConditionStepExecutor, ensuring that conditional evaluations and branch executions respect configured timeout limits. This will prevent infinite loops or excessively long branch evaluations from hanging the application.

## Acceptance Criteria

- Update ConditionStepExecutor to utilize configurable timeouts for condition evaluation
- Pass appropriate timeout values to child branches
- Implement a mechanism to track cumulative execution time across all branches
- Add tests for condition step timeout scenarios

## Proposed Implementation

```typescript
export class ConditionStepExecutor implements StepExecutor {
  constructor(
    private executeStep: (
      step: Step,
      extraContext?: Record<string, any>,
    ) => Promise<StepExecutionResult>,
    logger: Logger,
  ) {
    this.logger = logger.createNested('ConditionStepExecutor');
  }

  canExecute(step: Step): step is ConditionStep {
    return 'condition' in step;
  }

  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new Error('Invalid step type for ConditionStepExecutor');
    }

    const conditionStep = step as ConditionStep;

    // Get timeout from context (set by TimeoutResolver)
    const timeout = (context as any).timeout;

    // Start tracking execution time
    const startTime = Date.now();

    this.logger.debug('Evaluating condition', {
      stepName: step.name,
      condition: conditionStep.condition.if,
    });

    try {
      // Evaluate condition with timeout tracking
      const conditionValue = context.expressionEvaluator.evaluate(
        conditionStep.condition.if,
        extraContext,
        step // Pass the step for timeout resolution
      );

      // Check if we've already exceeded the timeout
      this.checkTimeout(startTime, timeout, step.name);

      this.logger.debug('Condition evaluated', {
        stepName: step.name,
        result: conditionValue,
      });

      let value: StepExecutionResult | undefined;
      let branchTaken: 'then' | 'else' | undefined;

      if (conditionValue) {
        this.logger.debug('Executing then branch', { stepName: step.name });
        
        // Calculate remaining timeout for the branch execution
        const elapsedTime = Date.now() - startTime;
        const remainingTimeout = timeout ? Math.max(0, timeout - elapsedTime) : null;
        
        // Create nested context with timeout
        const nestedContext = {
          ...extraContext,
          _nestedStep: true,
          _parentStep: step.name,
          timeout: remainingTimeout // Pass remaining timeout to child
        };
        
        value = await this.executeStep(conditionStep.condition.then, nestedContext);
        branchTaken = 'then';
      } else if (conditionStep.condition.else) {
        this.logger.debug('Executing else branch', { stepName: step.name });
        
        // Calculate remaining timeout for the branch execution
        const elapsedTime = Date.now() - startTime;
        const remainingTimeout = timeout ? Math.max(0, timeout - elapsedTime) : null;
        
        // Create nested context with timeout
        const nestedContext = {
          ...extraContext,
          _nestedStep: true,
          _parentStep: step.name,
          timeout: remainingTimeout // Pass remaining timeout to child
        };
        
        value = await this.executeStep(conditionStep.condition.else, nestedContext);
        branchTaken = 'else';
      } else {
        branchTaken = 'else';
      }

      this.logger.debug('Condition execution completed', {
        stepName: step.name,
        branchTaken,
        conditionValue,
      });

      return {
        type: StepType.Condition,
        result: value,
        metadata: {
          branchTaken,
          conditionValue,
          condition: conditionStep.condition.if,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      // Handle timeout errors with additional context
      if (error.code === ErrorCode.TIMEOUT_ERROR) {
        throw new TimeoutError(`Condition step "${step.name}" timed out after ${timeout}ms`, {
          code: ErrorCode.TIMEOUT_ERROR,
          stepName: step.name,
          condition: conditionStep.condition.if,
          timeout,
          originalError: error,
          retryable: false,
        });
      }

      this.logger.error('Condition execution failed', {
        stepName: step.name,
        error: error.toString(),
      });
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
      throw new TimeoutError(`Condition step "${stepName}" timed out after ${timeout}ms`, {
        code: ErrorCode.TIMEOUT_ERROR,
        stepName,
        timeout,
        elapsed: elapsedTime,
        retryable: false,
      });
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

## Status

**NOT IMPLEMENTED**

The codebase has a `ConditionStepExecutor` that lacks the timeout features described in this ticket:

1. **Issues with the current implementation:**
   - The `ConditionStepExecutor` doesn't read or use timeout information from the context
   - There is no tracking of execution time during condition evaluation or branch execution
   - No mechanism to pass remaining timeout to child branches
   - No specific handling for timeout errors
   - No dedicated timeout checks at different stages of execution
   - No tests for timeout scenarios in condition execution

2. **Current behavior:**
   - The executor relies on the `context.expressionEvaluator` for condition evaluation, which may have its own timeout handling
   - The executor uses the `executeStep` callback provided in its constructor to execute the chosen branch
   - There's no passing of timeout information to nested steps

The timeout functionality proposed in this ticket would significantly improve the robustness of the `ConditionStepExecutor` by preventing long-running or infinite conditions from hanging the application. Currently, there appears to be no equivalent feature implemented in the codebase.

**Recommendation:** Implement the proposed timeout support in the existing `ConditionStepExecutor` as described above, ensuring it properly integrates with the TimeoutResolver system.
