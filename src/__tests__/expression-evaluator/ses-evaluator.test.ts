import { SesExpressionEvaluator } from '../../expression-evaluator/ses-evaluator';
import { TestLogger } from '../../util/logger';

describe('SesExpressionEvaluator', () => {
  it('evaluates arithmetic expressions', () => {
    const evaluator = new SesExpressionEvaluator(new TestLogger('ses'));
    expect(evaluator.evaluate('1 + 2', {})).toBe(3);
  });

  it('extracts identifiers', () => {
    const evaluator = new SesExpressionEvaluator(new TestLogger('ses'));
    const refs = evaluator.extractReferences('a + b + c');
    expect(refs.sort()).toEqual(['a', 'b', 'c']);
  });
});
