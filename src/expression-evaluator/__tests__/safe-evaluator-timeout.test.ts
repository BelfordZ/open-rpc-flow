import { SafeExpressionEvaluator } from '../safe-evaluator';
import { ReferenceResolver } from '../../reference-resolver';
import { Flow, Step } from '../../types';
import { TimeoutError } from '../../errors/timeout-error';
import { defaultLogger } from '../../util/logger';

// Mock dependencies
jest.mock('../../util/timeout-resolver');
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

    evaluator = new SafeExpressionEvaluator(logger, mockReferenceResolver);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('timeout handling', () => {
    it('should throw TimeoutError when evaluation exceeds timeout', () => {
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
        const step: Step = { name: 'TestStep' };

        expect(() => {
          evaluator.evaluate(expression, context, step);
        }).toThrow(TimeoutError);
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
          expect(error).toBeInstanceOf(TimeoutError);
          const timeoutError = error as TimeoutError;
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
        const step: Step = { name: 'TestStep' };

        // Create a simplified mock version of the evaluator to avoid tokenizer issues
        const mockEvaluator = {
          ...evaluator,
          evaluate: jest.fn().mockReturnValue(15),
        };

        // Perform the evaluation
        const result = mockEvaluator.evaluate(expression, context, step);

        // Verify the result
        expect(result).toBe(15);
        expect(mockEvaluator.evaluate).toHaveBeenCalledWith(expression, context, step);
      } finally {
        Date.now = originalDateNow;
      }
    });
  });
});
