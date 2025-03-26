# TKT-TIMEOUT-001: Define Timeout Configuration Interfaces

## Description
Create the core TypeScript interfaces for timeout configuration.

## Acceptance Criteria
- Define `TimeoutOptions` interface with properties for global, request, transform, condition, loop and expression timeouts
- Add timeout property to `Step` interface
- Add timeouts property to `Flow` interface
- Add timeoutFallback configuration to `Step` interface 
- Add typings for fallback values and expressions

## Proposed Interface

```typescript
// TimeoutOptions interface
export interface TimeoutOptions {
  /** Global timeout for all steps (ms) */
  global?: number;
  /** Timeout for all request steps (ms) */
  request?: number;
  /** Timeout for all transform steps (ms) */
  transform?: number;
  /** Timeout for all condition steps (ms) */
  condition?: number;
  /** Timeout for all loop steps (ms) */
  loop?: number;
  /** Timeout for expression evaluation (ms) */
  expression?: number;
}

// Extension to Step interface
export interface Step {
  // ...existing properties
  /** Timeout for this specific step (ms) */
  timeout?: number;
  /** Fallback configuration when timeout occurs */
  timeoutFallback?: {
    /** Static fallback value to use */
    value?: any;
    /** Dynamic expression to evaluate for fallback */
    expression?: string;
    /** Whether to continue execution after timeout */
    continueExecution?: boolean;
  };
}

// Extension to Flow interface
export interface Flow {
  // ...existing properties
  /** Timeout configuration for the flow */
  timeouts?: TimeoutOptions;
}
```

## Dependencies
None

## Estimation
1 story point (1-2 hours) 