import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

describe('SafeExpressionEvaluator Line 516 Debug', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  const logger = new TestLogger('SafeExpressionEvaluatorTest');

  beforeEach(() => {
    stepResults = new Map();
    context = {
      arr: [3, 4, 5],
    };
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  it('should debug the execution of line 516', () => {
    // Get access to the private methods of the evaluator
    const evaluatorInstance = evaluator as any;

    // Store the original parseArrayElements method
    const originalParseArrayElements = evaluatorInstance.parseArrayElements;

    // Override with instrumented version
    evaluatorInstance.parseArrayElements = function (tokens: any[]) {
      logger.log('Executing parseArrayElements');

      // Store the original parseGroupedElements
      const originalParseGroupedElements = this.parseGroupedElements;

      // Override parseGroupedElements to add instrumentation
      this.parseGroupedElements = function (tokens: any[], delimiter: string, processor: Function) {
        logger.log('Executing parseGroupedElements');

        // Create a wrapper around the processor function
        const wrappedProcessor = function (currentTokens: any[], isSpread: boolean, key?: string) {
          logger.log(`Processor called with isSpread=${isSpread}`);

          // This is where line 516 would be executed in the original code
          const result = processor(currentTokens, isSpread, key);

          // Log the result to see if spread was set
          logger.log('Processor result:', JSON.stringify(result));

          return result;
        };

        // Call the original with our wrapped processor
        return originalParseGroupedElements.call(this, tokens, delimiter, wrappedProcessor);
      };

      try {
        // Call the original method with our instrumented parseGroupedElements
        return originalParseArrayElements.call(this, tokens);
      } finally {
        // Restore original method
        this.parseGroupedElements = originalParseGroupedElements;
      }
    };

    try {
      // Execute with spread operator to trigger the code path for line 516
      const result = evaluator.evaluate('[1, ...${context.arr}]', {});
      logger.log('Evaluation result:', result);

      // The console logs will show us if line 516 was executed
    } finally {
      // Restore original method
      evaluatorInstance.parseArrayElements = originalParseArrayElements;
    }
  });
});
