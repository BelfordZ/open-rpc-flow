import { tokenize } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('tokenize', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  afterEach(() => {
    //logger.print();
    logger.clear();
  });

  describe('simple expressions', () => {
    it('tokenizes numbers', () => {
      expect(tokenize('42', logger)).toEqual([{ type: 'number', value: 42, raw: '42' }]);
    });

    it('tokenizes strings', () => {
      expect(tokenize('"hello"', logger)).toEqual([
        { type: 'string', value: 'hello', raw: '"hello"' },
      ]);
    });

    it('tokenizes simple operators', () => {
      expect(tokenize('2 + 2', logger)).toEqual([
        { type: 'number', value: 2, raw: '2' },
        { type: 'operator', value: '+', raw: '+' },
        { type: 'number', value: 2, raw: '2' },
      ]);
    });
  });

  describe('nullish coalescing', () => {
    it('tokenizes nullish coalescing operator', () => {
      expect(tokenize('null ?? "default"', logger)).toEqual([
        { type: 'identifier', value: 'null', raw: 'null' },
        { type: 'operator', value: '??', raw: '??' },
        { type: 'string', value: 'default', raw: '"default"' },
      ]);
    });

    it('tokenizes nullish coalescing with references', () => {
      expect(tokenize('${value} ?? "default"', logger)).toEqual([
        {
          type: 'reference',
          value: [{ type: 'identifier', value: 'value', raw: 'value' }],
          raw: '${value}',
        },
        { type: 'operator', value: '??', raw: '??' },
        { type: 'string', value: 'default', raw: '"default"' },
      ]);
    });

    it('tokenizes chained nullish coalescing', () => {
      expect(tokenize('${a} ?? ${b} ?? "default"', logger)).toEqual([
        {
          type: 'reference',
          value: [{ type: 'identifier', value: 'a', raw: 'a' }],
          raw: '${a}',
        },
        { type: 'operator', value: '??', raw: '??' },
        {
          type: 'reference',
          value: [{ type: 'identifier', value: 'b', raw: 'b' }],
          raw: '${b}',
        },
        { type: 'operator', value: '??', raw: '??' },
        { type: 'string', value: 'default', raw: '"default"' },
      ]);
    });
  });

  describe('references', () => {
    it('tokenizes references with nested expressions', () => {
      expect(tokenize('${foo}', logger)).toEqual([
        {
          type: 'reference',
          value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
          raw: '${foo}',
        },
      ]);

      expect(tokenize('${foo.bar}', logger)).toEqual([
        {
          type: 'reference',
          value: [
            { type: 'identifier', value: 'foo', raw: 'foo' },
            { type: 'operator', value: '.', raw: '.' },
            { type: 'identifier', value: 'bar', raw: 'bar' },
          ],
          raw: '${foo.bar}',
        },
      ]);

      expect(tokenize('${foo[${bar}]}', logger)).toEqual([
        {
          type: 'reference',
          value: [
            { type: 'identifier', value: 'foo', raw: 'foo' },
            { type: 'punctuation', value: '[', raw: '[' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'bar', raw: 'bar' }],
              raw: '${bar}',
            },
            { type: 'punctuation', value: ']', raw: ']' },
          ],
          raw: '${foo[${bar}]}',
        },
      ]);
    });
  });

  describe('complex expressions', () => {
    it('tokenizes object literals', () => {
      expect(tokenize('{ key: ${value} }', logger)).toEqual([
        {
          type: 'object_literal',
          value: [
            { type: 'string', value: 'key', raw: 'key' },
            { type: 'punctuation', value: ':', raw: ':' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'value', raw: 'value' }],
              raw: '${value}',
            },
          ],
          raw: '{ key: ${value} }',
        },
      ]);

      expect(tokenize('{ key1: "value1", key2: "value2" }', logger)).toEqual([
        {
          type: 'object_literal',
          value: [
            { type: 'string', value: 'key1', raw: 'key1' },
            { type: 'punctuation', value: ':', raw: ':' },
            { type: 'string', value: 'value1', raw: '"value1"' },
            { type: 'punctuation', value: ',', raw: ',' },
            { type: 'string', value: 'key2', raw: 'key2' },
            { type: 'punctuation', value: ':', raw: ':' },
            { type: 'string', value: 'value2', raw: '"value2"' },
          ],
          raw: '{ key1: "value1", key2: "value2" }',
        },
      ]);
    });

    it('tokenizes array literals', () => {
      expect(tokenize('[1, ...${foo}]', logger)).toEqual([
        {
          type: 'array_literal',
          value: [
            { type: 'number', value: 1, raw: '1' },
            { type: 'punctuation', value: ',', raw: ',' },
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
              raw: '${foo}',
            },
          ],
          raw: '[1, ...${foo}]',
        },
      ]);
    });

    it('tokenizes template literals', () => {
      expect(tokenize('`Value is ${foo}`', logger)).toEqual([
        { type: 'string', value: 'Value is ', raw: 'Value is ' },
        {
          type: 'reference',
          value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
          raw: '${foo}',
        },
      ]);

      expect(tokenize('`${foo} and ${bar}`', logger)).toEqual([
        {
          type: 'reference',
          value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
          raw: '${foo}',
        },
        { type: 'string', value: ' and ', raw: ' and ' },
        {
          type: 'reference',
          value: [{ type: 'identifier', value: 'bar', raw: 'bar' }],
          raw: '${bar}',
        },
      ]);
    });

    it('tokenizes nested structures', () => {
      expect(tokenize('{ arr: [1, ${foo}, { nested: ${bar} }] }', logger)).toEqual([
        {
          type: 'object_literal',
          value: [
            { type: 'string', value: 'arr', raw: 'arr' },
            { type: 'punctuation', value: ':', raw: ':' },
            {
              type: 'array_literal',
              value: [
                { type: 'number', value: 1, raw: '1' },
                { type: 'punctuation', value: ',', raw: ',' },
                {
                  type: 'reference',
                  value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
                  raw: '${foo}',
                },
                { type: 'punctuation', value: ',', raw: ',' },
                {
                  type: 'object_literal',
                  value: [
                    { type: 'string', value: 'nested', raw: 'nested' },
                    { type: 'punctuation', value: ':', raw: ':' },
                    {
                      type: 'reference',
                      value: [{ type: 'identifier', value: 'bar', raw: 'bar' }],
                      raw: '${bar}',
                    },
                  ],
                  raw: '{ nested: ${bar} }',
                },
              ],
              raw: '[1, ${foo}, { nested: ${bar} }]',
            },
          ],
          raw: '{ arr: [1, ${foo}, { nested: ${bar} }] }',
        },
      ]);
    });
  });

  describe('spread operator', () => {
    it('tokenizes spread operator in object literals', () => {
      expect(tokenize('{ ...${foo} }', logger)).toEqual([
        {
          type: 'object_literal',
          value: [
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
              raw: '${foo}',
            },
          ],
          raw: '{ ...${foo} }',
        },
      ]);

      expect(tokenize('{ ...${foo}, bar: "baz" }', logger)).toEqual([
        {
          type: 'object_literal',
          value: [
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
              raw: '${foo}',
            },
            { type: 'punctuation', value: ',', raw: ',' },
            { type: 'string', value: 'bar', raw: 'bar' },
            { type: 'punctuation', value: ':', raw: ':' },
            { type: 'string', value: 'baz', raw: '"baz"' },
          ],
          raw: '{ ...${foo}, bar: "baz" }',
        },
      ]);
    });

    it('tokenizes spread operator in array literals', () => {
      expect(tokenize('[...${foo}]', logger)).toEqual([
        {
          type: 'array_literal',
          value: [
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
              raw: '${foo}',
            },
          ],
          raw: '[...${foo}]',
        },
      ]);

      expect(tokenize('[...${foo}, 1, 2]', logger)).toEqual([
        {
          type: 'array_literal',
          value: [
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
              raw: '${foo}',
            },
            { type: 'punctuation', value: ',', raw: ',' },
            { type: 'number', value: 1, raw: '1' },
            { type: 'punctuation', value: ',', raw: ',' },
            { type: 'number', value: 2, raw: '2' },
          ],
          raw: '[...${foo}, 1, 2]',
        },
      ]);
    });

    it('tokenizes multiple spread operators', () => {
      expect(tokenize('{ ...${foo}, ...${bar} }', logger)).toEqual([
        {
          type: 'object_literal',
          raw: '{ ...${foo}, ...${bar} }',
          value: [
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
              raw: '${foo}',
            },
            { type: 'punctuation', value: ',', raw: ',' },
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'bar', raw: 'bar' }],
              raw: '${bar}',
            },
          ],
        },
      ]);
    });
  });

  describe('spread operator validation', () => {
    it('allows spreading references and expressions', () => {
      // References should be allowed
      expect(() => tokenize('[1, 2, ...${foo}]', logger)).not.toThrow();
      expect(() => tokenize('[1, 2, ...${foo.bar}]', logger)).not.toThrow();

      // Array/object literals should be allowed
      expect(() => tokenize('[1, 2, ...[3, 4]]', logger)).not.toThrow();
      expect(() => tokenize('[1, 2, ...{a: 1}]', logger)).not.toThrow();
    });
  });

  describe('operator sequences', () => {
    it('handles operator sequences with braces', () => {
      // Test operator sequences inside braces
      expect(tokenize('{ some text + more text }', logger)).toEqual([
        { type: 'punctuation', value: '{', raw: '{' },
        { type: 'string', value: ' some text ', raw: ' some text ' },
        { type: 'operator', value: '+', raw: '+' },
        { type: 'string', value: ' more text ', raw: ' more text ' },
        { type: 'punctuation', value: '}', raw: '}' },
      ]);
    });
  });

  describe('reference tokenization', () => {
    it('should tokenize simple references with correct raw values', () => {
      expect(tokenize('${foo}', logger)).toEqual([
        {
          type: 'reference',
          value: [
            {
              type: 'identifier',
              value: 'foo',
              raw: 'foo',
            },
          ],
          raw: '${foo}',
        },
      ]);
    });

    it('should tokenize nested references with correct raw values', () => {
      expect(tokenize('${foo.${bar}}', logger)).toEqual([
        {
          type: 'reference',
          value: [
            {
              type: 'identifier',
              value: 'foo',
              raw: 'foo',
            },
            {
              type: 'operator',
              value: '.',
              raw: '.',
            },
            {
              type: 'reference',
              value: [
                {
                  type: 'identifier',
                  value: 'bar',
                  raw: 'bar',
                },
              ],
              raw: '${bar}',
            },
          ],
          raw: '${foo.${bar}}',
        },
      ]);
    });

    it('should tokenize property access in references', () => {
      expect(tokenize('${foo.bar}', logger)).toEqual([
        {
          type: 'reference',
          value: [
            {
              type: 'identifier',
              value: 'foo',
              raw: 'foo',
            },
            {
              type: 'operator',
              value: '.',
              raw: '.',
            },
            {
              type: 'identifier',
              value: 'bar',
              raw: 'bar',
            },
          ],
          raw: '${foo.bar}',
        },
      ]);
    });
  });

  describe('spread operator with references', () => {
    it('should tokenize spread with references correctly', () => {
      expect(tokenize('{ ...${foo} }', logger)).toEqual([
        {
          type: 'object_literal',
          value: [
            {
              type: 'operator',
              value: '...',
              raw: '...',
            },
            {
              type: 'reference',
              value: [
                {
                  type: 'identifier',
                  value: 'foo',
                  raw: 'foo',
                },
              ],
              raw: '${foo}',
            },
          ],
          raw: '{ ...${foo} }',
        },
      ]);
    });

    it('should tokenize spread with nested references correctly', () => {
      expect(tokenize('{ ...${foo.${bar}} }', logger)).toEqual([
        {
          type: 'object_literal',
          value: [
            {
              type: 'operator',
              value: '...',
              raw: '...',
            },
            {
              type: 'reference',
              value: [
                {
                  type: 'identifier',
                  value: 'foo',
                  raw: 'foo',
                },
                {
                  type: 'operator',
                  value: '.',
                  raw: '.',
                },
                {
                  type: 'reference',
                  value: [
                    {
                      type: 'identifier',
                      value: 'bar',
                      raw: 'bar',
                    },
                  ],
                  raw: '${bar}',
                },
              ],
              raw: '${foo.${bar}}',
            },
          ],
          raw: '{ ...${foo.${bar}} }',
        },
      ]);
    });
  });

  describe('object literal key tokenization', () => {
    it('should tokenize object keys as string tokens', () => {
      expect(tokenize('{ key: ${value} }', logger)).toEqual([
        {
          type: 'object_literal',
          value: [
            {
              type: 'string',
              value: 'key',
              raw: 'key',
            },
            {
              type: 'punctuation',
              value: ':',
              raw: ':',
            },
            {
              type: 'reference',
              value: [
                {
                  type: 'identifier',
                  value: 'value',
                  raw: 'value',
                },
              ],
              raw: '${value}',
            },
          ],
          raw: '{ key: ${value} }',
        },
      ]);
    });

    it('should tokenize object keys with references', () => {
      expect(tokenize('{ ${key}: value }', logger)).toEqual([
        {
          type: 'object_literal',
          value: [
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'key', raw: 'key' }],
              raw: '${key}',
            },
            { type: 'punctuation', value: ':', raw: ':' },
            { type: 'identifier', value: 'value', raw: 'value' },
          ],
          raw: '{ ${key}: value }',
        },
      ]);
    });
  });

  describe('whitespace handling', () => {
    it('handles various whitespace patterns consistently', () => {
      const expressions = ['2 + 2', '2+2', '2   +   2', '\t2\t+\t2\t', '\n2\n+\n2\n'];

      const expected = [
        { type: 'number', value: 2, raw: '2' },
        { type: 'operator', value: '+', raw: '+' },
        { type: 'number', value: 2, raw: '2' },
      ];

      expressions.forEach((expr) => {
        expect(tokenize(expr, logger)).toEqual(expected);
      });
    });

    it('preserves whitespace in string literals', () => {
      expect(tokenize('" hello  world "', logger)).toEqual([
        { type: 'string', value: ' hello  world ', raw: '" hello  world "' },
      ]);
    });

    it('preserves whitespace in template literals', () => {
      expect(tokenize('`  ${foo}  ${bar}  `', logger)).toEqual([
        { type: 'string', value: '  ', raw: '  ' },
        {
          type: 'reference',
          value: [{ type: 'identifier', value: 'foo', raw: 'foo' }],
          raw: '${foo}',
        },
        { type: 'string', value: '  ', raw: '  ' },
        {
          type: 'reference',
          value: [{ type: 'identifier', value: 'bar', raw: 'bar' }],
          raw: '${bar}',
        },
        { type: 'string', value: '  ', raw: '  ' },
      ]);
    });
  });

  describe('template literal handling', () => {
    it('should tokenize simple template literals', () => {
      expect(tokenize('`Hello ${name}`', logger)).toEqual([
        {
          type: 'string',
          value: 'Hello ',
          raw: 'Hello ',
        },
        {
          type: 'reference',
          value: [
            {
              type: 'identifier',
              value: 'name',
              raw: 'name',
            },
          ],
          raw: '${name}',
        },
      ]);
    });

    it('should handle periods in string literals correctly', () => {
      expect(tokenize('`Hello there. My name is ${name}!`', logger)).toEqual([
        {
          type: 'string',
          value: 'Hello there. My name is ',
          raw: 'Hello there. My name is ',
        },
        {
          type: 'reference',
          value: [
            {
              type: 'identifier',
              value: 'name',
              raw: 'name',
            },
          ],
          raw: '${name}',
        },
        {
          type: 'string',
          value: '!',
          raw: '!',
        },
      ]);

      // Also test with regular string literals
      expect(tokenize('"Hello there. This is a test."', logger)).toEqual([
        {
          type: 'string',
          value: 'Hello there. This is a test.',
          raw: '"Hello there. This is a test."',
        },
      ]);
    });

    it('should tokenize template literals with expressions', () => {
      expect(tokenize('`Count: ${1 + 2}`', logger)).toEqual([
        {
          type: 'string',
          value: 'Count: ',
          raw: 'Count: ',
        },
        {
          type: 'reference',
          value: [
            {
              type: 'number',
              value: 1,
              raw: '1',
            },
            {
              type: 'operator',
              value: '+',
              raw: '+',
            },
            {
              type: 'number',
              value: 2,
              raw: '2',
            },
          ],
          raw: '${1 + 2}',
        },
      ]);
    });

    it('should tokenize template literals with nested references', () => {
      expect(tokenize('`${user.${field}}`', logger)).toEqual([
        {
          type: 'reference',
          value: [
            {
              type: 'identifier',
              value: 'user',
              raw: 'user',
            },
            {
              type: 'operator',
              value: '.',
              raw: '.',
            },
            {
              type: 'reference',
              value: [
                {
                  type: 'identifier',
                  value: 'field',
                  raw: 'field',
                },
              ],
              raw: '${field}',
            },
          ],
          raw: '${user.${field}}',
        },
      ]);
    });

    it('should handle escaped characters in template literals', () => {
      expect(tokenize('`Hello \\${name}`', logger)).toEqual([
        {
          type: 'string',
          value: 'Hello ${name}',
          raw: 'Hello \\${name}',
        },
      ]);
    });
  });

  describe('complex expressions', () => {
    it('should handle complex object literals with nested structures', () => {
      expect(tokenize('{ foo: { bar: ${baz.${qux}} } }', logger)).toEqual([
        {
          type: 'object_literal',
          value: [
            {
              type: 'string',
              value: 'foo',
              raw: 'foo',
            },
            {
              type: 'punctuation',
              value: ':',
              raw: ':',
            },
            {
              type: 'object_literal',
              value: [
                {
                  type: 'string',
                  value: 'bar',
                  raw: 'bar',
                },
                {
                  type: 'punctuation',
                  value: ':',
                  raw: ':',
                },
                {
                  type: 'reference',
                  value: [
                    {
                      type: 'identifier',
                      value: 'baz',
                      raw: 'baz',
                    },
                    {
                      type: 'operator',
                      value: '.',
                      raw: '.',
                    },
                    {
                      type: 'reference',
                      value: [
                        {
                          type: 'identifier',
                          value: 'qux',
                          raw: 'qux',
                        },
                      ],
                      raw: '${qux}',
                    },
                  ],
                  raw: '${baz.${qux}}',
                },
              ],
              raw: '{ bar: ${baz.${qux}} }',
            },
          ],
          raw: '{ foo: { bar: ${baz.${qux}} } }',
        },
      ]);
    });

    it('should handle array literals with complex expressions', () => {
      expect(tokenize('[1, ...${arr}, ${x + 2}]', logger)).toEqual([
        {
          type: 'array_literal',
          value: [
            {
              type: 'number',
              value: 1,
              raw: '1',
            },
            {
              type: 'punctuation',
              value: ',',
              raw: ',',
            },
            {
              type: 'operator',
              value: '...',
              raw: '...',
            },
            {
              type: 'reference',
              value: [
                {
                  type: 'identifier',
                  value: 'arr',
                  raw: 'arr',
                },
              ],
              raw: '${arr}',
            },
            {
              type: 'punctuation',
              value: ',',
              raw: ',',
            },
            {
              type: 'reference',
              value: [
                {
                  type: 'identifier',
                  value: 'x',
                  raw: 'x',
                },
                {
                  type: 'operator',
                  value: '+',
                  raw: '+',
                },
                {
                  type: 'number',
                  value: 2,
                  raw: '2',
                },
              ],
              raw: '${x + 2}',
            },
          ],
          raw: '[1, ...${arr}, ${x + 2}]',
        },
      ]);
    });
  });

  describe('equality operators', () => {
    it('tokenizes strict equality operator (===) as one token', () => {
      expect(tokenize('a === b', logger)).toEqual([
        { type: 'identifier', value: 'a', raw: 'a' },
        { type: 'operator', value: '===', raw: '===' },
        { type: 'identifier', value: 'b', raw: 'b' },
      ]);
    });

    it('tokenizes strict inequality operator (!==) as one token', () => {
      expect(tokenize('a !== b', logger)).toEqual([
        { type: 'identifier', value: 'a', raw: 'a' },
        { type: 'operator', value: '!==', raw: '!==' },
        { type: 'identifier', value: 'b', raw: 'b' },
      ]);
    });
  });

  describe('array literals', () => {
    it('tokenizes array literals with spread operators and trailing elements', () => {
      expect(tokenize('[ ...${arr}, "foo" ]', logger)).toEqual([
        {
          type: 'array_literal',
          value: [
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'arr', raw: 'arr' }],
              raw: '${arr}',
            },
            { type: 'punctuation', value: ',', raw: ',' },
            { type: 'string', value: 'foo', raw: '"foo"' },
          ],
          raw: '[ ...${arr}, "foo" ]',
        },
      ]);
    });

    it('tokenizes array literals with multiple spread operators and elements', () => {
      expect(tokenize('[ ...${a}, 1, ...${b}, "foo" ]', logger)).toEqual([
        {
          type: 'array_literal',
          value: [
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'a', raw: 'a' }],
              raw: '${a}',
            },
            { type: 'punctuation', value: ',', raw: ',' },
            { type: 'number', value: 1, raw: '1' },
            { type: 'punctuation', value: ',', raw: ',' },
            { type: 'operator', value: '...', raw: '...' },
            {
              type: 'reference',
              value: [{ type: 'identifier', value: 'b', raw: 'b' }],
              raw: '${b}',
            },
            { type: 'punctuation', value: ',', raw: ',' },
            { type: 'string', value: 'foo', raw: '"foo"' },
          ],
          raw: '[ ...${a}, 1, ...${b}, "foo" ]',
        },
      ]);
    });
  });
});
