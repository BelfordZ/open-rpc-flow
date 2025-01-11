import { PathAccessor, PathSyntaxError } from './path-accessor';
import { Logger } from './util/logger';

/**
 * Error thrown when a reference cannot be found in the resolver
 */
export class UnknownReferenceError extends Error {
  constructor(
    message: string,
    public readonly reference: string,
    public readonly availableReferences: string[],
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ReferenceResolver {
  private logger: Logger;

  constructor(
    private stepResults: Map<string, any>,
    private context: Record<string, any>,
    logger: Logger,
  ) {
    this.logger = logger.createNested('ReferenceResolver');
    this.logger.debug('Initialized with context keys:', Object.keys(this.context));
  }

  /**
   * Extracts references from a string like "I like ${foo} and ${bar}" and returns ["${foo}", "${bar}"]
   */
  resolveReferencesFromString(str: string): string[] {
    const regex = /\${([^}]+)}/g;
    const matches = str.match(regex);
    return matches ?? [];
  }

  /**
   * Resolves a reference string like "${step1.data.value}" to its value
   */
  resolveReference(ref: string, extraContext: Record<string, any> = {}): any {
    this.logger.debug('Resolving reference:', ref);
    if (!ref.startsWith('${') || !ref.endsWith('}')) {
      this.logger.debug('Not a reference pattern, returning as is:', ref);
      return ref;
    }
    const path = ref.slice(2, -1);

    try {
      PathAccessor.parsePath(path);
      const result = this.resolvePath(path, extraContext);
      this.logger.debug('Successfully resolved reference:', { ref, result });
      return result;
    } catch (error) {
      this.logger.error('Failed to resolve reference:', ref, error);
      if (error instanceof PathSyntaxError) {
        throw new PathSyntaxError(
          error.message,
          ref,
          error.position ? error.position + 2 : undefined,
        );
      }
      throw error;
    }
  }

  /**
   * Recursively resolves all references in an object or array
   */
  resolveReferences(obj: any, extraContext: Record<string, any> = {}): any {
    this.logger.debug('Resolving references in:', typeof obj);
    if (typeof obj === 'string') {
      const references = this.resolveReferencesFromString(obj);
      if (references.length > 0) {
        // If there is only one reference and it's the same length as the original string,
        // i.e. we have a string like "${foo}" and not a string like "Tom${foo}lery",
        if (references.length === 1 && references[0].length === obj.length) {
          return this.resolveReference(obj, extraContext);
        }

        this.logger.debug('handling string containing references:', references);
        references.forEach((ref) => {
          let resolvedValue = this.resolveReference(ref, extraContext);
          // check if resolvedValue is an object and if so, convert it to a string
          if (typeof resolvedValue === 'object') {
            resolvedValue = JSON.stringify(resolvedValue);
          }
          obj = obj.replace(ref, resolvedValue);
          this.logger.debug(`replaced ${ref} with ${resolvedValue} in ${obj}`);
        });
        return obj;
      } else {
        return obj;
      }
    }
    if (Array.isArray(obj)) {
      this.logger.debug('Resolving array of length:', obj.length);
      return obj.map((item) => this.resolveReferences(item, extraContext));
    }
    if (obj && typeof obj === 'object') {
      this.logger.debug('Resolving object with keys:', Object.keys(obj));
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
    this.logger.debug('Resolving path:', path);
    const source = PathAccessor.getRoot(path);

    let value: any;
    const availableReferences = [
      ...Object.keys(extraContext),
      ...Array.from(this.stepResults.keys()),
      'context',
    ];

    this.logger.debug('Available references:', availableReferences);

    if (Object.prototype.hasOwnProperty.call(extraContext, source)) {
      this.logger.debug('Found in extraContext:', source);
      value = extraContext[source];
    } else if (this.stepResults.has(source)) {
      this.logger.debug('Found in stepResults:', source);
      value = this.stepResults.get(source);
    } else if (source === 'context') {
      this.logger.debug('Using global context');
      value = this.context;
    } else {
      this.logger.warn('Reference not found:', source);
      throw new UnknownReferenceError(
        `Reference '${source}' not found. Available references are: ${availableReferences.join(', ')}`,
        source,
        availableReferences,
      );
    }

    if (path === source) {
      this.logger.debug('No further path resolution needed');
      return value;
    }

    const restPath = path.slice(source.length);
    this.logger.debug('Resolving rest of path:', restPath);

    try {
      let result;
      if (restPath.startsWith('.')) {
        result = PathAccessor.get(value, restPath.slice(1));
      } else {
        result = PathAccessor.get(value, restPath);
      }
      this.logger.debug('Successfully resolved path:', { path, result });
      return result;
    } catch (error) {
      this.logger.error('Failed to resolve path:', path, error);
      if (error instanceof PathSyntaxError) {
        throw new PathSyntaxError(
          error.message,
          path,
          error.position ? error.position + source.length : undefined,
        );
      }
      throw error;
    }
  }

  getStepResults(): Map<string, any> {
    return this.stepResults;
  }
}
