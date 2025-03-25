// Export all error-related functionality
export * from './base';  // Contains all error class definitions (FlowError, ValidationError, ExecutionError, TimeoutError, StateError)
export * from './codes';
export * from './recovery';
export * from './circuit-breaker';
export * from './context';

// Note: All error classes are now defined only in './base.ts' to avoid duplication
// This includes: FlowError, ValidationError, ExecutionError, TimeoutError, StateError
// The base.ts implementation is more complete with proper prototype chain handling and stack trace capture
