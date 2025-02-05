import { Logger } from './util/logger';
import { PathAccessor } from './path-accessor';

/**
 * A specialized class for collecting references from expressions without actually resolving them.
 * This is used by the DependencyResolver to find step dependencies.
 */
export class ReferenceCollector {
  private collectedRefs: Set<string> = new Set();
  private localContextVars: Set<string> = new Set();

  constructor(private logger: Logger) {
    this.logger = logger.createNested('ReferenceCollector');
  }

  /**
   * Reset the collected references and local context variables
   */
  reset(): void {
    this.collectedRefs.clear();
    this.localContextVars.clear();
  }

  /**
   * Set the local context variables (like 'item' in loops) that should be ignored
   */
  setLocalContextVars(vars: string[]): void {
    this.localContextVars = new Set(vars);
  }

  /**
   * Get all collected references
   */
  getCollectedReferences(): string[] {
    return Array.from(this.collectedRefs);
  }

  /**
   * Collect references from an expression string
   */
  collectFromExpression(expr: string): void {
    // Match all ${...} references, including nested ones
    const regex = /\${([^}]+)}/g;
    let match;
    let lastIndex = 0;

    while ((match = regex.exec(expr)) !== null) {
      const path = match[1];
      this.collectFromPath(path);
      lastIndex = regex.lastIndex;
    }
  }

  /**
   * Collect references from a path string
   */
  private collectFromPath(path: string): void {
    try {
      // First, collect any nested references in array indices
      const arrayIndexRegex = /\[(\${[^}]+})\]/g;
      let indexMatch;
      while ((indexMatch = arrayIndexRegex.exec(path)) !== null) {
        const nestedRef = indexMatch[1].slice(2, -1); // Remove ${ and }
        this.collectFromExpression(indexMatch[1]); // Use collectFromExpression to handle nested references
      }

      // Then collect any other nested references
      const nestedRegex = /\${([^}]+)}/g;
      let nestedMatch;
      while ((nestedMatch = nestedRegex.exec(path)) !== null) {
        this.collectFromExpression('${' + nestedMatch[1] + '}'); // Use collectFromExpression to handle nested references
      }

      // Get the root reference (part before any dots or brackets)
      const rootMatch = path.match(/^([^.[]+)/);
      if (!rootMatch) {
        return;
      }

      const source = rootMatch[1];

      // Skip if it's a local context variable
      if (this.localContextVars.has(source)) {
        return;
      }

      // Skip if it's a global context variable or special variable
      if (
        source === 'context' ||
        source === 'metadata' ||
        source === 'item' ||
        source === 'acc' ||
        source === 'a' ||
        source === 'b'
      ) {
        return;
      }

      // Add the reference
      this.collectedRefs.add(source);
    } catch (error) {
      // Log but ignore errors since we only care about collecting references
      this.logger.debug(`Error collecting references from path (ignored): ${error}`);
    }
  }
} 