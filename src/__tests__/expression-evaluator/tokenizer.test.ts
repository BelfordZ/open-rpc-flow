import { tokenize, TokenizerError } from '../../expression-evaluator/tokenizer';

describe('tokenize', () => {
  describe('simple expressions', () => {
    it('tokenizes numbers', () => {
      expect(tokenize('42')).toEqual([
        { type: 'number', value: '42', raw: '42' },
      ]);
      expect(tokenize('-42')).toEqual([
        { type: 'operator', value: '-', raw: '-' },
        { type: 'number', value: '42', raw: '42' },
      ]);
      expect(tokenize('3.14')).toEqual([
        { type: 'number', value: '3.14', raw: '3.14' },
      ]);
    });

    it('tokenizes strings', () => {
      expect(tokenize('"hello"')).toEqual([
        { type: 'string', value: 'hello', raw: 'hello"' },
      ]);
      expect(tokenize("'world'")).toEqual([
        { type: 'string', value: 'world', raw: "world'" },
      ]);
      expect(tokenize('"contains \\"escaped\\" quotes"')).toEqual([
        { type: 'string', value: 'contains "escaped" quotes', raw: 'contains \\"escaped\\" quotes"' },
      ]);
    });

    it('tokenizes operators', () => {
      expect(tokenize('2 + 2')).toEqual([
        { type: 'number', value: '2', raw: '2' },
        { type: 'operator', value: '+', raw: '+' },
        { type: 'number', value: '2', raw: '2' },
      ]);
      expect(tokenize('3 * 4')).toEqual([
        { type: 'number', value: '3', raw: '3' },
        { type: 'operator', value: '*', raw: '*' },
        { type: 'number', value: '4', raw: '4' },
      ]);
      expect(tokenize('a >= b')).toEqual([
        { type: 'identifier', value: 'a', raw: 'a' },
        { type: 'operator', value: '>=', raw: '>=' },
        { type: 'identifier', value: 'b', raw: 'b' },
      ]);
      expect(tokenize('a !== b')).toEqual([
        { type: 'identifier', value: 'a', raw: 'a' },
        { type: 'operator', value: '!==', raw: '!==' },
        { type: 'identifier', value: 'b', raw: 'b' },
      ]);
    });

    it('tokenizes parentheses', () => {
      expect(tokenize('(2 + 3) * 4')).toEqual([
        { type: 'punctuation', value: '(', raw: '(' },
        { type: 'number', value: '2', raw: '2' },
        { type: 'operator', value: '+', raw: '+' },
        { type: 'number', value: '3', raw: '3' },
        { type: 'punctuation', value: ')', raw: ')' },
        { type: 'operator', value: '*', raw: '*' },
        { type: 'number', value: '4', raw: '4' },
      ]);
    });
  });

  describe('references', () => {
    it('tokenizes simple references', () => {
      expect(tokenize('${foo}')).toEqual([
        { type: 'identifier', value: '${foo}', raw: '${foo}' },
      ]);
    });

    it('tokenizes references with dot notation', () => {
      expect(tokenize('${foo.bar}')).toEqual([
        { type: 'identifier', value: '${foo.bar}', raw: '${foo.bar}' },
      ]);
      expect(tokenize('${foo.bar.baz}')).toEqual([
        { type: 'identifier', value: '${foo.bar.baz}', raw: '${foo.bar.baz}' },
      ]);
    });

    it('tokenizes references with array notation', () => {
      expect(tokenize('${foo["bar"]}')).toEqual([
        { type: 'identifier', value: '${foo["bar"]}', raw: '${foo["bar"]}' },
      ]);
      expect(tokenize('${foo[0]}')).toEqual([
        { type: 'identifier', value: '${foo[0]}', raw: '${foo[0]}' },
      ]);
      expect(tokenize('${foo.bar[0].baz}')).toEqual([
        { type: 'identifier', value: '${foo.bar[0].baz}', raw: '${foo.bar[0].baz}' },
      ]);
    });

    it('tokenizes nested references', () => {
      expect(tokenize('${foo[${bar}]}')).toEqual([
        { type: 'identifier', value: '${foo[${bar}]}', raw: '${foo[${bar}]}' },
      ]);
    });
  });

  describe('complex expressions', () => {
    it('tokenizes expressions with references', () => {
      expect(tokenize('${foo} + ${bar}')).toEqual([
        { type: 'identifier', value: '${foo}', raw: '${foo}' },
        { type: 'operator', value: '+', raw: '+' },
        { type: 'identifier', value: '${bar}', raw: '${bar}' },
      ]);
    });

    it('tokenizes expressions with mixed types', () => {
      expect(tokenize('${foo} > 42')).toEqual([
        { type: 'identifier', value: '${foo}', raw: '${foo}' },
        { type: 'operator', value: '>', raw: '>' },
        { type: 'number', value: '42', raw: '42' },
      ]);
    });

    it('tokenizes template literals', () => {
      expect(tokenize('Value is ${foo}')).toEqual([
        { type: 'identifier', value: 'Value', raw: 'Value' },
        { type: 'identifier', value: 'is', raw: 'is' },
        { type: 'identifier', value: '${foo}', raw: '${foo}' },
      ]);
      expect(tokenize('Value is ${foo} and ${bar}')).toEqual([
        { type: 'identifier', value: 'Value', raw: 'Value' },
        { type: 'identifier', value: 'is', raw: 'is' },
        { type: 'identifier', value: '${foo}', raw: '${foo}' },
        { type: 'identifier', value: 'and', raw: 'and' },
        { type: 'identifier', value: '${bar}', raw: '${bar}' },
      ]);
    });

    it('tokenizes complex expressions with parentheses', () => {
      expect(tokenize('(${foo} + 2) * ${bar}')).toEqual([
        { type: 'punctuation', value: '(', raw: '(' },
        { type: 'identifier', value: '${foo}', raw: '${foo}' },
        { type: 'operator', value: '+', raw: '+' },
        { type: 'number', value: '2', raw: '2' },
        { type: 'punctuation', value: ')', raw: ')' },
        { type: 'operator', value: '*', raw: '*' },
        { type: 'identifier', value: '${bar}', raw: '${bar}' },
      ]);
    });

    it('tokenizes object literals', () => {
      expect(tokenize('{ key: ${value} }')).toEqual([
        { type: 'punctuation', value: '{', raw: '{' },
        { type: 'identifier', value: 'key', raw: 'key' },
        { type: 'punctuation', value: ':', raw: ':' },
        { type: 'identifier', value: '${value}', raw: '${value}' },
        { type: 'punctuation', value: '}', raw: '}' },
      ]);
    });
  });

  describe('error cases', () => {
    it('throws on empty expression', () => {
      expect(() => tokenize('')).toThrow(TokenizerError);
      expect(() => tokenize('   ')).toThrow(TokenizerError);
    });

    it('handles unclosed quotes', () => {
      expect(() => tokenize('"unclosed')).toThrow(TokenizerError);
      expect(() => tokenize("'unclosed")).toThrow(TokenizerError);
    });

    it('handles unclosed references', () => {
      expect(() => tokenize('${unclosed')).toThrow(TokenizerError);
    });

    it('handles invalid operators', () => {
      expect(() => tokenize('a @ b')).toThrow(TokenizerError);
      expect(() => tokenize('a $$ b')).toThrow(TokenizerError);
    });

    it('handles invalid reference syntax', () => {
      expect(() => tokenize('$foo')).toThrow(TokenizerError);
      expect(() => tokenize('${foo}}')).toThrow(TokenizerError);
    });

    it('handles malformed expressions', () => {
      expect(() => tokenize('2 + + 2')).toThrow(TokenizerError);
      expect(() => tokenize('(2 + 3')).toThrow(TokenizerError);
    });
  });
}); 