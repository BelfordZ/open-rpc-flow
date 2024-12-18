import { PathAccessor, PathSyntaxError, PropertyAccessError } from './path-accessor';

/**
 * Error thrown when a reference cannot be found in the resolver
 */
export class UnknownReferenceError extends Error {
  constructor(
    message: string,
    public readonly reference: string,
    public readonly availableReferences: string[]
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ReferenceResolver {
  constructor(
    private stepResults: Map<string, any>,
    private context: Record<string, any>
  ) {}

  /**
   * Resolves a reference string like "${step1.data.value}" to its value
   */
  resolveReference(ref: string, extraContext: Record<string, any> = {}): any {
    if (!ref.startsWith('${') || !ref.endsWith('}')) return ref;
    const path = ref.slice(2, -1);

    try {
      // Validate the path syntax before trying to resolve it
      PathAccessor.parsePath(path);
      return this.resolvePath(path, extraContext);
    } catch (error) {
      if (error instanceof PathSyntaxError) {
        // Rethrow syntax errors with the full reference context
        throw new PathSyntaxError(
          error.message,
          ref,
          error.position ? error.position + 2 : undefined // Adjust position for ${ prefix
        );
      }
      throw error;
    }
  }

  /**
   * Recursively resolves all references in an object or array
   */
  resolveReferences(obj: any, extraContext: Record<string, any> = {}): any {
    if (typeof obj === 'string') {
      return this.resolveReference(obj, extraContext);
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.resolveReferences(item, extraContext));
    }
    if (obj && typeof obj === 'object') {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.resolveReferences(value, extraContext);
      }
      return result;
    }
    return obj;
  }

  /**
   * Resolves a path like "step1.data.value" or "step1['data']['value']" to its value
   */
  resolvePath(path: string, extraContext: Record<string, any> = {}): any {
    // First get the root object (before any dots or brackets)
    const source = PathAccessor.getRoot(path);

    let value: any;
    const availableReferences = [
      ...Object.keys(extraContext),
      ...Array.from(this.stepResults.keys()),
      'context'
    ];

    if (extraContext.hasOwnProperty(source)) {
      value = extraContext[source];
    } else if (this.stepResults.has(source)) {
      value = this.stepResults.get(source);
    } else if (source === 'context') {
      value = this.context;
    } else {
      throw new UnknownReferenceError(
        `Reference '${source}' not found. Available references are: ${availableReferences.join(', ')}`,
        source,
        availableReferences
      );
    }

    // If there's nothing after the root, return the value
    if (path === source) {
      return value;
    }

    // Get the rest of the path after the root
    const restPath = path.slice(source.length);

    try {
      if (restPath.startsWith('.')) {
        // If it starts with a dot, remove it
        return PathAccessor.get(value, restPath.slice(1));
      } else {
        // Otherwise, it must be a bracket notation
        return PathAccessor.get(value, restPath);
      }
    } catch (error) {
      if (error instanceof PathSyntaxError) {
        // Rethrow syntax errors with the full path context
        throw new PathSyntaxError(
          error.message,
          path,
          error.position ? error.position + source.length : undefined
        );
      }
      throw error;
    }
  }

  getStepResults(): Map<string, any> {
    return this.stepResults;
  }
} 