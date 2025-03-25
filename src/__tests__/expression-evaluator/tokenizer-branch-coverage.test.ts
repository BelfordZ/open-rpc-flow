import { tokenize } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Branch Coverage Tests', () => {
  const logger = new TestLogger();

  // Test case for directly testing isSpreadOperator's true branch
  test('should handle array with spread operator (true branch)', () => {
    const input = '[...items]';
    const result = tokenize(input, logger);

    expect(result).toEqual([
      {
        type: 'array_literal',
        value: [
          { type: 'operator', value: '...', raw: '...' },
          { type: 'identifier', value: 'items', raw: 'items' },
        ],
        raw: '[...items]',
      },
    ]);
  });

  // Test case for forcing isSpreadOperator's false branch
  test('should handle array with dots that are not spread operator (false branch)', () => {
    const input = '[a.b, c.d.e]';
    const result = tokenize(input, logger);

    expect(result).toEqual([
      {
        type: 'array_literal',
        value: [
          { type: 'identifier', value: 'a.b', raw: 'a.b' },
          { type: 'punctuation', value: ',', raw: ',' },
          { type: 'identifier', value: 'c.d.e', raw: 'c.d.e' },
        ],
        raw: '[a.b, c.d.e]',
      },
    ]);
  });

  // Test with a single dot
  test('should handle array with single dots (false branch)', () => {
    const input = '[a.b]';
    const result = tokenize(input, logger);

    expect(result).toEqual([
      {
        type: 'array_literal',
        value: [{ type: 'identifier', value: 'a.b', raw: 'a.b' }],
        raw: '[a.b]',
      },
    ]);
  });

  // Test with two consecutive dots
  test('should handle array with double dots (false branch)', () => {
    const input = '[a..b]';
    const result = tokenize(input, logger);

    expect(result).toEqual([
      {
        type: 'array_literal',
        value: [{ type: 'identifier', value: 'a..b', raw: 'a..b' }],
        raw: '[a..b]',
      },
    ]);
  });

  // Test with dot at end of expression
  test('should handle array with dot at the end (false branch)', () => {
    const input = '[abc.]';
    const result = tokenize(input, logger);

    expect(result).toEqual([
      {
        type: 'array_literal',
        value: [{ type: 'identifier', value: 'abc.', raw: 'abc.' }],
        raw: '[abc.]',
      },
    ]);
  });

  // Test with complex combination of dots within identifiers
  test('should handle array with complex dot patterns (false branch)', () => {
    const input = '[a.b, c..d, e.., ..f, .g.]';
    const result = tokenize(input, logger);

    expect(result).toEqual([
      {
        type: 'array_literal',
        value: [
          { type: 'identifier', value: 'a.b', raw: 'a.b' },
          { type: 'punctuation', value: ',', raw: ',' },
          { type: 'identifier', value: 'c..d', raw: 'c..d' },
          { type: 'punctuation', value: ',', raw: ',' },
          { type: 'identifier', value: 'e..', raw: 'e..' },
          { type: 'punctuation', value: ',', raw: ',' },
          { type: 'identifier', value: '..f', raw: '..f' },
          { type: 'punctuation', value: ',', raw: ',' },
          { type: 'identifier', value: '.g.', raw: '.g.' },
        ],
        raw: '[a.b, c..d, e.., ..f, .g.]',
      },
    ]);
  });
});
