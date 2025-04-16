import { FlowError } from './base';
import { ErrorCode } from './codes';
import { Step } from '../types';
import { StepType } from '../step-executors/types';

/**
 * TimeoutError thrown when a step or expression exceeds its configured timeout.
 * Extends FlowError with additional context about the timeout.
 */
export class TimeoutError extends FlowError {
  /**
   * The step that timed out
   */
  readonly step?: Step;

  /**
   * The type of step that timed out
   */
  readonly stepType?: StepType;

  /**
   * The configured timeout value in milliseconds
   */
  readonly timeout: number;

  /**
   * The actual execution time before timeout in milliseconds
   */
  readonly executionTime: number;

  /**
   * Whether the timeout occurred in an expression evaluation
   */
  readonly isExpressionTimeout: boolean;

  /**
   * Creates a new TimeoutError
   *
   * @param message - Error message
   * @param timeout - The configured timeout value in milliseconds
   * @param executionTime - The execution time before timeout in milliseconds
   * @param step - The step that timed out (if applicable)
   * @param stepType - The type of step that timed out (if applicable)
   * @param isExpressionTimeout - Whether the timeout occurred in an expression evaluation
   */
  constructor(
    message: string,
    timeout: number,
    executionTime: number,
    step?: Step,
    stepType?: StepType,
    isExpressionTimeout: boolean = false,
  ) {
    const context = {
      timeout,
      executionTime,
      step: step ? { name: step.name } : undefined,
      stepType,
      isExpressionTimeout,
    };

    super(message, ErrorCode.TIMEOUT_ERROR, context);

    this.timeout = timeout;
    this.executionTime = executionTime;
    this.step = step;
    this.stepType = stepType;
    this.isExpressionTimeout = isExpressionTimeout;

    this.name = 'TimeoutError';
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }

  /**
   * Factory method to create a TimeoutError for a step execution
   *
   * @param step - The step that timed out
   * @param stepType - The type of step that timed out
   * @param timeout - The configured timeout value in milliseconds
   * @param executionTime - The execution time before timeout in milliseconds
   * @returns A new TimeoutError
   */
  static forStep(
    step: Step,
    stepType: StepType,
    timeout: number,
    executionTime: number,
  ): TimeoutError {
    return new TimeoutError(
      `Step "${step.name}" execution timed out after ${executionTime}ms. ` +
        `Configured timeout: ${timeout}ms.`,
      timeout,
      executionTime,
      step,
      stepType,
    );
  }

  /**
   * Factory method to create a TimeoutError for an expression evaluation
   *
   * @param expression - The expression that timed out
   * @param timeout - The configured timeout value in milliseconds
   * @param executionTime - The execution time before timeout in milliseconds
   * @param step - The step context (if applicable)
   * @returns A new TimeoutError
   */
  static forExpression(
    expression: string,
    timeout: number,
    executionTime: number,
    step?: Step,
  ): TimeoutError {
    return new TimeoutError(
      `Expression evaluation timed out after ${executionTime}ms. ` +
        `Configured timeout: ${timeout}ms. Expression: "${expression.substring(0, 50)}${expression.length > 50 ? '...' : ''}"`,
      timeout,
      executionTime,
      step,
      undefined,
      true,
    );
  }
}
