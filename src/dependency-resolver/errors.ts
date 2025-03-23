/**
 * Base class for dependency resolver errors
 */
export class DependencyResolverError extends Error {
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
 * Error thrown when a step is not found in the dependency graph
 */
export class StepNotFoundError extends DependencyResolverError {
  constructor(
    message: string,
    public readonly stepName: string,
    public readonly availableSteps: string[],
  ) {
    super(message);
  }
}

/**
 * Error thrown when a step depends on an unknown step
 */
export class UnknownDependencyError extends DependencyResolverError {
  constructor(
    message: string,
    public readonly dependentStep: string,
    public readonly dependencyStep: string,
    public readonly availableSteps: string[],
  ) {
    super(message);
  }
}

/**
 * Error thrown when a circular dependency is detected in the flow
 */
export class CircularDependencyError extends DependencyResolverError {
  constructor(
    message: string,
    public readonly cycle: string[],
  ) {
    super(message);
  }
}
