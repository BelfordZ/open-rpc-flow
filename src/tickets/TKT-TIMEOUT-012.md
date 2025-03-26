# TKT-TIMEOUT-012: Implement TimeoutError Class

## Description
Create a specialized error class for timeout-related errors. This error class will provide detailed information about timeouts that occur during flow execution and will be used by all step executors to report timeout issues consistently.

## Acceptance Criteria
- Implement a TimeoutError class that extends the base Error class
- Include fields for timeout value, elapsed time, step name, and other relevant context
- Support metadata to provide additional context for timeout errors
- Include retryable flag to indicate if the operation can be retried
- Add the TimeoutError to the error code enum
- Export the error class from the appropriate module
- Add unit tests for the TimeoutError class

## Proposed Implementation

```typescript
import { BaseError, ErrorCode, ErrorMetadata } from './error';

/**
 * Interface for TimeoutError metadata
 */
export interface TimeoutErrorMetadata extends ErrorMetadata {
  // Standard error metadata
  code: ErrorCode.TIMEOUT_ERROR;
  stepName: string;
  
  // Timeout specific information
  timeout: number;
  elapsed: number;
  
  // Optional context data
  retryable?: boolean;
  currentIteration?: number;
  completedIterations?: number;
  completedSteps?: number;
  totalSteps?: number;
  childStepName?: string;
  childStepIndex?: number;
  expression?: string;
  requestId?: string;
  partialResults?: any[];
  originalError?: Error;
}

/**
 * Error thrown when an operation exceeds its configured timeout
 */
export class TimeoutError extends BaseError {
  /**
   * Creates a new TimeoutError
   * 
   * @param message Error message
   * @param metadata Additional contextual information about the timeout
   */
  constructor(message: string, metadata: TimeoutErrorMetadata) {
    super(message, metadata);
    
    // Set the error name for easier identification
    this.name = 'TimeoutError';
  }
  
  /**
   * The configured timeout value in milliseconds
   */
  get timeout(): number {
    return (this.metadata as TimeoutErrorMetadata).timeout;
  }
  
  /**
   * The actual elapsed time in milliseconds when the timeout occurred
   */
  get elapsed(): number {
    return (this.metadata as TimeoutErrorMetadata).elapsed;
  }
  
  /**
   * The name of the step where the timeout occurred
   */
  get stepName(): string {
    return (this.metadata as TimeoutErrorMetadata).stepName;
  }
  
  /**
   * Whether the operation is retryable
   */
  get isRetryable(): boolean {
    return Boolean((this.metadata as TimeoutErrorMetadata).retryable);
  }
  
  /**
   * Get any partial results that were collected before the timeout
   */
  get partialResults(): any[] | undefined {
    return (this.metadata as TimeoutErrorMetadata).partialResults;
  }
}

// Update the ErrorCode enum
export enum ErrorCode {
  // Existing error codes
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  EXECUTION_ERROR = 'EXECUTION_ERROR',
  EXPRESSION_ERROR = 'EXPRESSION_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  JSON_RPC_ERROR = 'JSON_RPC_ERROR',
  
  // New timeout error code
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
}
```

## Dependencies
- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces

## Estimation
2 story points (3-5 hours) 