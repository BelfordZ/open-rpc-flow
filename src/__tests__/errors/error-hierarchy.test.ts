import {
  FlowError,
  ValidationError,
  DependencyError,
  ExpressionError,
  RequestError,
  StepExecutionError,
  LoopError,
  TransformError,
  ConditionError,
} from '../../errors';

describe('Error class hierarchy', () => {
  it('should maintain proper instanceof relationships', () => {
    const validationError = new ValidationError('Invalid flow');
    const dependencyError = new DependencyError('Missing dependency');
    const expressionError = new ExpressionError('Invalid expression');
    const requestError = new RequestError('Request failed');
    const loopError = new LoopError('Invalid loop');
    const transformError = new TransformError('Invalid transform');
    const conditionError = new ConditionError('Invalid condition');

    // All errors should be instances of Error
    expect(validationError).toBeInstanceOf(Error);
    expect(dependencyError).toBeInstanceOf(Error);
    expect(expressionError).toBeInstanceOf(Error);
    expect(requestError).toBeInstanceOf(Error);
    expect(loopError).toBeInstanceOf(Error);
    expect(transformError).toBeInstanceOf(Error);
    expect(conditionError).toBeInstanceOf(Error);

    // All errors should be instances of FlowError
    expect(validationError).toBeInstanceOf(FlowError);
    expect(dependencyError).toBeInstanceOf(FlowError);
    expect(expressionError).toBeInstanceOf(FlowError);
    expect(requestError).toBeInstanceOf(FlowError);
    expect(loopError).toBeInstanceOf(FlowError);
    expect(transformError).toBeInstanceOf(FlowError);
    expect(conditionError).toBeInstanceOf(FlowError);

    // Step-specific errors should be instances of StepExecutionError
    expect(loopError).toBeInstanceOf(StepExecutionError);
    expect(transformError).toBeInstanceOf(StepExecutionError);
    expect(conditionError).toBeInstanceOf(StepExecutionError);

    // Non-step-specific errors should not be instances of StepExecutionError
    expect(validationError).not.toBeInstanceOf(StepExecutionError);
    expect(dependencyError).not.toBeInstanceOf(StepExecutionError);
    expect(expressionError).not.toBeInstanceOf(StepExecutionError);
    expect(requestError).not.toBeInstanceOf(StepExecutionError);
  });

  it('should include details in error objects', () => {
    const details = { field: 'name', value: null };
    const error = new ValidationError('Missing field', details);

    expect(error.message).toBe('Missing field');
    expect(error.details).toEqual(details);
  });
}); 