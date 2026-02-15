import { PathAccessor, PathSyntaxError, PropertyAccessError } from '../path-accessor';
import { Logger } from '../util/logger';
import {
  ReferenceResolverError,
  UnknownReferenceError,
  InvalidReferenceError,
  ReferenceResolutionError,
  CircularReferenceError,
} from './errors';

export class ReferenceResolver {
  private logger: Logger;
  private resolvingPaths: string[] = []; // Use an array to preserve the order of references

  constructor(
    private stepResults: Map<string, any>,
    private context: Record<string, any>,
    logger: Logger,
  ) {
    this.logger = logger.createNested('ReferenceResolver');
    this.logger.debug('Initialized with context keys:', Object.keys(this.context));
  }

  private checkForCircularReference(path: string): void {
    if (this.resolvingPaths.includes(path)) {
      const referencePath = [...this.resolvingPaths, path];
      this.logger.error('Circular reference detected:', referencePath);
      throw new CircularReferenceError(
        `Circular reference detected: ${referencePath.join(' -> ')}`,
        referencePath,
      );
    }
  }

  /**
   * Extracts references from a string like "I like ${foo} and ${bar}" and returns ["${foo}", "${bar}"]
   */
  resolveReferencesFromString(str: string): string[] {
    const regex = /\${([^}]+)}/g;
    const matches = str.match(regex);
    return matches ?? [];
  }

  private trackResolutionPath<T>(path: string, fn: () => T): T {
    this.resolvingPaths.push(path);
    try {
      return fn();
    } finally {
      this.resolvingPaths.pop();
    }
  }

  private wrapError(error: unknown, path: string): never {
    this.logger.error('Resolution error:', error);

    if (error instanceof ReferenceResolverError || error instanceof PropertyAccessError) {
      throw error;
    }

    if (error instanceof PathSyntaxError) {
      throw new InvalidReferenceError(error.message, path);
    }

    throw new InvalidReferenceError(error instanceof Error ? error.message : String(error), path);
  }

  private handleSimplePathResolution(
    value: any,
    path: string,
    extraContext: Record<string, any>,
  ): any {
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      const refPath = value.slice(2, -1);
      this.checkForCircularReference(refPath);
      value = this.resolveReference(value, extraContext);
    }

    return value;
  }

  /**
   * Resolves a reference string like "${step1.data.value}" to its value
   */
  resolveReference(ref: string, extraContext: Record<string, any> = {}): any {
    this.logger.debug('Resolving reference', { ref });
    if (!ref.startsWith('${') || !ref.endsWith('}')) {
      this.logger.debug('Not a reference pattern, returning as is:', ref);
      return ref;
    }
    const path = ref.slice(2, -1);

    // Check for circular references using new helper method
    this.checkForCircularReference(path);

    try {
      PathAccessor.parsePath(path);

      return this.trackResolutionPath(path, () => {
        const result = this.resolvePath(path, extraContext);
        this.logger.debug('Successfully resolved reference:', { ref, result });
        return result;
      });
    } catch (error) {
      this.wrapError(error, path);
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
        try {
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
        } catch (error) {
          throw new ReferenceResolutionError(
            `Failed to resolve references in string: ${obj}`,
            obj,
            references,
            error instanceof Error ? error : undefined,
          );
        }
      } else {
        return obj;
      }
    }
    if (Array.isArray(obj)) {
      this.logger.debug('Resolving array of length:', obj.length);
      try {
        return obj.map((item) => this.resolveReferences(item, extraContext));
      } catch (error) {
        throw new ReferenceResolutionError(
          `Failed to resolve references in array`,
          'array',
          obj,
          error instanceof Error ? error : undefined,
        );
      }
    }
    if (obj && typeof obj === 'object') {
      this.logger.debug('Resolving object with keys:', Object.keys(obj));
      try {
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = this.resolveReferences(value, extraContext);
        }
        return result;
      } catch (error) {
        throw new ReferenceResolutionError(
          `Failed to resolve references in object`,
          'object',
          obj,
          error instanceof Error ? error : undefined,
        );
      }
    }
    return obj;
  }

  /**
   * Resolves a path like "step1.data.value" or "step1['data']['value']" to its value
   */
  resolvePath(path: string, extraContext: Record<string, any> = {}): any {
    this.logger.debug('Resolving path:', path);

    // For tracking direct calls to resolvePath
    const isDirectCall = !this.resolvingPaths.includes(path);
    if (isDirectCall) {
      this.resolvingPaths.push(path);
    }

    try {
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

      // For simple values that don't need further resolution, we can return directly
      if (path === source) {
        const result = this.handleSimplePathResolution(value, path, extraContext);
        if (isDirectCall) {
          this.resolvingPaths.pop();
        }
        return result;
      }

      const restPath = path.slice(source.length);
      this.logger.debug('Resolving rest of path:', restPath);

      // Simplified getValueForSubPath without redundant error handling
      const getValueForSubPath = (expr: string) => {
        this.checkForCircularReference(expr);
        return this.resolvePath(expr, extraContext);
      };

      // Unify the restPath logic:
      const actualRestPath = restPath.startsWith('.') ? restPath.slice(1) : restPath;
      const result = PathAccessor.get(value, actualRestPath, getValueForSubPath);

      this.logger.debug('Successfully resolved path:', { path, result });

      if (isDirectCall) {
        this.resolvingPaths.pop();
      }
      return result;
    } catch (error) {
      // Remove path from resolving paths in case of error if this was a direct call
      if (isDirectCall) {
        this.resolvingPaths.pop();
      }

      this.wrapError(error, path);
    }
  }

  getStepResults(): Map<string, any> {
    return this.stepResults;
  }
}
