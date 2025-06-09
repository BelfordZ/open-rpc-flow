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
      branches: 93.16,
      functions: 96.59,
      lines: 98.35,
      statements: 98.24,
    },
  },
};
