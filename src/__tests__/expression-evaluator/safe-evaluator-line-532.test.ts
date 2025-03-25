import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

describe('SafeExpressionEvaluator Line 532 Coverage', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  const logger = new TestLogger('SafeExpressionEvaluatorDebugTest');

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

  it('should exercise the spread flag in parseArrayElements on line 532', () => {
    // Execute with spread operator to trigger the code path
    const result = evaluator.evaluate('[...${context.arr}]', {});
    expect(result).toEqual([3, 4, 5]);
  });
});
