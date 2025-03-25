# Improve test coverage for expression-evaluator tokenizer

## Description

This PR adds new test cases to improve the test coverage for the `tokenizer.ts` file in the expression evaluator module. The coverage has been increased from approximately 87% to over 90%, focusing on previously untested edge cases and error conditions.

## Changes

- Added tests for string literals with various escape sequences
- Added tests for template literals with complex structures and escape sequences
- Added tests for reference handling, including unterminated references and nested references
- Added tests for operator validation, including missing operands
- Added tests for object and array literals with spread operators
- Added tests for object literal detection in various formats

## Coverage Improvement

| Metric     | Before | After | Improvement |
| ---------- | ------ | ----- | ----------- |
| Statements | ~87%   | ~91%  | +4%         |
| Branches   | ~87%   | ~89%  | +2%         |
| Functions  | 100%   | 100%  | 0%          |
| Lines      | ~88%   | ~91%  | +3%         |

## Next Steps

While this PR significantly improves coverage, there are still some edge cases that could be addressed in future PRs. These include:

- Error handling paths for malformed inputs
- Complex nesting of objects and arrays
- More complex template literal scenarios

## Testing

All tests pass with the new coverage improvements. The changes don't modify any of the actual code, just add new tests to verify existing behavior.

```
PASS src/__tests__/expression-evaluator/tokenizer-coverage2.test.ts
PASS src/__tests__/expression-evaluator/tokenizer.test.ts
PASS src/__tests__/expression-evaluator/tokenizer-coverage.test.ts
--------------|---------|----------|---------|---------|-----------------------------------------------------------------------------------------------------
File          | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
--------------|---------|----------|---------|---------|-----------------------------------------------------------------------------------------------------
All files     |   90.59 |    88.76 |     100 |   91.09 |
 tokenizer.ts |   90.59 |    88.76 |     100 |   91.09 | 118-120,127-129,134,222-226,240-241,316-317,433-436,485,559-560,572-576,607-612,626,662-663,721-725
--------------|---------|----------|---------|---------|-----------------------------------------------------------------------------------------------------
```
