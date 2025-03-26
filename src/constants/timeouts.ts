import { TimeoutOptions } from '../types';

/**
 * Default timeout values (in milliseconds) for different step types.
 * These values are used when no explicit timeouts are configured.
 */
export const DEFAULT_TIMEOUTS: TimeoutOptions = {
  /**
   * Default global timeout (30s)
   * Rationale: A reasonable default for most operations
   */
  global: 30000,
  
  /**
   * Default request timeout (30s)
   * Rationale: Network operations require more time due to external dependencies
   * and potential network latency
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
   * Rationale: Single expressions should complete quickly;
   * 1s matches current hardcoded value in SafeExpressionEvaluator
   */
  expression: 1000,
};

/**
 * Absolute minimum allowed timeout value (50ms)
 * Rationale: Any operation taking less than 50ms doesn't need timeout protection,
 * and very small timeouts might cause false positives
 */
export const MIN_TIMEOUT_MS = 50;

/**
 * Absolute maximum allowed timeout value (1 hour)
 * Rationale: Operations taking longer than 1 hour should be redesigned or
 * broken into smaller steps
 */
export const MAX_TIMEOUT_MS = 3600000; 