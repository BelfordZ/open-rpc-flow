/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coveragePathIgnorePatterns: ['node_modules', 'src/__tests__/test-utils.ts', 'src/examples'],
  coverageThreshold: {
    global: {
      branches: 92.3,
      functions: 88.71,
      lines: 97.84,
      statements: 97.63,
    },
  },
};
