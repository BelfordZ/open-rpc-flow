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
      branches: 95.57,
      functions: 98.43,
      lines: 98.93,
      statements: 98.88,
    },
  },
};
