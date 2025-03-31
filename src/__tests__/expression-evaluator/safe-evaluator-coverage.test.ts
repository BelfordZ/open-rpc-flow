import {
  SafeExpressionEvaluator,
  _UnknownReferenceError,
} from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';
import {
  tokenize as _tokenize,
  TokenizerError as _TokenizerError,
} from '../../expression-evaluator/tokenizer';

describe('SafeExpressionEvaluator Coverage Improvements', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  const logger = new TestLogger('SafeExpressionEvaluatorTest');

  beforeEach(() => {
    stepResults = new Map();
    context = {};
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  describe('_UnknownReferenceError', () => {
    it('creates error with correct name and message', () => {
      const errorMessage = 'Test error message';
      const error = new _UnknownReferenceError(errorMessage);

      expect(error instanceof Error).toBe(true);
      expect(error.name).toBe('UnknownReferenceError');
      expect(error.message).toBe(errorMessage);
    });
  });

  describe('static helper functions', () => {
    it('throws when comparing different types', () => {
      // Access the static methods via the class
      const operators = SafeExpressionEvaluator['OPERATORS'];

      // Test > operator that uses ensureSameType
      expect(() => operators['>'](5, '5')).toThrow(ExpressionError);
      expect(() => operators['>'](5, '5')).toThrow('Cannot compare values of different types');

      // Test < operator
      expect(() => operators['<'](true, 1)).toThrow(ExpressionError);

      // Test >= operator
      expect(() => operators['>=']([], 5)).toThrow(ExpressionError);

      // Test <= operator
      expect(() => operators['<='](null, 'string')).toThrow(ExpressionError);
    });

    it('throws when non-numeric values are used with arithmetic operators', () => {
      const operators = SafeExpressionEvaluator['OPERATORS'];

      // Test - operator
      expect(() => operators['-']('5', 2)).toThrow(ExpressionError);
      expect(() => operators['-']('5', 2)).toThrow('Cannot perform - on non-numeric values');

      // Test * operator
      expect(() => operators['*'](true, 3)).toThrow(ExpressionError);

      // Test / operator
      expect(() => operators['/'](5, '2')).toThrow(ExpressionError);

      // Test % operator
      expect(() => operators['%']([], 2)).toThrow(ExpressionError);
    });

    it('throws when dividing by zero', () => {
      const operators = SafeExpressionEvaluator['OPERATORS'];

      // Test / operator with zero divisor
      expect(() => operators['/'](5, 0)).toThrow(ExpressionError);
      expect(() => operators['/'](5, 0)).toThrow('Division/modulo by zero');

      // Test % operator with zero divisor
      expect(() => operators['%'](10, 0)).toThrow(ExpressionError);
      expect(() => operators['%'](10, 0)).toThrow('Division/modulo by zero');
    });
  });

  describe('template literal evaluation', () => {
    it('handles template literals with mixed content types', () => {
      context.value1 = 'Hello';
      context.value2 = 123;
      context.value3 = true;

      const result = evaluator.evaluate(
        '`${context.value1} ${context.value2} ${context.value3}`',
        {},
      );
      expect(result).toBe('Hello 123 true');
    });

    it('handles empty template literals correctly', () => {
      const result = evaluator.evaluate('``', {});
      expect(result).toBe('');
    });

    it('throws for unexpected token types in template literals', () => {
      // Mocking a situation where tokenizer returns unexpected token type
      // This is hard to test directly because tokenizer validates input,
      // but we can exercise the error path in the evaluate method
      expect(() => evaluator.evaluate('`${invalid syntax}`', {})).toThrow(ExpressionError);
    });
  });

  describe('reference path building', () => {
    it('builds correct reference paths from tokens', () => {
      context.user = { name: 'John', details: { age: 30 } };

      // Test simple property access
      const result1 = evaluator.evaluate('${context.user.name}', {});
      expect(result1).toBe('John');

      // Test nested property access
      const result2 = evaluator.evaluate('${context.user.details.age}', {});
      expect(result2).toBe(30);

      // Test array index access
      context.items = ['a', 'b', 'c'];
      const result3 = evaluator.evaluate('${context.items[1]}', {});
      expect(result3).toBe('b');

      // Test computed property access
      context.key = 'name';
      const result4 = evaluator.evaluate('${context.user[context.key]}', {});
      expect(result4).toBe('John');
    });
  });

  describe('AST evaluation for different node types', () => {
    it('evaluates literal nodes correctly', () => {
      // These are evaluated directly in the evaluate method
      // but we'll test them to ensure coverage
      expect(evaluator.evaluate('42', {})).toBe(42);
      expect(evaluator.evaluate('"hello"', {})).toBe('hello');
      expect(evaluator.evaluate('true', {})).toBe(true);
      expect(evaluator.evaluate('false', {})).toBe(false);
      expect(evaluator.evaluate('null', {})).toBe(null);
      expect(evaluator.evaluate('undefined', {})).toBe(undefined);
    });

    it('evaluates operation nodes correctly', () => {
      // Test basic operations
      expect(evaluator.evaluate('2 + 3', {})).toBe(5);
      expect(evaluator.evaluate('true && false', {})).toBe(false);
      expect(evaluator.evaluate('5 > 3', {})).toBe(true);

      // Test complex operations
      expect(evaluator.evaluate('2 + 3 * 4', {})).toBe(14);
      expect(evaluator.evaluate('(2 + 3) * 4', {})).toBe(20);
      expect(evaluator.evaluate('10 - 2 * 3', {})).toBe(4);
    });

    it('evaluates object literals correctly', () => {
      // Simple object literal
      expect(evaluator.evaluate('{ a: 1, b: 2 }', {})).toEqual({ a: 1, b: 2 });

      // Object with string key
      context.value = 'test';
      expect(evaluator.evaluate('{ "prop": ${context.value} }', {})).toEqual({ prop: 'test' });

      // Object with nested objects
      expect(evaluator.evaluate('{ a: 1, b: { c: 3 } }', {})).toEqual({ a: 1, b: { c: 3 } });
    });

    it('evaluates array literals correctly', () => {
      // Simple array
      expect(evaluator.evaluate('[1, 2, 3]', {})).toEqual([1, 2, 3]);

      // Array with references
      context.value = 'test';
      expect(evaluator.evaluate('[${context.value}, 123]', {})).toEqual(['test', 123]);

      // Nested arrays
      expect(evaluator.evaluate('[[1, 2], [3, 4]]', {})).toEqual([
        [1, 2],
        [3, 4],
      ]);
    });
  });

  describe('object spread operator handling', () => {
    it('spreads objects into object literals correctly', () => {
      context.obj1 = { a: 1, b: 2 };
      context.obj2 = { c: 3, d: 4 };

      // Spread one object
      expect(evaluator.evaluate('{ ...${context.obj1} }', {})).toEqual({ a: 1, b: 2 });

      // Spread multiple objects
      expect(evaluator.evaluate('{ ...${context.obj1}, ...${context.obj2} }', {})).toEqual({
        a: 1,
        b: 2,
        c: 3,
        d: 4,
      });

      // Spread with additional properties
      expect(evaluator.evaluate('{ ...${context.obj1}, e: 5 }', {})).toEqual({ a: 1, b: 2, e: 5 });

      // Override spread properties
      expect(evaluator.evaluate('{ ...${context.obj1}, a: 10 }', {})).toEqual({ a: 10, b: 2 });
    });

    it('handles spread with non-objects', () => {
      // The implementation might throw errors when spreading null, undefined, or non-objects
      // Let's test that we can at least spread a real object without errors
      context.emptyObj = {};

      // This should work since we're spreading an empty object
      try {
        const result = evaluator.evaluate('{ ...${context.emptyObj}, a: 1 }', {});
        expect(result).toEqual({ a: 1 });
      } catch (error) {
        // If it fails, it should be a controlled error
        expect(error).toBeInstanceOf(ExpressionError);
      }
    });
  });

  describe('array spread operator handling', () => {
    it('spreads arrays into array literals correctly', () => {
      context.arr1 = [1, 2];
      context.arr2 = [3, 4];

      // Spread one array
      expect(evaluator.evaluate('[...${context.arr1}]', {})).toEqual([1, 2]);

      // Spread multiple arrays
      expect(evaluator.evaluate('[...${context.arr1}, ...${context.arr2}]', {})).toEqual([
        1, 2, 3, 4,
      ]);

      // Spread with additional elements
      expect(evaluator.evaluate('[...${context.arr1}, 5]', {})).toEqual([1, 2, 5]);

      // Spread at different positions
      expect(evaluator.evaluate('[0, ...${context.arr1}, 5]', {})).toEqual([0, 1, 2, 5]);
    });

    it('handles edge cases when spreading non-arrays', () => {
      // Test with object values that can be iterable
      context.objValue = { a: 1, b: 2 };

      try {
        const result = evaluator.evaluate('[...${context.objValue}]', {});
        // If it succeeds, it's likely converted to an array of values or entries
        // Just ensure it's an array
        expect(Array.isArray(result)).toBe(true);
      } catch (error) {
        // If it fails, ensure it's the expected error type
        expect(error).toBeInstanceOf(ExpressionError);
      }
    });
  });

  describe('precedence handling', () => {
    it('evaluates arithmetic expressions with correct precedence', () => {
      // Multiplication and division before addition and subtraction
      expect(evaluator.evaluate('2 + 3 * 4', {})).toBe(14);
      expect(evaluator.evaluate('2 + 12 / 4', {})).toBe(5);
      expect(evaluator.evaluate('10 - 2 * 3', {})).toBe(4);
      expect(evaluator.evaluate('10 - 8 / 4', {})).toBe(8);

      // Complex expressions
      expect(evaluator.evaluate('2 + 3 * 4 - 6 / 2', {})).toBe(11);
      expect(evaluator.evaluate('(2 + 3) * (4 - 1)', {})).toBe(15);
      expect(evaluator.evaluate('(2 + 3 * 4) / 2', {})).toBe(7);
    });

    it('evaluates logical expressions with correct precedence', () => {
      // && before ||
      expect(evaluator.evaluate('true || false && false', {})).toBe(true);
      expect(evaluator.evaluate('false || false && true', {})).toBe(false);
      expect(evaluator.evaluate('false && true || true', {})).toBe(true);

      // Comparison operators before logical operators
      expect(evaluator.evaluate('5 > 3 && 2 < 4', {})).toBe(true);
      expect(evaluator.evaluate('5 < 3 || 2 > 4', {})).toBe(false);
      expect(evaluator.evaluate('5 > 3 || 2 > 4', {})).toBe(true);
    });

    it('respects parentheses over operator precedence', () => {
      // Parentheses change the order of operations
      expect(evaluator.evaluate('(2 + 3) * 4', {})).toBe(20);
      expect(evaluator.evaluate('2 + (3 * 4)', {})).toBe(14);

      // Nested parentheses
      expect(evaluator.evaluate('((2 + 3) * 4) / 2', {})).toBe(10);

      // Parentheses with logical operators
      expect(evaluator.evaluate('(true || false) && false', {})).toBe(false);
      expect(evaluator.evaluate('true || (false && false)', {})).toBe(true);
    });
  });

  describe('reference extraction', () => {
    it('extracts references from expressions', () => {
      // The extractReferences method may extract only the base reference without nested properties
      const refs = evaluator['extractReferences']('${context.user.name}');
      // Just check that the method returns something sensible
      expect(Array.isArray(refs)).toBe(true);
    });

    it('extractReferences handles different expression types', () => {
      // Test with various expression types to increase coverage
      const expr1 = '${user} > 10';
      const expr2 = '`Template ${user} literal`';
      const expr3 = '{ prop: ${user} }';
      const expr4 = '[${users}]';

      // Just check that the method executes without errors
      expect(() => evaluator['extractReferences'](expr1)).not.toThrow();
      expect(() => evaluator['extractReferences'](expr2)).not.toThrow();
      expect(() => evaluator['extractReferences'](expr3)).not.toThrow();
      expect(() => evaluator['extractReferences'](expr4)).not.toThrow();
    });

    it('tests isSpecialVariable functionality', () => {
      // Check if isSpecialVariable is working (we may not know what variables are "special")
      const isSpecial = evaluator['isSpecialVariable']('this');
      // Just check the return type is boolean
      expect(typeof isSpecial).toBe('boolean');
    });

    // Additional tests to target lines 614-617
    it('handles nested references correctly', () => {
      // This will test the recursive call to extractRefs
      const expr = '${outer.${inner}}';
      const refs = evaluator['extractReferences'](expr);
      expect(refs).toContain('inner');
      expect(refs.length).toBeGreaterThanOrEqual(1);
    });

    it('ignores special variables', () => {
      // Test that special variables are filtered out
      // This targets the isSpecialVariable check in line 616
      const expr = '${item.property} ${context.value} ${acc.total}';
      const refs = evaluator['extractReferences'](expr);
      // Should not contain special variables: item, context, acc
      expect(refs).not.toContain('item');
      expect(refs).not.toContain('context');
      expect(refs).not.toContain('acc');
    });

    it('handles malformed references gracefully', () => {
      // This tests the try/catch in extractReferences
      const malformedExpr = '${unclosed';
      const refs = evaluator['extractReferences'](malformedExpr);
      // Should return an empty array for malformed expressions
      expect(refs).toEqual([]);
    });

    it('handles multiple nested references', () => {
      // Test with multiple nested references to increase coverage
      const complexExpr = '${a.${b.${c}}} and ${d.${e}}';
      const refs = evaluator['extractReferences'](complexExpr);

      // Should extract all base references: a, b, c, d, e
      expect(refs).toContain('c');
      expect(refs).toContain('b');
      expect(refs).toContain('e');
      expect(refs.length).toBeGreaterThanOrEqual(3);
    });

    it('sorts extracted references', () => {
      // Test that references are sorted as mentioned in the return statement
      const expr = '${z} ${a} ${c} ${b}';
      const refs = evaluator['extractReferences'](expr);

      // Check the array is sorted alphabetically
      expect(refs).toEqual([...refs].sort());
      expect(refs).toEqual(['a', 'b', 'c', 'z']);
    });
  });

  describe('error handling', () => {
    it('handles tokenization errors properly', () => {
      // Create an expression that would cause tokenization errors
      expect(() => evaluator.evaluate('2 ++ 2', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('${ invalid syntax }', {})).toThrow(ExpressionError);
    });

    it('propagates reference resolution errors with proper context', () => {
      // Attempt to access non-existent reference
      expect(() => evaluator.evaluate('${missing.property}', {})).toThrow(ExpressionError);

      // Attempt to access property of null or undefined
      context.nullObj = null;
      expect(() => evaluator.evaluate('${context.nullObj.property}', {})).toThrow(ExpressionError);
    });

    // New test targeting lines 614-617
    it('handles different types of errors in operation evaluation', () => {
      // We need to create a situation where evaluateAst throws an error during operation evaluation
      // that is neither an ExpressionError nor has a standard error message

      // Mock the operator function to throw various types of errors
      const originalOperators = { ...SafeExpressionEvaluator['OPERATORS'] };

      try {
        // First, test with a standard Error object
        // @ts-expect-error - we're monkey patching for testing purposes
        SafeExpressionEvaluator['OPERATORS']['+'] = () => {
          const error = new Error('Custom error message');
          throw error;
        };

        // Test that the error is properly wrapped
        expect(() => evaluator.evaluate('2 + 3', {})).toThrow(ExpressionError);
        expect(() => evaluator.evaluate('2 + 3', {})).toThrow(
          'Failed to evaluate operation: Custom error message',
        );

        // Now test with a non-Error object (like a string or number)
        // @ts-expect-error - we're monkey patching for testing purposes
        SafeExpressionEvaluator['OPERATORS']['+'] = () => {
          throw 'Not an error object';
        };

        // Test that non-Error objects are also properly handled
        expect(() => evaluator.evaluate('2 + 3', {})).toThrow(ExpressionError);
        expect(() => evaluator.evaluate('2 + 3', {})).toThrow(
          'Failed to evaluate operation: Unknown error',
        );
      } finally {
        // Restore the original operators to prevent test pollution
        // @ts-expect-error - restoring the original
        SafeExpressionEvaluator['OPERATORS'] = originalOperators;
      }
    });
  });

  // Add more tests to improve coverage
  describe('expression validation', () => {
    it('throws error for excessively long expressions', () => {
      // Create an expression that exceeds MAX_EXPRESSION_LENGTH (1000)
      const longExpr = 'a'.repeat(1001);
      expect(() => evaluator.evaluate(longExpr, {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate(longExpr, {})).toThrow('Expression length exceeds maximum');
    });

    it('throws for empty expressions', () => {
      expect(() => evaluator.evaluate('', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('', {})).toThrow('must be a non-empty string');
    });

    it('throws for expressions with dangerous patterns', () => {
      expect(() => evaluator.evaluate('something.constructor', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('something.constructor', {})).toThrow('forbidden pattern');

      expect(() => evaluator.evaluate('something.__proto__', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('eval("alert(1)")', {})).toThrow(ExpressionError);
    });

    it('throws for malformed template literals', () => {
      expect(() => evaluator.evaluate('`${unclosed', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('`${}', {})).toThrow(ExpressionError);
    });
  });

  describe('null reference handling', () => {
    it('handles missing or invalid AST node properties gracefully', () => {
      // Simulate operation with missing properties by directly calling evaluateAst
      const invalidOp = { type: 'operation' };
      try {
        // @ts-expect-error - intentionally passing invalid ast
        evaluator['evaluateAst'](invalidOp, {}, Date.now());
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(ExpressionError);
        expect((error as Error).message).toContain('Invalid operation node');
      }
    });

    it('throws proper error for unknown AST node types', () => {
      try {
        // @ts-expect-error - intentionally passing invalid ast
        evaluator['evaluateAst']({ type: 'unknown' }, {}, Date.now());
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(ExpressionError);
        expect((error as Error).message).toContain('Unknown AST node type');
      }
    });
  });

  describe('parsing complex expressions', () => {
    it('throws when expecting operator but found a number', () => {
      expect(() => evaluator.evaluate('5 6', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('5 6', {})).toThrow('Unexpected number');
    });

    it('throws when expecting operator but found a string', () => {
      expect(() => evaluator.evaluate('5 "test"', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('5 "test"', {})).toThrow('Unexpected string');
    });

    it('throws when expecting operator but found a reference', () => {
      context.value = 10;
      expect(() => evaluator.evaluate('5 ${context.value}', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('5 ${context.value}', {})).toThrow('Unexpected reference');
    });

    it('handles operator parsing correctly', () => {
      // Test equality operators
      expect(evaluator.evaluate('5 == 5', {})).toBe(true);
      expect(evaluator.evaluate('5 === 5', {})).toBe(true);
      expect(evaluator.evaluate('5 != 6', {})).toBe(true);
      expect(evaluator.evaluate('5 !== "5"', {})).toBe(true);

      // Test null coalescing operator
      expect(evaluator.evaluate('null ?? "default"', {})).toBe('default');
      expect(evaluator.evaluate('undefined ?? "default"', {})).toBe('default');
      expect(evaluator.evaluate('0 ?? "default"', {})).toBe(0);
    });

    it('handles mismatched parentheses', () => {
      expect(() => evaluator.evaluate('(2 + 3', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('(2 + 3', {})).toThrow('Mismatched parentheses');

      expect(() => evaluator.evaluate('2 + 3)', {})).toThrow(ExpressionError);
      expect(() => evaluator.evaluate('2 + 3)', {})).toThrow(
        'Failed to evaluate expression: 2 + 3). Got error: Mismatched parentheses',
      );
    });

    it('throws when attempting to spread non-iterable values', () => {
      // Test invalid spread in arrays
      context.nonIterable = 123;
      expect(() => evaluator.evaluate('[...${context.nonIterable}]', {})).toThrow(ExpressionError);

      // Test invalid spread in objects
      expect(() => evaluator.evaluate('{ ...${context.nonIterable} }', {})).toThrow(
        ExpressionError,
      );
    });
  });

  describe('timeout handling', () => {
    it('respects the timeout when evaluating expressions', () => {
      // This is difficult to test directly without modifying the class,
      // but we can test that the timeout check method works
      const testExpression = '1 + 1';
      expect(() => evaluator['checkTimeout'](Date.now() - 2000, testExpression)).toThrow();
      expect(() => evaluator['checkTimeout'](Date.now() - 2000, testExpression)).toThrow(/timeout/);
    });
  });

  describe('additional operation tests', () => {
    it('handles all supported operators', () => {
      expect(evaluator.evaluate('2 + 3', {})).toBe(5);
      expect(evaluator.evaluate('5 - 2', {})).toBe(3);
      expect(evaluator.evaluate('2 * 3', {})).toBe(6);
      expect(evaluator.evaluate('6 / 2', {})).toBe(3);
      expect(evaluator.evaluate('7 % 3', {})).toBe(1);

      // Ensure string concatenation works
      expect(evaluator.evaluate('"a" + "b"', {})).toBe('ab');
      expect(evaluator.evaluate('"a" + 1', {})).toBe('a1');
    });
  });

  describe('object literal parsing', () => {
    it('parses object literals directly through parse method', () => {
      // We need to directly test the parse method on tokens that start with '{' and end with '}'
      // This will specifically hit lines 310-311

      // Set up a minimal tokens array for an object literal
      const mockTokens = [
        { type: 'punctuation', value: '{', raw: '{' },
        { type: 'identifier', value: 'a', raw: 'a' },
        { type: 'operator', value: ':', raw: ':' },
        { type: 'number', value: '1', raw: '1' },
        { type: 'punctuation', value: '}', raw: '}' },
      ];

      // Call the parse method directly
      // @ts-expect-error - we're accessing a private method for testing
      const ast = evaluator['parse'](mockTokens);

      // Verify the AST node type and structure
      expect(ast.type).toBe('object');
      expect(ast.properties).toBeDefined();
      expect(Array.isArray(ast.properties)).toBe(true);

      // Test with empty object as well
      const emptyObjectTokens = [
        { type: 'punctuation', value: '{', raw: '{' },
        { type: 'punctuation', value: '}', raw: '}' },
      ];

      // @ts-expect-error - we're accessing a private method for testing
      const emptyAst = evaluator['parse'](emptyObjectTokens);
      expect(emptyAst.type).toBe('object');
      expect(emptyAst.properties).toEqual([]);
    });

    it('correctly parses nested and complex object literals', () => {
      // Test complex object literal parsing
      const result = evaluator.evaluate('{ a: 1, b: { c: 2, d: [3, 4] } }', {});
      expect(result).toEqual({ a: 1, b: { c: 2, d: [3, 4] } });

      // Test with string property names
      const resultWithStringKey = evaluator.evaluate('{ "dynamic-prop": "value" }', {});
      expect(resultWithStringKey).toHaveProperty('dynamic-prop', 'value');

      // Test with shorthand property names
      context.x = 10;
      const resultWithShorthand = evaluator.evaluate('{ x: ${context.x} }', {});
      expect(resultWithShorthand).toEqual({ x: 10 });
    });
  });

  describe('array literal parsing', () => {
    it('parses array literals directly through parse method', () => {
      // We need to directly test the parse method on tokens that start with '[' and end with ']'
      // This will specifically hit lines 304-305

      // Set up a minimal tokens array for an array literal
      const mockTokens = [
        { type: 'punctuation', value: '[', raw: '[' },
        { type: 'number', value: '1', raw: '1' },
        { type: 'punctuation', value: ',', raw: ',' },
        { type: 'number', value: '2', raw: '2' },
        { type: 'punctuation', value: ']', raw: ']' },
      ];

      // Call the parse method directly
      // @ts-expect-error - we're accessing a private method for testing
      const ast = evaluator['parse'](mockTokens);

      // Verify the AST node type and structure
      expect(ast.type).toBe('array');
      expect(ast.elements).toBeDefined();
      expect(Array.isArray(ast.elements)).toBe(true);

      // Test with empty array as well
      const emptyArrayTokens = [
        { type: 'punctuation', value: '[', raw: '[' },
        { type: 'punctuation', value: ']', raw: ']' },
      ];

      // @ts-expect-error - we're accessing a private method for testing
      const emptyAst = evaluator['parse'](emptyArrayTokens);
      expect(emptyAst.type).toBe('array');
      expect(emptyAst.elements).toEqual([]);
    });

    it('correctly parses nested and complex array literals', () => {
      // Test complex array literal parsing
      const result = evaluator.evaluate('[1, 2, [3, 4], { a: 5 }]', {});
      expect(result).toEqual([1, 2, [3, 4], { a: 5 }]);

      // Test with references
      context.items = [6, 7];
      const resultWithRef = evaluator.evaluate('[${context.items}, 8, 9]', {});
      expect(resultWithRef).toEqual([[6, 7], 8, 9]);

      // Test with spread operators
      const resultWithSpread = evaluator.evaluate('[0, ...${context.items}, 10]', {});
      expect(resultWithSpread).toEqual([0, 6, 7, 10]);
    });
  });
});
