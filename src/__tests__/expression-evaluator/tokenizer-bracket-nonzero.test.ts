import { tokenize, Token } from '../../expression-evaluator/tokenizer';
import { TestLogger } from '../../util/logger';

/**
 * This test specifically targets lines 657-658 in the tokenizer.ts file:
 *
 * if (bracketCount === 0) {
 *   // ... return token ...
 * }
 * state.currentIndex++;
 * continue;
 *
 * We need to force execution through the else branch where bracketCount is not 0 after
 * encountering a closing bracket, which means we need nested arrays where a closing bracket
 * is encountered but we're still inside another array.
 */
describe('Tokenizer Bracket Continue Statement (lines 657-658)', () => {
  const logger = new TestLogger();

  // These tests are very specifically designed to hit the continue statement after a non-zero bracketCount check
  test('should continue parsing after non-zero bracketCount closing bracket (line 657-658)', () => {
    // We need a nested array where a closing bracket is found but bracketCount is still > 0
    const input = '[1, [2, 3], 4]';
    const result = tokenize(input, logger);

    // Basic validation
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('array_literal');

    // Get the outer array contents
    const outerArray = result[0].value as Token[];

    // Find the nested array
    const nestedArrayIndex = outerArray.findIndex((token) => token.type === 'array_literal');
    expect(nestedArrayIndex).not.toBe(-1);

    // This test specifically hits line 657-658 because a closing bracket is encountered
    // when bracketCount is non-zero after decrementing
  });

  // More complex test case to ensure we hit the continue statement
  test('should hit nested bracket continue path with multiple bracket level changes (657-658)', () => {
    const input = '[[[1], 2], 3, [4, [5]]]';
    const result = tokenize(input, logger);

    // Verify the structure is correct
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('array_literal');
    const outerArray = result[0].value as Token[];

    // Verify we have nested arrays
    const nestedArrays = outerArray.filter((token) => token.type === 'array_literal');
    expect(nestedArrays.length).toBeGreaterThan(0);

    // Verify raw property
    expect(result[0].raw).toBe(input);
  });

  // Test with bracket count changes specifically designed to hit line 658
  test('directly targets line 658 with non-zero bracket count', () => {
    const inputs = [
      // Input designed to hit line 658 multiple times
      '[[][][]]', // Close inner arrays but remain in outer

      // More complex cases
      '[[[[]]]]', // Multiple nested levels, closing brackets should hit line 658
      '[[][[][]]]', // Adjacent nested arrays

      // Variants with elements
      '[[1][2][3]]',
      '[[][a][b, c]]',
      '[[[]][][]]',
    ];

    for (const input of inputs) {
      const result = tokenize(input, logger);

      // Verify the general structure
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('array_literal');

      // The raw property should match the input
      expect(result[0].raw).toBe(input);
    }
  });

  // Test with a crafted structure specifically to hit line 658 multiple times
  test('multiple iterations through line 658 with advancing bracket count', () => {
    // This input has a structure that should force multiple passes through the bracketCount check
    const input = '[[] [] [[]]]';
    const result = tokenize(input, logger);

    // Verify just the basic structure
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('array_literal');

    // Verify we have the right number of array literals in the outer array
    const outerArray = result[0].value as Token[];
    const arrayLiterals = outerArray.filter((token) => token.type === 'array_literal');
    expect(arrayLiterals.length).toBe(3); // Should have 3 arrays

    // At least one of these arrays should have a nested array
    const hasNestedArray = arrayLiterals.some((token) => {
      const innerArray = token.value as Token[];
      return innerArray.some((t) => t.type === 'array_literal');
    });

    expect(hasNestedArray).toBe(true);
  });
});
