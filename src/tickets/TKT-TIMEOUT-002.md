# TKT-TIMEOUT-002: Define Default Timeout Values

## Description
Define default timeout values for each step type. These values will be used when no explicit timeout is configured at the flow or step level.

## Acceptance Criteria
- Define sensible default timeouts for each step type
- Document rationale for each default value
- Ensure values are configurable for testing

## Proposed Implementation

```typescript
// Default timeout values (ms)
export const DEFAULT_TIMEOUTS = {
  /** Default global timeout (30s) */
  global: 30000,
  
  /** 
   * Default request timeout (30s) 
   * Rationale: Network operations require more time due to external dependencies
   */
  request: 30000,
  
  /**
   * Default transform timeout (10s)
   * Rationale: Data transformations should be relatively quick but may involve
   * complex calculations on large datasets
   */
  transform: 10000,
  
  /**
   * Default condition timeout (5s)
   * Rationale: Condition evaluations are typically simpler than transformations
   */
  condition: 5000,
  
  /**
   * Default loop timeout (60s)
   * Rationale: Loops may process many items and should have longer timeouts
   */
  loop: 60000,
  
  /**
   * Default expression evaluation timeout (1s)
   * Rationale: Single expressions should complete quickly, 1s matches current hardcoded value
   */
  expression: 1000,
};
```

## Dependencies
- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces

## Estimation
1 story point (1-2 hours) 