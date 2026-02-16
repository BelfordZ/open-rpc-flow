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
      branches: 93.81,
      functions: 97.39,
      lines: 98.59,
      statements: 98.53,
    },
  },
};
