import { tokenize, Token } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Object Spread Special Cases', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  describe('targeting line 557-558 spread operator check', () => {
    // Direct test targeting the second spread operator check at lines 557-558
    it('directly targets isSpreadOperator with a string buffer before the spread', () => {
      // Attempt to create a situation where textBuffer has content before encountering a spread operator
      // This should force the code to take the isSpreadOperator path at line 557
      const result = tokenize('{ ${"hello"}...obj }', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');
    });

    // Attempt with a character right before the spread
    it('directly targets isSpreadOperator with a character before the spread', () => {
      const result = tokenize('{ x...obj }', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');

      const objectTokens = result[0].value as Token[];

      // Find x token and spread token
      const xIndex = objectTokens.findIndex(
        (token) =>
          (token.type === 'string' || token.type === 'identifier') &&
          (token.value === 'x' || token.value.includes('x')),
      );

      // Find spread operator
      const spreadIndex = objectTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );

      // Either one or both should exist
      expect(xIndex >= 0 || spreadIndex >= 0).toBe(true);
    });

    it('handles mixed dots and spread operators in object literals', () => {
      // This test tries to have dots in various places to avoid the first check pattern
      // but hit the isSpreadOperator function
      const result = tokenize('{ a.b: "value", ...obj }', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');

      const objectTokens = result[0].value as Token[];

      // Find the spread operator
      const spreadIndex = objectTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );
      expect(spreadIndex).toBeGreaterThan(0);
    });

    it('handles spread operator after special character patterns', () => {
      // Another test case trying to hit the isSpreadOperator function
      const result = tokenize('{ "$%^": true, "...": false, ...obj }', logger);

      expect(result.length).toBe(1);
      expect(result[0].type).toBe('object_literal');

      const objectTokens = result[0].value as Token[];

      // Find the spread operator
      const spreadIndex = objectTokens.findIndex(
        (token) => token.type === 'operator' && token.value === '...',
      );
      expect(spreadIndex).toBeGreaterThanOrEqual(0);
    });
  });
});
