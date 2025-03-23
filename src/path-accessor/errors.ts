// Import the interface for type safety
import { PathSegment } from './types';
import { UnknownReferenceError } from '../reference-resolver/errors';

// Re-export UnknownReferenceError for use in tests
export { UnknownReferenceError };

/**
 * Base class for all path accessor errors
 */
export class PathAccessorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when a path syntax is invalid
 */
export class PathSyntaxError extends PathAccessorError {
  constructor(
    message: string,
    public readonly path: string,
    public readonly position?: number,
  ) {
    super(`Invalid path syntax: ${message}`);
  }
}

/**
 * Error thrown when a property access fails
 */
export class PropertyAccessError extends PathAccessorError {
  constructor(
    message: string,
    public readonly path: string,
    public readonly segment: PathSegment,
    public readonly target: any,
  ) {
    super(message);
  }
}

/**
 * Error thrown when a path is empty or invalid
 */
export class InvalidPathError extends PathAccessorError {
  constructor(
    message: string,
    public readonly path: string,
  ) {
    super(message);
  }
} 