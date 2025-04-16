import { TimeoutError } from '../timeout-error';
import { StepType } from '../../step-executors/types';
import { Step } from '../../types';

describe('TimeoutError', () => {
  const mockStep: Step = {
    name: 'TestStep',
  };

  describe('constructor', () => {
    it('should create an instance with the correct properties', () => {
      const message = 'Timeout occurred';
      const timeout = 5000;
      const executionTime = 6000;
      const step = mockStep;
      const stepType = StepType.Request;
      const isExpressionTimeout = false;

      const error = new TimeoutError(
        message,
        timeout,
        executionTime,
        step,
        stepType,
        isExpressionTimeout,
      );

      expect(error).toBeInstanceOf(TimeoutError);
      expect(error.message).toBe(message);
      expect(error.timeout).toBe(timeout);
      expect(error.executionTime).toBe(executionTime);
      expect(error.step).toBe(step);
      expect(error.stepType).toBe(stepType);
      expect(error.isExpressionTimeout).toBe(isExpressionTimeout);
      expect(error.name).toBe('TimeoutError');
    });

    it('should set isExpressionTimeout to false by default', () => {
      const error = new TimeoutError('Timeout occurred', 5000, 6000, mockStep, StepType.Request);

      expect(error.isExpressionTimeout).toBe(false);
    });

    it('should set step and stepType to undefined when not provided', () => {
      const error = new TimeoutError('Timeout occurred', 5000, 6000);

      expect(error.step).toBeUndefined();
      expect(error.stepType).toBeUndefined();
    });
  });

  describe('forStep', () => {
    it('should create an error for a step timeout', () => {
      const step = mockStep;
      const stepType = StepType.Request;
      const timeout = 5000;
      const executionTime = 6000;

      const error = TimeoutError.forStep(step, stepType, timeout, executionTime);

      expect(error).toBeInstanceOf(TimeoutError);
      expect(error.message).toContain(`Step "${step.name}"`);
      expect(error.message).toContain(`timed out after ${executionTime}ms`);
      expect(error.message).toContain(`Configured timeout: ${timeout}ms`);
      expect(error.timeout).toBe(timeout);
      expect(error.executionTime).toBe(executionTime);
      expect(error.step).toBe(step);
      expect(error.stepType).toBe(stepType);
      expect(error.isExpressionTimeout).toBe(false);
    });
  });

  describe('forExpression', () => {
    it('should create an error for an expression timeout', () => {
      const expression = 'context.value.map(item => item * 2)';
      const timeout = 1000;
      const executionTime = 1200;

      const error = TimeoutError.forExpression(expression, timeout, executionTime);

      expect(error).toBeInstanceOf(TimeoutError);
      expect(error.message).toContain('Expression evaluation timed out');
      expect(error.message).toContain(`after ${executionTime}ms`);
      expect(error.message).toContain(`Configured timeout: ${timeout}ms`);
      expect(error.message).toContain(expression);
      expect(error.timeout).toBe(timeout);
      expect(error.executionTime).toBe(executionTime);
      expect(error.step).toBeUndefined();
      expect(error.stepType).toBeUndefined();
      expect(error.isExpressionTimeout).toBe(true);
    });

    it('should truncate long expressions in the error message', () => {
      const longExpression = 'x'.repeat(100);
      const timeout = 1000;
      const executionTime = 1200;

      const error = TimeoutError.forExpression(longExpression, timeout, executionTime);

      expect(error.message).toContain('x'.repeat(50));
      expect(error.message).toContain('...');
      expect(error.message).not.toContain('x'.repeat(100));
    });

    it('should include step context when provided', () => {
      const expression = 'context.value';
      const timeout = 1000;
      const executionTime = 1200;
      const step = mockStep;

      const error = TimeoutError.forExpression(expression, timeout, executionTime, step);

      expect(error.step).toBe(step);
    });
  });
});
