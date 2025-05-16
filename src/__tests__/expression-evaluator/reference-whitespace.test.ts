import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';
import { tokenize } from '../../expression-evaluator/tokenizer';

describe('Reference keys with spaces', () => {
  it('evaluates references containing spaces', () => {
    const logger = new TestLogger('ref-space');
    const stepResults = new Map();
    const context = { item: { 'PR Link': 'ok' } };
    const resolver = new ReferenceResolver(stepResults, context, logger);
    const evaluator = new SafeExpressionEvaluator(logger, resolver);
    expect(evaluator.evaluate("${item['PR Link']}", context)).toBe('ok');
  });

  it('tokenizer preserves spaces inside reference keys', () => {
    const logger = new TestLogger();
    const tokens = tokenize("${item['PR Link']}", logger);
    const ref = tokens[0];
    if (ref.type !== 'reference') throw new Error('expected reference token');
    const strToken = (ref.value as any[]).find((t) => t.type === 'string');
    expect(strToken).toBeDefined();
    expect(strToken?.value).toBe('PR Link');
  });
});
