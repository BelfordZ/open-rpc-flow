# Safe-Evaluator Test Consolidation Plan

After examining the test files, I'll consolidate them in the following groups:

1. **Error Handling Tests**: Combine test files related to error handling
   - `safe-evaluator-line-151.test.ts`
   - `safe-evaluator-line-183.test.ts`
   - `safe-evaluator-reference-error-handling.test.ts`
   - `safe-evaluator-unexpected-reference.test.ts`
   - `safe-evaluator-unexpected-token.test.ts`
   - `safe-evaluator-unexpected-operator.test.ts`
   - `safe-evaluator-unexpected-operator-direct.test.ts`

2. **Operator Tests**: Combine test files related to operators
   - `safe-evaluator-operator-precedence.test.ts`
   - `safe-evaluator-getPrecedence-default.test.ts`
   - `safe-evaluator-unknown-operator.test.ts` (if exists)
   - `safe-evaluator-custom-operator.test.ts` (if exists)

3. **Array and Object Tests**: Combine test files related to arrays and objects
   - `safe-evaluator-array-case-coverage.test.ts`
   - `safe-evaluator-array-elements.test.ts`

4. **Debug Tests**: Keep as references but eventually consolidate
   - `safe-evaluator-debug-operatorstack.test.ts`
   - `safe-evaluator-debug-operatorstack-complex.test.ts`
   - `safe-evaluator-line-516-debug.test.ts`

5. **Line Coverage Tests**: Combine by functional area rather than line numbers
   - Group these based on what part of the safe-evaluator they're testing

## Implementation Strategy
1. Create new consolidated test files
2. Copy tests from original files, preserving test descriptions
3. Update imports and remove duplicate setup code
4. Remove the original test files
5. Verify all tests still pass

## Consolidation Progress
- [x] Error Handling Tests - Created `safe-evaluator-error-handling.test.ts`
- [x] Operator Tests - Created `safe-evaluator-operators.test.ts`
- [x] Array and Object Tests - Created `safe-evaluator-arrays.test.ts`
- [ ] Debug Tests
- [ ] Line Coverage Tests

## Files Created
1. `safe-evaluator-error-handling.test.ts` - Consolidates tests from:
   - `safe-evaluator-line-151.test.ts`
   - `safe-evaluator-line-183.test.ts`
   - `safe-evaluator-reference-error-handling.test.ts`
   - `safe-evaluator-unexpected-operator.test.ts`

2. `safe-evaluator-operators.test.ts` - Consolidates tests from:
   - `safe-evaluator-operator-precedence.test.ts`
   - `safe-evaluator-getPrecedence-default.test.ts`

3. `safe-evaluator-arrays.test.ts` - Consolidates tests from:
   - `safe-evaluator-array-elements.test.ts`
   - `safe-evaluator-array-case-coverage.test.ts`

## Tests Passing
- All tests in `safe-evaluator-error-handling.test.ts` pass - 18 tests
- All tests in `safe-evaluator-operators.test.ts` pass - 9 tests
- All tests in `safe-evaluator-arrays.test.ts` pass - 20 tests
- Total: 47 tests passing in consolidated files

## Code Coverage Comparison
Running just our consolidated test files:
- Statements: 64.45%
- Branches: 54.15%
- Functions: 58.74%
- Lines: 64.31%

Running all the original test files:
- Statements: 81.37%
- Branches: 75.41%
- Functions: 69.93%
- Lines: 81.41%

This means our consolidated tests have captured about 79% of the code coverage of the original test files. To fully match the original coverage, we need to continue consolidating the remaining tests.

## Next Steps
1. Create a consolidated test file for debug-related tests
2. Create one or more consolidated test files for the remaining line coverage tests
3. Run all tests together to verify coverage is maintained
4. Optionally remove the original test files once we've verified everything works 