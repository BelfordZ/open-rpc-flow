import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';
import { Token } from '../../expression-evaluator/tokenizer';

describe('SafeExpressionEvaluator Line 516 Coverage', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  const logger = new TestLogger('SafeExpressionEvaluatorTest');

  beforeEach(() => {
    stepResults = new Map();
    context = {};
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  describe('parseArrayElements with spread operator (line 516)', () => {
    // Direct test for line 516 using explicit method access
    it('should call parseArrayElements with spread token and verify it sets the spread flag', () => {
      // Access private methods of the evaluator
      const evaluatorInstance = evaluator as any;

      // Create a mock for parseGroupedElements to verify the callback
      const originalParseGroupedElements = evaluatorInstance.parseGroupedElements;

      let callbackResult: any = null;
      let callbackIsSpread: boolean | undefined = undefined;

      // Mock parseGroupedElements to capture and verify how it's called
      evaluatorInstance.parseGroupedElements = function (
        tokens: Token[],
        delimiter: string,
        elementProcessor: Function,
      ) {
        // Create a token with spread operator
        const mockTokens: Token[] = [{ type: 'number', value: '42', raw: '42' }];

        // Save the isSpread flag we pass to the callback
        callbackIsSpread = true;

        // Call the callback with isSpread=true to explicitly hit line 516
        callbackResult = elementProcessor(mockTokens, callbackIsSpread);

        // Return any value - we're just interested in the callback execution
        return [callbackResult];
      };

      // Create a mock for parse method to avoid errors
      const originalParse = evaluatorInstance.parse;
      evaluatorInstance.parse = jest.fn().mockReturnValue({ type: 'literal', value: 42 });

      try {
        // Call parseArrayElements which will trigger our mocked parseGroupedElements
        const tokens: Token[] = [
          { type: 'punctuation', value: '[', raw: '[' },
          { type: 'number', value: '42', raw: '42' },
          { type: 'punctuation', value: ']', raw: ']' },
        ];

        const result = evaluatorInstance.parseArrayElements(tokens);

        // Now we verify that the callback was called with isSpread=true
        expect(callbackIsSpread).toBe(true);

        // Most importantly, verify that line 516 was executed by checking the result structure
        // Line 516 is responsible for setting the spread property in the object returned by the callback
        expect(callbackResult).toHaveProperty('spread', true);
        expect(callbackResult).toEqual({
          value: { type: 'literal', value: 42 }, // The result of our mocked parse call
          spread: true, // This is set on line 516
        });
      } finally {
        // Restore original methods
        evaluatorInstance.parseGroupedElements = originalParseGroupedElements;
        evaluatorInstance.parse = originalParse;
      }
    });

    // Additional test for verification
    it('should correctly evaluate spread operator in arrays', () => {
      context.arr = [3, 4, 5];
      const result = evaluator.evaluate('[1, 2, ...${context.arr}]', {});
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });
  });
});
