import {
  ExpressionError,
  ExpressionEvaluationError,
  ReferenceResolutionError,
  ArrayAccessError,
  ComparisonError,
} from '../../expression-evaluator/errors';

describe('Expression Evaluator Errors', () => {
  describe('ExpressionError', () => {
    it('creates basic error with message', () => {
      const error = new ExpressionError('test message');
      expect(error.message).toBe('test message');
      expect(error.name).toBe('ExpressionError');
      expect(error.cause).toBeUndefined();
    });

    it('creates error with cause', () => {
      const cause = new Error('cause message');
      const error = new ExpressionError('test message', cause);
      expect(error.message).toBe('test message');
      expect(error.cause).toBe(cause);
    });

    it('maintains proper instanceof chain', () => {
      const error = new ExpressionError('test');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ExpressionError);
    });
  });

  describe('ExpressionEvaluationError', () => {
    it('creates error with expression', () => {
      const error = new ExpressionEvaluationError('test message', '${foo} + ${bar}');
      expect(error.message).toBe('test message');
      expect(error.name).toBe('ExpressionEvaluationError');
      expect(error.expression).toBe('${foo} + ${bar}');
      expect(error.cause).toBeUndefined();
    });

    it('creates error with cause', () => {
      const cause = new Error('cause message');
      const error = new ExpressionEvaluationError('test message', '${foo}', cause);
      expect(error.message).toBe('test message');
      expect(error.expression).toBe('${foo}');
      expect(error.cause).toBe(cause);
    });

    it('maintains proper instanceof chain', () => {
      const error = new ExpressionEvaluationError('test', '${foo}');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ExpressionError);
      expect(error).toBeInstanceOf(ExpressionEvaluationError);
    });
  });

  describe('ReferenceResolutionError', () => {
    it('creates error with path', () => {
      const error = new ReferenceResolutionError('test message', 'foo.bar');
      expect(error.message).toBe('test message');
      expect(error.name).toBe('ReferenceResolutionError');
      expect(error.path).toBe('foo.bar');
      expect(error.cause).toBeUndefined();
    });

    it('creates error with cause', () => {
      const cause = new Error('cause message');
      const error = new ReferenceResolutionError('test message', 'foo.bar', cause);
      expect(error.message).toBe('test message');
      expect(error.path).toBe('foo.bar');
      expect(error.cause).toBe(cause);
    });

    it('maintains proper instanceof chain', () => {
      const error = new ReferenceResolutionError('test', 'foo.bar');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ExpressionError);
      expect(error).toBeInstanceOf(ReferenceResolutionError);
    });
  });

  describe('ArrayAccessError', () => {
    it('creates error with expression', () => {
      const error = new ArrayAccessError('test message', 'arr[0]');
      expect(error.message).toBe('test message');
      expect(error.name).toBe('ArrayAccessError');
      expect(error.expression).toBe('arr[0]');
      expect(error.cause).toBeUndefined();
    });

    it('creates error with cause', () => {
      const cause = new Error('cause message');
      const error = new ArrayAccessError('test message', 'arr[0]', cause);
      expect(error.message).toBe('test message');
      expect(error.expression).toBe('arr[0]');
      expect(error.cause).toBe(cause);
    });

    it('maintains proper instanceof chain', () => {
      const error = new ArrayAccessError('test', 'arr[0]');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ExpressionError);
      expect(error).toBeInstanceOf(ArrayAccessError);
    });
  });

  describe('ComparisonError', () => {
    it('creates error with expression', () => {
      const error = new ComparisonError('test message', 'a > b');
      expect(error.message).toBe('test message');
      expect(error.name).toBe('ComparisonError');
      expect(error.expression).toBe('a > b');
      expect(error.cause).toBeUndefined();
    });

    it('creates error with cause', () => {
      const cause = new Error('cause message');
      const error = new ComparisonError('test message', 'a > b', cause);
      expect(error.message).toBe('test message');
      expect(error.expression).toBe('a > b');
      expect(error.cause).toBe(cause);
    });

    it('maintains proper instanceof chain', () => {
      const error = new ComparisonError('test', 'a > b');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ExpressionError);
      expect(error).toBeInstanceOf(ComparisonError);
    });
  });
});
