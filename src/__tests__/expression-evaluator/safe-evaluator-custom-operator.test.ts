import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';
import { Token as _Token } from '../../expression-evaluator/tokenizer';

/**
 * This test focuses on testing the default case in the getPrecedence method
 * at line 478 in safe-evaluator.ts:
 *
 * ```
 * default:
 *   return 0;
 * ```
 *
 * We specifically want to test that when an unknown operator is encountered,
 * it returns the default precedence of 0.
 */
describe('SafeExpressionEvaluator - Custom Operator Test', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  const logger = new TestLogger('SafeEvaluatorCustomOperatorTest');

  beforeEach(() => {
    stepResults = new Map();
    context = {};
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  /**
   * This test specifically targets the default case in the getPrecedence method
   * by creating a simulated custom operator that should use the default case.
   */
  describe('getPrecedence default case (line 478)', () => {
    it('should use default precedence for unknown operators', () => {
      // The goal is to directly access the getPrecedence method and test
      // the default case by passing an operator that isn't in the switch statement

      // Cast to any to access the private method
      const evaluatorAny = evaluator as any;

      if (typeof evaluatorAny.getPrecedence === 'function') {
        // Create a custom operator not in the known list
        const customOperator = '???'; // Triple question mark

        // Call the method directly - should hit default case
        const precedence = evaluatorAny.getPrecedence(customOperator);

        // Default case returns 0
        expect(precedence).toBe(0);

        // Compare with a known operator to confirm difference
        const knownOperatorPrecedence = evaluatorAny.getPrecedence('+');
        expect(knownOperatorPrecedence).toBe(5);

        // Test a variety of other custom operators to be thorough
        expect(evaluatorAny.getPrecedence('!!!')).toBe(0);
        expect(evaluatorAny.getPrecedence('===')).toBe(3); // Known operator
        expect(evaluatorAny.getPrecedence('======')).toBe(0); // Unknown
        expect(evaluatorAny.getPrecedence('#')).toBe(0);
      } else {
        // We'll try to use the parse method which should call getPrecedence internally

        // Attempt to create a custom AST node with an unknown operator
        const customAst = {
          type: 'operation',
          operator: '???', // Custom operator
          left: { type: 'literal', value: 1 },
          right: { type: 'literal', value: 2 },
        };

        // If we can access evaluateAst, use it to indirectly test
        if (typeof evaluatorAny.evaluateAst === 'function') {
          try {
            evaluatorAny.evaluateAst(customAst, {}, Date.now());
          } catch (error) {
            // We expect an error about unknown operator
            expect(error).toBeInstanceOf(ExpressionError);
            expect((error as Error).message).toContain("unknown operator '???'");
          }
        }
      }
    });
  });
});
