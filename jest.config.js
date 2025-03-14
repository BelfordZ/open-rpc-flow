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
      branches: 4.76,
      functions: 10.87,
      lines: 14.68,
      statements: 15.17,
    },
  },
};
