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

    // Check for circular references
    if (this.resolvingPaths.includes(path)) {
      const referencePath = [...this.resolvingPaths, path];
      this.logger.error('Circular reference detected:', referencePath);
      throw new CircularReferenceError(
        `Circular reference detected: ${referencePath.join(' -> ')}`,
        referencePath,
      );
    }

    try {
      try {
        PathAccessor.parsePath(path);
      } catch (parseError) {
        if (parseError instanceof PathSyntaxError) {
          throw new InvalidReferenceError(parseError.message, path);
        }
        throw parseError;
      }

      // Add path to the array of resolving paths
      this.resolvingPaths.push(path);

      const result = this.resolvePath(path, extraContext);
      this.logger.debug('Successfully resolved reference:', { ref, result });

      // Remove path from the array of resolving paths
      this.resolvingPaths.pop();

      return result;
    } catch (error) {
      // Remove path from the array of resolving paths in case of error
      this.resolvingPaths.pop();

      this.logger.error('Failed to resolve reference:', ref, error);
      // Re-throw our custom errors and PropertyAccessError as is
      if (error instanceof ReferenceResolverError || error instanceof PropertyAccessError) {
        throw error;
      }
      // Wrap PathSyntaxError in InvalidReferenceError
      if (error instanceof PathSyntaxError) {
        throw new InvalidReferenceError(error.message, path);
      }
      // Wrap other errors in InvalidReferenceError
      throw new InvalidReferenceError(error instanceof Error ? error.message : String(error), path);
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

    // For tracking direct calls to resolvePath we need to add the path
    // Only if this is a direct call (not already in our resolving paths)
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
        this.logger.debug('No further path resolution needed');

        // If the value is a string with reference syntax, we need to resolve it
        // This is where circular references often happen
        if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
          this.logger.debug('Value is a reference string, resolving recursively:', value);

          // Before recursively resolving, we need to check if this is a circular reference
          const refPath = value.slice(2, -1);
          if (this.resolvingPaths.includes(refPath)) {
            const referencePath = [...this.resolvingPaths, refPath];
            this.logger.error('Circular reference detected in referenced value:', referencePath);
            throw new CircularReferenceError(
              `Circular reference detected: ${referencePath.join(' -> ')}`,
              referencePath,
            );
          }

          try {
            // Adding to resolving path handled by resolveReference
            value = this.resolveReference(value, extraContext);
          } catch (error) {
            // Re-throw CircularReferenceError as is
            if (error instanceof CircularReferenceError) {
              throw error;
            }
            // For other errors, we should wrap them
            throw new ReferenceResolutionError(
              `Failed to resolve reference in value for '${path}'`,
              path,
              value,
              error instanceof Error ? error : undefined,
            );
          }
        }

        // Remove path from resolving paths before returning if this was a direct call
        if (isDirectCall) {
          this.resolvingPaths.pop();
        }

        return value;
      }

      const restPath = path.slice(source.length);
      this.logger.debug('Resolving rest of path:', restPath);

      let result;
      if (restPath.startsWith('.')) {
        result = PathAccessor.get(value, restPath.slice(1), (expr) => {
          try {
            // Check for circular references in expression evaluation
            if (this.resolvingPaths.includes(expr)) {
              const referencePath = [...this.resolvingPaths, expr];
              this.logger.error('Circular reference detected in expression:', referencePath);
              throw new CircularReferenceError(
                `Circular reference detected: ${referencePath.join(' -> ')}`,
                referencePath,
              );
            }

            // The circular reference check for adding to resolvingPaths is handled within resolvePath
            return this.resolvePath(expr, extraContext);
          } catch (error) {
            // Re-throw our ReferenceResolverError errors as is
            if (error instanceof ReferenceResolverError) {
              throw error;
            }
            // Wrap other errors in InvalidReferenceError
            throw new InvalidReferenceError(
              error instanceof Error ? error.message : String(error),
              expr,
            );
          }
        });
      } else {
        result = PathAccessor.get(value, restPath, (expr) => {
          try {
            // Check for circular references in expression evaluation
            if (this.resolvingPaths.includes(expr)) {
              const referencePath = [...this.resolvingPaths, expr];
              this.logger.error('Circular reference detected in expression:', referencePath);
              throw new CircularReferenceError(
                `Circular reference detected: ${referencePath.join(' -> ')}`,
                referencePath,
              );
            }

            // The circular reference check for adding to resolvingPaths is handled within resolvePath
            return this.resolvePath(expr, extraContext);
          } catch (error) {
            // Re-throw our ReferenceResolverError errors as is
            if (error instanceof ReferenceResolverError) {
              throw error;
            }
            // Wrap other errors in InvalidReferenceError
            throw new InvalidReferenceError(
              error instanceof Error ? error.message : String(error),
              expr,
            );
          }
        });
      }

      this.logger.debug('Successfully resolved path:', { path, result });
      // Remove path from resolving paths before returning if this was a direct call
      if (isDirectCall) {
        this.resolvingPaths.pop();
      }

      return result;
    } catch (error) {
      // Remove path from resolving paths in case of error if this was a direct call
      if (isDirectCall) {
        this.resolvingPaths.pop();
      }

      this.logger.error('Failed to resolve path:', path, error);
      // Re-throw ReferenceResolverError and PathSyntaxError as is
      if (error instanceof ReferenceResolverError || error instanceof PathSyntaxError) {
        throw error;
      }
      // Wrap other errors in InvalidReferenceError
      throw new InvalidReferenceError(error instanceof Error ? error.message : String(error), path);
    }
  }

  getStepResults(): Map<string, any> {
    return this.stepResults;
  }
}
