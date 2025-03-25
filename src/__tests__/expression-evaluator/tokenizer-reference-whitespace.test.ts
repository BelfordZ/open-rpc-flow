import { tokenize } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('Tokenizer Reference Whitespace Handling', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    logger.clear();
  });

  it('correctly handles whitespace in a reference expression with a buffer', () => {
    // This test specifically targets lines 238-239 in tokenizer.ts
    // where whitespace is handled in a reference when textBuffer is non-empty and not in operator
    const expression = '${foo  }';

    const result = tokenize(expression, logger);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('reference');

    // Check that the reference token has the identifier 'foo'
    const referenceToken = result[0] as any;
    expect(referenceToken.value).toHaveLength(1);
    expect(referenceToken.value[0].type).toBe('identifier');
    expect(referenceToken.value[0].value).toBe('foo');
  });

  it('handles whitespace between multiple identifiers in a reference', () => {
    const expression = '${foo  bar}';

    const result = tokenize(expression, logger);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('reference');

    const referenceToken = result[0] as any;
    expect(referenceToken.value).toHaveLength(2);
    expect(referenceToken.value[0].type).toBe('identifier');
    expect(referenceToken.value[0].value).toBe('foo');
    expect(referenceToken.value[1].type).toBe('identifier');
    expect(referenceToken.value[1].value).toBe('bar');
  });

  it('handles whitespace after an identifier when followed by an operator', () => {
    const expression = '${foo  +bar}';

    const result = tokenize(expression, logger);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('reference');

    const referenceToken = result[0] as any;
    expect(referenceToken.value).toHaveLength(3);
    expect(referenceToken.value[0].type).toBe('identifier');
    expect(referenceToken.value[0].value).toBe('foo');
    expect(referenceToken.value[1].type).toBe('operator');
    expect(referenceToken.value[1].value).toBe('+');
    expect(referenceToken.value[2].type).toBe('identifier');
    expect(referenceToken.value[2].value).toBe('bar');
  });

  it('handles multiple whitespace characters (spaces, tabs, newlines) after an identifier', () => {
    const expression = '${foo \t\n }';

    const result = tokenize(expression, logger);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('reference');

    const referenceToken = result[0] as any;
    expect(referenceToken.value).toHaveLength(1);
    expect(referenceToken.value[0].type).toBe('identifier');
    expect(referenceToken.value[0].value).toBe('foo');
  });

  it('handles whitespace in a complex expression', () => {
    const expression = '${foo  .bar[baz   ] }';

    const result = tokenize(expression, logger);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('reference');

    const referenceToken = result[0] as any;
    // Verify we have the expected tokens in the reference
    expect(referenceToken.value.length).toBeGreaterThan(3);

    // The important assertion here is that whitespace between tokens is properly handled
    const identifierCount = referenceToken.value.filter((t: any) => t.type === 'identifier').length;
    expect(identifierCount).toBe(3); // foo, bar, baz
  });

  it('flushes buffer when whitespace is encountered after an identifier', () => {
    // Test various whitespace characters after an identifier
    const expressions = [
      '${abc }', // space
      '${abc\t}', // tab
      '${abc\n}', // newline
      '${abc\r}', // carriage return
      '${abc\f}', // form feed
      '${abc\v}', // vertical tab
    ];

    for (const expression of expressions) {
      const result = tokenize(expression, logger);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('reference');

      const referenceValue = (result[0] as any).value;
      expect(referenceValue).toHaveLength(1);
      expect(referenceValue[0].type).toBe('identifier');
      expect(referenceValue[0].value).toBe('abc');
    }
  });

  it('preserves whitespace handling in a multi-token reference', () => {
    // Test whitespace after the first identifier in a multi-token reference
    const expression = '${abc def}';

    const result = tokenize(expression, logger);

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('reference');

    const referenceValue = (result[0] as any).value;
    expect(referenceValue).toHaveLength(2);
    expect(referenceValue[0].type).toBe('identifier');
    expect(referenceValue[0].value).toBe('abc');
    expect(referenceValue[1].type).toBe('identifier');
    expect(referenceValue[1].value).toBe('def');
  });

  it('flushes buffer for whitespace in complex expressions', () => {
    const expressions = [
      '${abc .prop}', // whitespace before dot operator
      '${obj[ key ]}', // whitespace in brackets
      '${a + b }', // whitespace after full expression
      '${func(a, b )}', // whitespace in function call
    ];

    for (const expression of expressions) {
      const result = tokenize(expression, logger);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('reference');
    }
  });
});
