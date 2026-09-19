/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coveragePathIgnorePatterns: [
    'node_modules',
    'src/__tests__/test-utils.ts',
    'src/examples',
    'src/index.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 94.78,
      functions: 98.31,
      lines: 98.76,
      statements: 98.7,
    },
  },
};
