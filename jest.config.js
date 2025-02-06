/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coveragePathIgnorePatterns: ['node_modules', 'src/__tests__/test-utils.ts'],
  coverageThreshold: {
    global: {
      branches: 89.93,
      functions: 95.33,
      lines: 93.46,
      statements: 93.64,
    },
  },
};
