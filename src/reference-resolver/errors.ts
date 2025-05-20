/**
 * Base class for reference resolver errors
 */
export class ReferenceResolverError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when a reference cannot be found in the resolver
 */
export class UnknownReferenceError extends ReferenceResolverError {
  constructor(
    message: string,
    public readonly reference: string,
    public readonly availableReferences: string[],
  ) {
    super(message);
  }
}

/**
 * Error thrown when a reference has invalid syntax
 */
export class InvalidReferenceError extends ReferenceResolverError {
  constructor(
    message: string,
    public readonly reference: string,
  ) {
    super(message);
  }
}

/**
 * Error thrown when resolving references within complex object structures
 */
export class ReferenceResolutionError extends ReferenceResolverError {
  constructor(
    message: string,
    public readonly path: string,
    public readonly value: unknown,
    cause?: Error,
  ) {
    super(message, cause);
  }
}

/**
 * Error thrown when trying to resolve a circular reference
 */
export class CircularReferenceError extends ReferenceResolverError {
  constructor(
    message: string,
    public readonly references: string[],
  ) {
    super(message);
  }
}
