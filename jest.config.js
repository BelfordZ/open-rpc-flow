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
      branches: 89.95,
      functions: 96.41,
      lines: 93.35,
      statements: 93.52,
    },
  },
};
