import { tokenize, TokenizerError } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

describe('tokenize', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger();
  });

  describe('simple expressions', () => {
    it('tokenizes numbers', () => {
      expect(tokenize('42', logger)).toEqual([{ type: 'number', value: '42', raw: '42' }]);
      expect(tokenize('-42', logger)).toEqual([
        { type: 'operator', value: '-', raw: '-' },
        { type: 'number', value: '42', raw: '42' },
      ]);
      expect(tokenize('3.14', logger)).toEqual([{ type: 'number', value: '3.14', raw: '3.14' }]);
    });

    it('tokenizes strings', () => {
      expect(tokenize('"hello"', logger)).toEqual([
        { type: 'string', value: 'hello', raw: 'hello"' },
      ]);
      expect(tokenize("'world'", logger)).toEqual([
        { type: 'string', value: 'world', raw: "world'" },
      ]);
      expect(tokenize('"contains \\"escaped\\" quotes"', logger)).toEqual([
        {
          type: 'string',
          value: 'contains "escaped" quotes',
          raw: 'contains \\"escaped\\" quotes"',
        },
      ]);
    });

    it('tokenizes operators', () => {
      expect(tokenize('2 + 2', logger)).toEqual([
        { type: 'number', value: '2', raw: '2' },
        { type: 'operator', value: '+', raw: '+' },
        { type: 'number', value: '2', raw: '2' },
      ]);
      expect(tokenize('3 * 4', logger)).toEqual([
        { type: 'number', value: '3', raw: '3' },
        { type: 'operator', value: '*', raw: '*' },
        { type: 'number', value: '4', raw: '4' },
      ]);
      expect(tokenize('a >= b', logger)).toEqual([
        { type: 'identifier', value: 'a', raw: 'a' },
        { type: 'operator', value: '>=', raw: '>=' },
        { type: 'identifier', value: 'b', raw: 'b' },
      ]);
      expect(tokenize('a !== b', logger)).toEqual([
        { type: 'identifier', value: 'a', raw: 'a' },
        { type: 'operator', value: '!==', raw: '!==' },
        { type: 'identifier', value: 'b', raw: 'b' },
      ]);
      expect(tokenize('a === b', logger)).toEqual([
        { type: 'identifier', value: 'a', raw: 'a' },
        { type: 'operator', value: '===', raw: '===' },
        { type: 'identifier', value: 'b', raw: 'b' },
      ]);
      expect(tokenize('[1, ...arr]', logger)).toEqual([
        { type: 'punctuation', value: '[', raw: '[' },
        { type: 'number', value: '1', raw: '1' },
        { type: 'punctuation', value: ',', raw: ',' },
        { type: 'operator', value: '...', raw: '...' },
        { type: 'identifier', value: 'arr', raw: 'arr' },
        { type: 'punctuation', value: ']', raw: ']' },
      ]);
    });

    it('tokenizes parentheses', () => {
      expect(tokenize('(2 + 3) * 4', logger)).toEqual([
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
      expect(tokenize('${foo}', logger)).toEqual([
        { type: 'identifier', value: '${foo}', raw: '${foo}' },
      ]);
    });

    it('tokenizes references with dot notation', () => {
      expect(tokenize('${foo.bar}', logger)).toEqual([
        { type: 'identifier', value: '${foo.bar}', raw: '${foo.bar}' },
      ]);
      expect(tokenize('${foo.bar.baz}', logger)).toEqual([
        { type: 'identifier', value: '${foo.bar.baz}', raw: '${foo.bar.baz}' },
      ]);
    });

    it('tokenizes references with array notation', () => {
      expect(tokenize('${foo["bar"]}', logger)).toEqual([
        { type: 'identifier', value: '${foo["bar"]}', raw: '${foo["bar"]}' },
      ]);
      expect(tokenize('${foo[0]}', logger)).toEqual([
        { type: 'identifier', value: '${foo[0]}', raw: '${foo[0]}' },
      ]);
      expect(tokenize('${foo.bar[0].baz}', logger)).toEqual([
        { type: 'identifier', value: '${foo.bar[0].baz}', raw: '${foo.bar[0].baz}' },
      ]);
    });

    it('tokenizes nested references', () => {
      expect(tokenize('${foo[${bar}]}', logger)).toEqual([
        { type: 'identifier', value: '${foo[${bar}]}', raw: '${foo[${bar}]}' },
      ]);
    });
  });

  describe('complex expressions', () => {
    it('tokenizes expressions with references', () => {
      expect(tokenize('${foo} + ${bar}', logger)).toEqual([
        { type: 'identifier', value: '${foo}', raw: '${foo}' },
        { type: 'operator', value: '+', raw: '+' },
        { type: 'identifier', value: '${bar}', raw: '${bar}' },
      ]);
    });

    it('tokenizes expressions with mixed types', () => {
      expect(tokenize('${foo} > 42', logger)).toEqual([
        { type: 'identifier', value: '${foo}', raw: '${foo}' },
        { type: 'operator', value: '>', raw: '>' },
        { type: 'number', value: '42', raw: '42' },
      ]);
    });

    it('tokenizes template literals', () => {
      expect(tokenize('Value is ${foo}', logger)).toEqual([
        { type: 'identifier', value: 'Value', raw: 'Value' },
        { type: 'identifier', value: 'is', raw: 'is' },
        { type: 'identifier', value: '${foo}', raw: '${foo}' },
      ]);
      expect(tokenize('Value is ${foo} and ${bar}', logger)).toEqual([
        { type: 'identifier', value: 'Value', raw: 'Value' },
        { type: 'identifier', value: 'is', raw: 'is' },
        { type: 'identifier', value: '${foo}', raw: '${foo}' },
        { type: 'identifier', value: 'and', raw: 'and' },
        { type: 'identifier', value: '${bar}', raw: '${bar}' },
      ]);
    });

    it('tokenizes complex expressions with parentheses', () => {
      expect(tokenize('(${foo} + 2) * ${bar}', logger)).toEqual([
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
      expect(tokenize('{ key: ${value} }', logger)).toEqual([
        { type: 'punctuation', value: '{', raw: '{' },
        { type: 'identifier', value: 'key', raw: 'key' },
        { type: 'punctuation', value: ':', raw: ':' },
        { type: 'identifier', value: '${value}', raw: '${value}' },
        { type: 'punctuation', value: '}', raw: '}' },
      ]);
      // Test comma punctuation
      expect(tokenize('{ key1: val1, key2: val2 }', logger)).toEqual([
        { type: 'punctuation', value: '{', raw: '{' },
        { type: 'identifier', value: 'key1', raw: 'key1' },
        { type: 'punctuation', value: ':', raw: ':' },
        { type: 'identifier', value: 'val1', raw: 'val1' },
        { type: 'punctuation', value: ',', raw: ',' },
        { type: 'identifier', value: 'key2', raw: 'key2' },
        { type: 'punctuation', value: ':', raw: ':' },
        { type: 'identifier', value: 'val2', raw: 'val2' },
        { type: 'punctuation', value: '}', raw: '}' },
      ]);
    });
  });

  describe('error cases', () => {
    it('throws on empty expression', () => {
      expect(() => tokenize('', logger)).toThrow(TokenizerError);
      expect(() => tokenize('   ', logger)).toThrow(TokenizerError);
    });

    it('throws on expression that results in no tokens', () => {
      // Create a string that looks like it might have content but tokenizes to nothing
      const expression = '...'; // This will try to parse as an operator but fail validation
      expect(() => tokenize(expression, logger)).toThrow(TokenizerError);
      expect(() => tokenize(expression, logger)).toThrow('Operator ... missing operand');
    });

    it('handles unclosed quotes', () => {
      expect(() => tokenize('"unclosed', logger)).toThrow(TokenizerError);
      expect(() => tokenize("'unclosed", logger)).toThrow(TokenizerError);
    });

    it('handles unclosed references', () => {
      expect(() => tokenize('${unclosed', logger)).toThrow(TokenizerError);
    });

    it('handles invalid operators', () => {
      expect(() => tokenize('a @ b', logger)).toThrow(TokenizerError);
      expect(() => tokenize('a $$ b', logger)).toThrow(TokenizerError);
      // Test all invalid operator sequences
      expect(() => tokenize('a ++ b', logger)).toThrow('Invalid operator sequence: ++');
      expect(() => tokenize('a -- b', logger)).toThrow('Invalid operator sequence: --');
      expect(() => tokenize('a ** b', logger)).toThrow('Invalid operator sequence: **');
      expect(() => tokenize('a <> b', logger)).toThrow('Invalid operator sequence: <>');
      expect(() => tokenize('a >> b', logger)).toThrow('Invalid operator sequence: >>');
      expect(() => tokenize('a << b', logger)).toThrow('Invalid operator sequence: <<');
      // Test valid operator sequences
      expect(() => tokenize('a + b', logger)).not.toThrow();
      expect(() => tokenize('a - b', logger)).not.toThrow();
      expect(() => tokenize('a * b', logger)).not.toThrow();
    });

    it('handles invalid reference syntax', () => {
      expect(() => tokenize('$foo', logger)).toThrow(TokenizerError);
      expect(() => tokenize('${foo}}', logger)).toThrow(TokenizerError);
    });

    it('handles malformed expressions', () => {
      expect(() => tokenize('2 + }', logger)).toThrow(
        'Unmatched closing parenthesis/brace/bracket',
      );
      expect(() => tokenize('2 + ]', logger)).toThrow(
        'Unmatched closing parenthesis/brace/bracket',
      );
      // Test nested braces with mismatched depths
      expect(() => tokenize('{ } }', logger)).toThrow(
        'Unmatched closing parenthesis/brace/bracket',
      );
      expect(() => tokenize('{ } )', logger)).toThrow(
        'Unmatched closing parenthesis/brace/bracket',
      );
      expect(() => tokenize('{ } ]', logger)).toThrow(
        'Unmatched closing parenthesis/brace/bracket',
      );
      // Test unclosed opening braces/brackets
      expect(() => tokenize('{ 2 + 3', logger)).toThrow('Unclosed braces');
      expect(() => tokenize('[ 2 + 3', logger)).toThrow('Unclosed brackets');
      // For nested structures, braces are checked before brackets
      expect(() => tokenize('{ [', logger)).toThrow('Unclosed braces');
      expect(() => tokenize('[ {', logger)).toThrow('Unclosed braces');
    });

    it('handles operators without sufficient operands', () => {
      expect(() => tokenize('2 +', logger)).toThrow(TokenizerError);
      expect(() => tokenize('2 *', logger)).toThrow(TokenizerError);
      expect(() => tokenize('2 >', logger)).toThrow(TokenizerError);
      // Test operator at end of expression (nextToken will be null)
      expect(() => tokenize('2 +', logger)).toThrow('Unary operator + missing operand');
      expect(() => tokenize('2 *', logger)).toThrow('Operator * missing operand');
      expect(() => tokenize('2 /', logger)).toThrow('Operator / missing operand');
      expect(() => tokenize('2 %', logger)).toThrow('Operator % missing operand');
      // Test operator at end of expression with invalid operator sequence
      expect(() => tokenize('2 ++', logger)).toThrow('Invalid operator sequence: ++');
      // Test operator at end of expression with valid operator sequence
      expect(() => tokenize('2 + ', logger)).toThrow('Unary operator + missing operand');
      expect(() => tokenize('2 * ', logger)).toThrow('Operator * missing operand');
      // Test operator followed by non-operator token
      const tokens = tokenize('2 + "foo"', logger);
      expect(tokens).toEqual([
        { type: 'number', value: '2', raw: '2' },
        { type: 'operator', value: '+', raw: '+' },
        { type: 'string', value: 'foo', raw: 'foo"' },
      ]);
    });
    it('handles operators with too many operands', () => {
      expect(() => tokenize('2 ++ 4', logger)).toThrow(TokenizerError);
      expect(() => tokenize('2 ** 4', logger)).toThrow(TokenizerError);
      expect(() => tokenize('2 <> 4', logger)).toThrow(TokenizerError);
      expect(() => tokenize('2 >> 4', logger)).toThrow(TokenizerError);
      expect(() => tokenize('2 << 4', logger)).toThrow(TokenizerError);
    });
  });

  describe('error handling', () => {
    it('throws error for invalid characters in identifiers', () => {
      // Test various invalid characters that aren't in [a-zA-Z0-9_$.] and aren't operators/punctuation
      expect(() => tokenize('abc~def', logger)).toThrow(TokenizerError);
      expect(() => tokenize('abc~def', logger)).toThrow('Invalid character in identifier: ~');

      expect(() => tokenize('abc@def', logger)).toThrow(TokenizerError);
      expect(() => tokenize('abc@def', logger)).toThrow('Invalid character in identifier: @');

      expect(() => tokenize('abc`def', logger)).toThrow(TokenizerError);
      expect(() => tokenize('abc`def', logger)).toThrow('Invalid character in identifier: `');
    });
  });

  describe('spread operator validation', () => {
    it('throws when spreading primitive literals', () => {
      // Test spreading number literals
      expect(() => tokenize('[1, 2, ...42]', logger)).toThrow(TokenizerError);
      expect(() => tokenize('[1, 2, ...42]', logger)).toThrow(
        'Invalid spread operator usage: cannot spread number literal',
      );

      // Test spreading string literals
      expect(() => tokenize('[1, 2, ..."foo"]', logger)).toThrow(TokenizerError);
      expect(() => tokenize('[1, 2, ..."foo"]', logger)).toThrow(
        'Invalid spread operator usage: cannot spread string literal',
      );

      // Test spreading boolean literals
      expect(() => tokenize('[1, 2, ...true]', logger)).toThrow(TokenizerError);
      expect(() => tokenize('[1, 2, ...true]', logger)).toThrow(
        'Invalid spread operator usage: cannot spread boolean literal',
      );

      // Test spreading null/undefined
      expect(() => tokenize('[1, 2, ...null]', logger)).toThrow(TokenizerError);
      expect(() => tokenize('[1, 2, ...null]', logger)).toThrow(
        'Invalid spread operator usage: cannot spread null',
      );
      expect(() => tokenize('[1, 2, ...undefined]', logger)).toThrow(TokenizerError);
      expect(() => tokenize('[1, 2, ...undefined]', logger)).toThrow(
        'Invalid spread operator usage: cannot spread undefined',
      );
    });

    it('allows spreading references and expressions', () => {
      // References should be allowed as they might resolve to arrays/objects
      expect(() => tokenize('[1, 2, ...${foo}]', logger)).not.toThrow();
      expect(() => tokenize('[1, 2, ...${foo.bar}]', logger)).not.toThrow();

      // Array/object literals should be allowed
      expect(() => tokenize('[1, 2, ...[3, 4]]', logger)).not.toThrow();
      expect(() => tokenize('[1, 2, ...{a: 1}]', logger)).not.toThrow();
    });
  });

  describe('operator sequences', () => {
    it('handles operator sequences', () => {
      // Test invalid operator sequences
      expect(() => tokenize('2 ++ 4', logger)).toThrow('Invalid operator sequence: ++');
      expect(() => tokenize('2 ** 4', logger)).toThrow('Invalid operator sequence: **');
      expect(() => tokenize('2 <> 4', logger)).toThrow('Invalid operator sequence: <>');
      expect(() => tokenize('2 >> 4', logger)).toThrow('Invalid operator sequence: >>');
      expect(() => tokenize('2 << 4', logger)).toThrow('Invalid operator sequence: <<');

      // Test invalid operator sequence at end of expression (nextToken will be null)
      expect(() => tokenize('2 ++', logger)).toThrow('Invalid operator sequence: ++');
      expect(() => tokenize('2 **', logger)).toThrow('Invalid operator sequence: **');
      expect(() => tokenize('2 >>', logger)).toThrow('Invalid operator sequence: >>');
      expect(() => tokenize('2 <<', logger)).toThrow('Invalid operator sequence: <<');
      expect(() => tokenize('2 <>', logger)).toThrow('Invalid operator sequence: <>');

      // Test operator at end of expression (nextToken will be null)
      expect(() => tokenize('2 +', logger)).toThrow('Unary operator + missing operand');
      expect(() => tokenize('2 *', logger)).toThrow('Operator * missing operand');
    });

    it('handles operator sequences with braces', () => {
      // Test operator sequences inside braces
      expect(tokenize('{ a + b }', logger)).toEqual([
        { type: 'punctuation', value: '{', raw: '{' },
        { type: 'identifier', value: 'a', raw: 'a' },
        { type: 'operator', value: '+', raw: '+' },
        { type: 'identifier', value: 'b', raw: 'b' },
        { type: 'punctuation', value: '}', raw: '}' },
      ]);

      // Test invalid operator sequences inside braces
      expect(() => tokenize('{ a ++ b }', logger)).toThrow('Invalid operator sequence: ++');
      expect(() => tokenize('{ a ** b }', logger)).toThrow('Invalid operator sequence: **');

      // Test operator at end of expression inside braces
      expect(() => tokenize('{ a + }', logger)).toThrow(
        'Unmatched closing parenthesis/brace/bracket',
      );
      expect(() => tokenize('{ a * }', logger)).toThrow(
        'Unmatched closing parenthesis/brace/bracket',
      );
    });
  });
});
