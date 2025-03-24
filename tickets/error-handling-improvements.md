# Improve Error Handling Framework

## Overview

The current error handling implementation across different step executors has several inconsistencies and limitations that need to be addressed to improve reliability and debuggability.

## Current Issues

1. Inconsistent error handling across different step executors
2. Limited error context and correlation
3. Missing recovery mechanisms
4. Insufficient test coverage for error scenarios

## Proposed Changes

### 1. Error Framework

- [ ] Create base error classes:

  ```typescript
  export class FlowError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly context: Record<string, any>,
      public readonly cause?: Error,
    ) {
      super(message);
      this.name = 'FlowError';
    }
  }

  export class ValidationError extends FlowError {
    constructor(message: string, context: Record<string, any>) {
      super(message, 'VALIDATION_ERROR', context);
    }
  }

  export class ExecutionError extends FlowError {
    constructor(message: string, context: Record<string, any>, cause?: Error) {
      super(message, 'EXECUTION_ERROR', context, cause);
    }
  }

  export class TimeoutError extends FlowError {
    constructor(message: string, context: Record<string, any>) {
      super(message, 'TIMEOUT_ERROR', context);
    }
  }

  export class StateError extends FlowError {
    constructor(message: string, context: Record<string, any>) {
      super(message, 'STATE_ERROR', context);
    }
  }
  ```

- [ ] Define error categories and codes:

  ```typescript
  export enum ErrorCategory {
    VALIDATION = 'VALIDATION',
    EXECUTION = 'EXECUTION',
    TIMEOUT = 'TIMEOUT',
    STATE = 'STATE',
    SYSTEM = 'SYSTEM',
  }

  export enum ErrorCode {
    // Validation errors
    INVALID_INPUT = 'INVALID_INPUT',
    SCHEMA_VALIDATION = 'SCHEMA_VALIDATION',
    TYPE_ERROR = 'TYPE_ERROR',

    // Execution errors
    RUNTIME_ERROR = 'RUNTIME_ERROR',
    NETWORK_ERROR = 'NETWORK_ERROR',
    RESOURCE_ERROR = 'RESOURCE_ERROR',

    // Timeout errors
    OPERATION_TIMEOUT = 'OPERATION_TIMEOUT',
    DEADLINE_EXCEEDED = 'DEADLINE_EXCEEDED',

    // State errors
    INVALID_STATE = 'INVALID_STATE',
    MISSING_DEPENDENCY = 'MISSING_DEPENDENCY',

    // System errors
    INTERNAL_ERROR = 'INTERNAL_ERROR',
    CONFIG_ERROR = 'CONFIG_ERROR',
  }
  ```

### 2. Recovery Mechanisms

- [ ] Add retry mechanism:

  ```typescript
  export interface RetryPolicy {
    maxAttempts: number;
    backoff: {
      initial: number;
      multiplier: number;
      maxDelay: number;
    };
    retryableErrors: ErrorCode[];
  }

  export class RetryableOperation<T> {
    constructor(
      private operation: () => Promise<T>,
      private policy: RetryPolicy,
      private logger: Logger,
    ) {}

    async execute(): Promise<T> {
      let lastError: Error | undefined;
      let attempt = 0;

      while (attempt < this.policy.maxAttempts) {
        try {
          return await this.operation();
        } catch (error) {
          lastError = error;
          if (!this.isRetryable(error)) {
            throw error;
          }

          const delay = this.calculateDelay(attempt);
          this.logger.debug('Retrying operation', {
            attempt,
            delay,
            error: error.message,
          });

          await new Promise((resolve) => setTimeout(resolve, delay));
          attempt++;
        }
      }

      throw new ExecutionError('Max retry attempts exceeded', {
        attempts: attempt,
        lastError,
      });
    }

    private isRetryable(error: Error): boolean {
      return error instanceof FlowError && this.policy.retryableErrors.includes(error.code);
    }

    private calculateDelay(attempt: number): number {
      const delay = this.policy.backoff.initial * Math.pow(this.policy.backoff.multiplier, attempt);
      return Math.min(delay, this.policy.backoff.maxDelay);
    }
  }
  ```

