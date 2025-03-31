# TKT-TIMEOUT-007: Implement Transform Step Timeout Support

## Description

Add timeout support to the TransformStepExecutor, ensuring that transformation expressions don't exceed configured timeout limits. This is particularly important for preventing complex or poorly written expressions from hanging the application.

## Acceptance Criteria

- Update TransformStepExecutor to utilize configurable timeouts
- Integrate with the updated SafeExpressionEvaluator to enforce timeouts
- Add clear error reporting for transformation timeouts
- Add tests for transform expression timeout scenarios

## Proposed Implementation

```typescript
export class TransformStepExecutor implements StepExecutor {
  constructor(private expressionEvaluator: SafeExpressionEvaluator) {}

  canExecute(step: Step): boolean {
    return step.type === StepType.Transform;
  }

  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new Error('Invalid step type for TransformStepExecutor');
    }

    const transformStep = step as TransformStep;

    // Get timeout from context (set by TimeoutResolver)
    const timeout = (context as any).timeout;

    try {
      // Pass the timeout to the expression evaluator
      const result = await this.expressionEvaluator.evaluateExpression(
        transformStep.expression,
        { ...context, ...extraContext },
        timeout, // Pass the resolved timeout
      );

      return {
        result,
        type: StepType.Transform,
        metadata: {
          expression: transformStep.expression,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      // Check if this is a timeout error from the evaluator
      if (error.code === ErrorCode.TIMEOUT_ERROR) {
        throw new TimeoutError(
          `Transform step "${step.name}" timed out after ${timeout}ms: ${error.message}`,
          {
            code: ErrorCode.TIMEOUT_ERROR,
            stepName: step.name,
            expression: transformStep.expression,
            timeout,
            originalError: error,
            retryable: false, // Transforms usually shouldn't be retried when they timeout
          },
        );
      }

      // Re-throw other errors
      throw error;
    }
  }
}
```

## Dependencies

- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces
- TKT-TIMEOUT-004: Implement Timeout Resolution Logic
- TKT-TIMEOUT-005: Update Expression Evaluator with Configurable Timeouts

## Estimation

2 story points (3-5 hours)

## Status

**PARTIALLY IMPLEMENTED**

The TransformStepExecutor has some timeout capabilities through its dependency on SafeExpressionEvaluator, but is not fully integrated with the TimeoutResolver system as described in this ticket:

1. **What is implemented:**
   - SafeExpressionEvaluator has timeout capabilities with configurable timeout values
   - SafeExpressionEvaluator can use TimeoutResolver to get expression timeout values
   - SafeExpressionEvaluator has a checkTimeout method that throws EnhancedTimeoutError when expressions take too long
   - EnhancedTimeoutError includes detailed context about the timeout, matching the proposed functionality

2. **What is missing:**
   - TransformStepExecutor does not read timeout information from the context
   - TransformStepExecutor does not explicitly pass the step context to the expression evaluator's methods, limiting the ability to use step-specific timeouts
   - No specific handling for timeout errors in the TransformStepExecutor
   - No tests for transform expression timeout scenarios

The current implementation provides basic expression timeout protection through the SafeExpressionEvaluator, but lacks the explicit integration with TimeoutResolver and specific error handling proposed in this ticket.

**Recommendation:** Complete the implementation by passing timeout information from the context to the SafeExpressionEvaluator and adding specific error handling for timeout errors.
