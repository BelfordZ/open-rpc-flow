// This file serves as an entry point for all error tests
// Each test file focuses on a specific error type to avoid dependency resolution issues

// Import all error test files
import './error-hierarchy.test';
import './validation-error.test';
import './dependency-error.test';
import './expression-error.test';
import './request-error.test';
import './loop-error.test';
import './transform-error.test';
import './condition-error.test';

// This empty test ensures the file is recognized as a test file
describe('Error Tests Index', () => {
  it('should import all error tests', () => {
    expect(true).toBe(true);
  });
}); 