- [ ] Add circuit breaker:

  ```typescript
  export interface CircuitBreakerConfig {
    failureThreshold: number;
    recoveryTime: number;
    monitorWindow: number;
  }

  export class CircuitBreaker {
    private failures: number = 0;
    private lastFailure?: Date;
    private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

    constructor(
      private config: CircuitBreakerConfig,
      private logger: Logger,
    ) {}

    async execute<T>(operation: () => Promise<T>): Promise<T> {
      if (this.isOpen()) {
        throw new StateError('Circuit breaker is open', {
          state: this.state,
          failures: this.failures,
          lastFailure: this.lastFailure,
        });
      }

      try {
        const result = await operation();
        this.recordSuccess();
        return result;
      } catch (error) {
        this.recordFailure();
        throw error;
      }
    }

    private isOpen(): boolean {
      if (this.state === 'OPEN') {
        const now = new Date();
        if (
          this.lastFailure &&
          now.getTime() - this.lastFailure.getTime() > this.config.recoveryTime
        ) {
          this.state = 'HALF_OPEN';
          return false;
        }
        return true;
      }
      return false;
    }

    private recordSuccess(): void {
      if (this.state === 'HALF_OPEN') {
        this.state = 'CLOSED';
        this.failures = 0;
        this.lastFailure = undefined;
      }
    }

    private recordFailure(): void {
      this.failures++;
      this.lastFailure = new Date();

      if (this.failures >= this.config.failureThreshold) {
        this.state = 'OPEN';
      }
    }
  }
  ```

### 3. Enhanced Context

- [ ] Add context collectors:

  ```typescript
  export interface ExecutionContext {
    step: {
      name: string;
      type: string;
      params: Record<string, any>;
    };
    execution: {
      startTime: Date;
      duration?: number;
      attempts: number;
    };
    system: {
      memory: number;
      cpu: number;
      env: string;
    };
  }

  export class ContextCollector {
    async collect(): Promise<ExecutionContext> {
      const memory = process.memoryUsage();
      return {
        step: this.getStepContext(),
        execution: this.getExecutionContext(),
        system: {
          memory: memory.heapUsed,
          cpu: process.cpuUsage().user,
          env: process.env.NODE_ENV || 'unknown',
        },
      };
    }

    private getStepContext(): Record<string, any> {
      // Implementation
    }

    private getExecutionContext(): Record<string, any> {
      // Implementation
    }
  }
  ```

### 4. Testing

- [ ] Add test helpers:

  ```typescript
  export class ErrorTestHelper {
    static async simulateNetworkError(): Promise<void> {
      throw new ExecutionError('Network error', {
        code: ErrorCode.NETWORK_ERROR,
        context: { type: 'network' },
      });
    }

    static async simulateTimeout(): Promise<void> {
      throw new TimeoutError('Operation timed out', {
        code: ErrorCode.OPERATION_TIMEOUT,
        context: { timeout: 5000 },
      });
    }
  }

  export class RecoveryTestHelper {
    static createRetryableOperation<T>(
      results: Array<(() => Promise<T>) | Error>,
    ): () => Promise<T> {
      let attempt = 0;
      return async () => {
        const result = results[attempt];
        attempt++;

        if (result instanceof Error) {
          throw result;
        }
        return result();
      };
    }
  }
  ```

## Implementation Plan

1. Phase 1: Core Framework (3 days)

   - Create error classes
   - Define error codes
   - Add context structure
   - Update RequestStepExecutor

2. Phase 2: Recovery (4 days)

   - Implement RetryableOperation
   - Add CircuitBreaker
   - Update remaining executors
   - Add recovery tests

3. Phase 3: Context & Reporting (3 days)

   - Implement ContextCollector
   - Enhance logging
   - Add metrics
   - Update error reporting

4. Phase 4: Testing & Docs (2 days)
   - Add test helpers
   - Expand test coverage
   - Write documentation
   - Create examples

## Success Criteria

- All errors use standardized format
- Recovery mechanisms handle common failures
- Error reporting provides actionable data
- Test coverage > 90% for error paths

## Dependencies

- None

## Risks

- Breaking changes to error handling interface
- Performance impact of additional error context
- Migration effort for existing code

## Priority

High - This improvement will significantly enhance system reliability and debuggability.
