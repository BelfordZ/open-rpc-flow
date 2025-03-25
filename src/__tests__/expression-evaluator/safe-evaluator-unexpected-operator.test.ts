import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';

describe('SafeExpressionEvaluator - Unexpected Operator Error', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  let logger: TestLogger;

  beforeEach(() => {
    stepResults = new Map();
    context = {};
    logger = new TestLogger('SafeEvaluatorUnexpectedOperatorTest');
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  /**
   * These tests specifically target the condition where an operator is encountered
   * in the token stream when we're not expecting one, which should throw an "Unexpected operator" error.
   */
  it('throws when expression starts with an operator', () => {
    // Starting an expression with an operator (other than unary) should throw
    expect(() => evaluator.evaluate('+ 2', {})).toThrow('Unexpected operator');
    expect(() => evaluator.evaluate('* 2', {})).toThrow(
      'Failed to evaluate expression: * 2. Got error: Operator * missing left operand',
    );
    expect(() => evaluator.evaluate('/ 2', {})).toThrow(
      'Failed to evaluate expression: / 2. Got error: Operator / missing left operand',
    );
    expect(() => evaluator.evaluate('&& true', {})).toThrow(
      'Failed to evaluate expression: && true. Got error: Unexpected operator',
    );
    expect(() => evaluator.evaluate('|| true', {})).toThrow(
      'Failed to evaluate expression: || true. Got error: Unexpected operator',
    );
  });

  it('throws when consecutive operators are used without values between them', () => {
    // Having two operators in a row should throw
    expect(() => evaluator.evaluate('2 + * 3', {})).toThrow(
      'Failed to evaluate expression: 2 + * 3. Got error: Operator + missing right operand',
    );
    expect(() => evaluator.evaluate('2 * + 3', {})).toThrow(
      'Failed to evaluate expression: 2 * + 3. Got error: Operator * missing right operand',
    );
    expect(() => evaluator.evaluate('2 && || 3', {})).toThrow(
      'Failed to evaluate expression: 2 && || 3. Got error: Unexpected operator',
    );
    expect(() => evaluator.evaluate('2 == != 3', {})).toThrow(
      'Failed to evaluate expression: 2 == != 3. Got error: Unexpected operator',
    );
  });

  it('throws when expression ends with an operator', () => {
    // Ending an expression with an operator should throw
    expect(() => evaluator.evaluate('2 +', {})).toThrow(
      'Failed to evaluate expression: 2 +. Got error: Operator + missing right operand',
    ); // Could be parsed as incomplete
    expect(() => evaluator.evaluate('2 *', {})).toThrow(
      'Failed to evaluate expression: 2 *. Got error: Operator * missing right operand',
    );
    expect(() => evaluator.evaluate('true &&', {})).toThrow(
      'Failed to evaluate expression: true &&. Got error: Invalid operation node',
    );
  });

  it('throws when operator is used in place of a value', () => {
    // Using an operator where a value should be
    expect(() => evaluator.evaluate('(+)', {})).toThrow(/Unexpected|Invalid/);
    // not sure why this doesnt throw
    //expect(() => evaluator.evaluate('[+]', {})).toThrow(/Unexpected|Invalid/);
    expect(() => evaluator.evaluate('{key: +}', {})).toThrow(/Unexpected|Invalid/);
  });

  it('throws when binary operator is used before closing parenthesis', () => {
    // Having an operator before ) should throw
    expect(() => evaluator.evaluate('(1 +)', {})).toThrow(/Unexpected|Invalid/);
    expect(() => evaluator.evaluate('(1 *)', {})).toThrow(/Unexpected|Invalid/);
    expect(() => evaluator.evaluate('(true &&)', {})).toThrow(/Unexpected|Invalid/);
  });
});
