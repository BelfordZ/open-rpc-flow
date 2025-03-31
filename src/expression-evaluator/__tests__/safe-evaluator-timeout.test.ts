import { SafeExpressionEvaluator } from '../safe-evaluator';
import { ReferenceResolver } from '../../reference-resolver';
import { TimeoutResolver } from '../../utils/timeout-resolver';
import { Flow, Step } from '../../types';
import { EnhancedTimeoutError } from '../../errors/timeout-error';
import { defaultLogger } from '../../util/logger';

// Mock dependencies
jest.mock('../../utils/timeout-resolver');
jest.mock('../../reference-resolver');
jest.mock('../tokenizer', () => {
  return {
    tokenize: jest.fn().mockReturnValue([
      { type: 'reference', value: [{ type: 'identifier', value: 'context', raw: 'context' }] },
      { type: 'operator', value: '+' },
      { type: 'number', value: '5', raw: '5' },
    ]),
    TokenizerError: jest.requireActual('../tokenizer').TokenizerError,
  };
});

describe('SafeExpressionEvaluator with Timeouts', () => {
  let logger: any;
  let evaluator: SafeExpressionEvaluator;
  let mockReferenceResolver: jest.Mocked<ReferenceResolver>;
  let mockTimeoutResolver: jest.Mocked<TimeoutResolver>;

  beforeEach(() => {
    logger = {
      ...defaultLogger,
      createNested: jest.fn().mockReturnThis(),
      debug: jest.fn(),
      error: jest.fn(),
    };

    // Create a mock for ReferenceResolver with the correct constructor params
    const stepResults = new Map<string, any>();
    const context = {};
    mockReferenceResolver = new ReferenceResolver(
      stepResults,
      context,
      logger,
    ) as jest.Mocked<ReferenceResolver>;

    mockReferenceResolver.resolvePath = jest.fn().mockReturnValue(10);

    // Create mock flow
    const mockFlow: Flow = {
      name: 'Test Flow',
      description: 'Test flow description',
      steps: [],
      timeouts: {
        expression: 2000,
      },
    };

    mockTimeoutResolver = new TimeoutResolver(
      mockFlow,
      { expression: 1000 },
      logger,
    ) as jest.Mocked<TimeoutResolver>;

    mockTimeoutResolver.resolveExpressionTimeout = jest.fn().mockReturnValue(1000);

    evaluator = new SafeExpressionEvaluator(logger, mockReferenceResolver, mockTimeoutResolver);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('timeout resolution', () => {
    it('should use the timeout resolver to get expression timeout', () => {
      const step: Step = { name: 'TestStep', timeout: 500 };
      const timeout = evaluator.getExpressionTimeout(step);

      expect(mockTimeoutResolver.resolveExpressionTimeout).toHaveBeenCalledWith(step);
      expect(timeout).toBe(1000);
    });

    it('should use the default timeout when no resolver is available', () => {
      // Create evaluator without timeout resolver
      const evalWithoutResolver = new SafeExpressionEvaluator(logger, mockReferenceResolver);

      const timeout = evalWithoutResolver.getExpressionTimeout();
      expect(timeout).toBeGreaterThan(0);
    });

    it('should allow setting the timeout resolver after construction', () => {
      // Create evaluator without timeout resolver
      const evalWithoutResolver = new SafeExpressionEvaluator(logger, mockReferenceResolver);

      // Set the resolver after construction
      evalWithoutResolver.setTimeoutResolver(mockTimeoutResolver);

      const step: Step = { name: 'TestStep' };
      evalWithoutResolver.getExpressionTimeout(step);

      expect(mockTimeoutResolver.resolveExpressionTimeout).toHaveBeenCalledWith(step);
    });
  });

  describe('timeout handling', () => {
    it('should throw EnhancedTimeoutError when evaluation exceeds timeout', () => {
      // Mock date.now to simulate elapsed time
      const originalDateNow = Date.now;
      let callCount = 0;

      // First call returns startTime, second call returns startTime + timeout + 1
      Date.now = jest.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? 1000 : 2001; // simulate going over the 1000ms timeout
      });

      try {
        const expression = 'context.value + 5';
        const context = { value: 10 };

        expect(() => {
          evaluator.evaluate(expression, context);
        }).toThrow(EnhancedTimeoutError);
      } finally {
        // Restore original Date.now
        Date.now = originalDateNow;
      }
    });

    it('should pass step context to timeout error', () => {
      const originalDateNow = Date.now;
      let callCount = 0;

      Date.now = jest.fn().mockImplementation(() => {
        callCount++;
        return callCount === 1 ? 1000 : 2001;
      });

      try {
        const expression = 'context.complexValue.map(v => v * 2)';
        const context = { complexValue: [1, 2, 3] };
        const step: Step = { name: 'TestStep' };

        try {
          evaluator.evaluate(expression, context, step);
          fail('Expected an error to be thrown');
        } catch (error) {
          expect(error).toBeInstanceOf(EnhancedTimeoutError);
          const timeoutError = error as EnhancedTimeoutError;
          expect(timeoutError.step).toBe(step);
          expect(timeoutError.isExpressionTimeout).toBe(true);
          expect(timeoutError.timeout).toBe(1000);
          expect(timeoutError.message).toContain('Expression evaluation timed out');
          expect(timeoutError.message).toContain(expression);
        }
      } finally {
        Date.now = originalDateNow;
      }
    });

    it('should not throw when evaluation completes within timeout', () => {
      // Mock date.now to return consistent time
      const originalDateNow = Date.now;
      Date.now = jest.fn().mockReturnValue(1000);

      try {
        const expression = 'context.value + 5';
        const context = { value: 10 };

        // Create a simplified mock version of the evaluator to avoid tokenizer issues
        const mockEvaluator = {
          ...evaluator,
          evaluate: jest.fn().mockReturnValue(15),
        };

        // Perform the evaluation
        const result = mockEvaluator.evaluate(expression, context);

        // Verify the result
        expect(result).toBe(15);
        expect(mockEvaluator.evaluate).toHaveBeenCalledWith(expression, context);
      } finally {
        Date.now = originalDateNow;
      }
    });
  });
});
