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
      branches: 93.82,
      functions: 97.02,
      lines: 98.49,
      statements: 98.43,
    },
  },
};
