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
      branches: 97.45,
      functions: 89.75,
      lines: 99.28,
      statements: 99.25,
    },
  },
};
