import { ReferenceResolver, UnknownReferenceError } from './reference-resolver';
import { PathAccessor, PathSyntaxError, PropertyAccessError } from './path-accessor';

/**
 * Base class for expression evaluator errors
 */
export class ExpressionError extends Error {
  constructor(
    message: string,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Error thrown when expression evaluation fails
 */
export class ExpressionEvaluationError extends ExpressionError {
  constructor(
    message: string,
    public readonly expression: string,
    cause?: Error
  ) {
    super(message, cause);
  }
}

/**
 * Error thrown when reference resolution fails
 */
export class ReferenceResolutionError extends ExpressionError {
  constructor(
    message: string,
    public readonly path: string,
    cause?: Error
  ) {
    super(message, cause);
  }
}

/**
 * Error thrown when array access fails
 */
export class ArrayAccessError extends ExpressionError {
  constructor(
    message: string,
    public readonly expression: string,
    cause?: Error
  ) {
    super(message, cause);
  }
}

/**
 * Error thrown when comparison evaluation fails
 */
export class ComparisonError extends ExpressionError {
  constructor(
    message: string,
    public readonly expression: string,
    cause?: Error
  ) {
    super(message, cause);
  }
}

export class ExpressionEvaluator {
  constructor(
    private referenceResolver: ReferenceResolver,
    private context: Record<string, any>
  ) {}

  evaluateCondition(condition: string, extraContext: Record<string, any> = {}): boolean {
    const result = this.evaluateExpression(condition, extraContext);
    return Boolean(result);
  }

  evaluateExpression(expression: string, extraContext: Record<string, any> = {}): any {
    console.log('\n[evaluateExpression] Input:', expression);
    const context = { ...this.stepResults(), ...extraContext, context: this.context };
    try {
      // If it's a template literal (starts with backtick), preserve the template syntax
      if (expression.startsWith('`')) {
        console.log('[evaluateExpression] Handling template literal');
        return this.evaluateTemplateString(expression, extraContext);
      }

      // If it's a reference (${...}), evaluate it
      if (expression.startsWith('${') && expression.endsWith('}')) {
        console.log('[evaluateExpression] Checking for reference pattern');
        // Check if there's only one ${...} pattern
        const matches = expression.match(/\$\{[^}]+\}/g) || [];
        console.log('[evaluateExpression] Found matches:', matches);
        if (matches.length === 1 && matches[0] === expression) {
          console.log('[evaluateExpression] Single reference detected, evaluating path:', expression.slice(2, -1));
          const path = expression.slice(2, -1);
          try {
            return this.evaluateReference(path, extraContext);
          } catch (error) {
            if (error instanceof ExpressionError || error instanceof PathSyntaxError || error instanceof PropertyAccessError || error instanceof UnknownReferenceError) {
              throw error;
            }
            throw new ExpressionEvaluationError(
              `Failed to evaluate reference: ${path}`,
              expression,
              error instanceof Error ? error : undefined
            );
          }
        }
      }

      // For all other expressions, replace ${...} with resolved values
      console.log('[evaluateExpression] Replacing references in expression');
      let resolvedExpression = expression;
      let lastIndex = 0;
      let processedExpression = '';
      let inBacktick = false;
      let bracketDepth = 0;
      let currentExpression = '';

      for (let i = 0; i < expression.length; i++) {
        const char = expression[i];
        const nextChar = expression[i + 1];

        if (char === '`') {
          inBacktick = !inBacktick;
          currentExpression += char;
          continue;
        }

        if (char === '[') {
          bracketDepth++;
        } else if (char === ']') {
          bracketDepth--;
        }

        if (char === '$' && nextChar === '{' && !inBacktick) {
          let j = i + 2;
          let depth = 1;
          let foundEnd = false;

          while (j < expression.length) {
            if (expression[j] === '{') depth++;
            if (expression[j] === '}') depth--;
            if (depth === 0) {
              foundEnd = true;
              break;
            }
            j++;
          }

          if (foundEnd) {
            const fullMatch = expression.slice(i, j + 1);
            const path = expression.slice(i + 2, j);
            console.log('[evaluateExpression] Found reference:', path);
            try {
              const value = this.evaluateReference(path, extraContext);
              console.log('[evaluateExpression] Resolved value:', value);
              processedExpression += expression.slice(lastIndex, i) + (typeof value === 'string' ? `"${value}"` : value);
              lastIndex = j + 1;
              i = j;
              continue;
            } catch (error) {
              console.log('[evaluateExpression] Error resolving reference:', error);
              if (error instanceof ExpressionError || error instanceof PathSyntaxError || error instanceof PropertyAccessError || error instanceof UnknownReferenceError) {
                throw error;
              }
              throw new ExpressionEvaluationError(
                `Failed to evaluate reference: ${path}`,
                expression,
                error instanceof Error ? error : undefined
              );
            }
          }
        }

        if (i === expression.length - 1) {
          processedExpression += expression.slice(lastIndex);
        }
      }

      resolvedExpression = processedExpression || expression;
      console.log('[evaluateExpression] After replacing references:', resolvedExpression);

      // If it's an object literal, evaluate it
      if (resolvedExpression.trim().startsWith('{') && resolvedExpression.trim().endsWith('}')) {
        console.log('[evaluateExpression] Evaluating object literal');
        const func = new Function(...Object.keys(context), `return (${resolvedExpression})`);
        return func(...Object.values(context));
      }

      // Convert dot notation to bracket notation for property access
      const normalizedExpression = resolvedExpression.replace(
        /([a-zA-Z_$][a-zA-Z0-9_$]*)\.([\w$]+)/g,
        (_, obj, prop) => `${obj}["${prop}"]`
      );
      console.log('[evaluateExpression] Normalized expression:', normalizedExpression);

      // Evaluate the expression
      const func = new Function(...Object.keys(context), `return ${normalizedExpression}`);
      const finalResult = func(...Object.values(context));
      console.log('[evaluateExpression] Final result:', finalResult);
      return finalResult;
    } catch (error) {
      if (error instanceof ExpressionError || error instanceof PathSyntaxError || error instanceof PropertyAccessError || error instanceof UnknownReferenceError) {
        throw error;
      }
      throw new ExpressionEvaluationError(
        `Failed to evaluate expression: ${expression}`,
        expression,
        error instanceof Error ? error : undefined
      );
    }
  }

  private evaluateReference(path: string, extraContext: Record<string, any>): any {
    console.log('\n[evaluateReference] Input path:', path);
    const context = { ...this.stepResults(), ...extraContext, context: this.context };

    // Check if it's a comparison expression
    if (path.includes('>') || path.includes('<') || path.includes('===') || path.includes('!==')) {
      console.log('[evaluateReference] Handling comparison expression');
      try {
        // Replace references with their values
        const resolvedExpression = path.replace(
          /([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*(?:\[[^\]]+\])*)/g,
          (match) => {
            console.log('[evaluateReference] Resolving comparison reference:', match);
            try {
              const value = this.referenceResolver.resolvePath(match, extraContext);
              console.log('[evaluateReference] Resolved comparison value:', value);
              return typeof value === 'string' ? `"${value}"` : value;
            } catch (error) {
              if (error instanceof PathSyntaxError || error instanceof PropertyAccessError || error instanceof UnknownReferenceError) {
                throw new ComparisonError(
                  `Invalid reference in comparison: ${match}`,
                  path,
                  error
                );
              }
              return match;
            }
          }
        );
        console.log('[evaluateReference] Resolved comparison expression:', resolvedExpression);

        // Evaluate the comparison
        const func = new Function(...Object.keys(context), `return ${resolvedExpression}`);
        const result = func(...Object.values(context));
        console.log('[evaluateReference] Comparison result:', result);
        return result;
      } catch (error) {
        if (error instanceof ExpressionError || error instanceof PathSyntaxError || error instanceof PropertyAccessError || error instanceof UnknownReferenceError) {
          throw error;
        }
        throw new ComparisonError(
          `Failed to evaluate comparison: ${path}`,
          path,
          error instanceof Error ? error : undefined
        );
      }
    }

    try {
      // Parse the path into segments
      const segments = PathAccessor.parsePath(path);
      
      // Process each segment
      let resolvedPath = '';
      for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        
        if (segment.type === 'expression' || segment.type === 'index') {
          // For expression segments and index segments, evaluate the expression
          try {
            let value: any;
            if (segment.type === 'index') {
              // For index segments, use the value directly
              value = segment.value;
            } else {
              // For all other expressions, evaluate them in the context
              const resolvedExpression = segment.value.replace(
                /([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)*(?:\[[^\]]+\])*)/g,
                (match) => {
                  try {
                    // Skip if it's part of a template literal
                    if (match.startsWith('$') && segment.value.includes('`')) {
                      return match;
                    }
                    const value = this.referenceResolver.resolvePath(match, extraContext);
                    return typeof value === 'string' ? `"${value}"` : value;
                  } catch (error) {
                    if (error instanceof PathSyntaxError || error instanceof PropertyAccessError || error instanceof UnknownReferenceError) {
                      // Skip if it's part of a template literal
                      if (match.startsWith('$') && segment.value.includes('`')) {
                        return match;
                      }
                      throw new ExpressionEvaluationError(
                        `Invalid reference in expression: ${match}`,
                        path,
                        error
                      );
                    }
                    return match;
                  }
                }
              );

              try {
                const func = new Function(...Object.keys(context), `return ${resolvedExpression}`);
                value = func(...Object.values(context));
              } catch (error) {
                throw new ExpressionEvaluationError(
                  `Failed to evaluate expression: ${segment.value}`,
                  path,
                  error instanceof Error ? error : undefined
                );
              }
            }

            if (typeof value !== 'string' && typeof value !== 'number') {
              throw new ExpressionEvaluationError(
                `Array index must evaluate to a string or number, got ${typeof value}`,
                path
              );
            }
            resolvedPath += `[${JSON.stringify(value)}]`;
          } catch (error) {
            throw new ExpressionEvaluationError(
              `Failed to evaluate expression: ${segment.value}`,
              path,
              error instanceof Error ? error : undefined
            );
          }
        } else {
          // For property segments, use their raw value
          resolvedPath += i === 0 || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(segment.value)
            ? segment.raw
            : `.${segment.raw}`;
        }
      }

      // Resolve the final path
      try {
        return this.referenceResolver.resolvePath(resolvedPath, extraContext);
      } catch (error) {
        if (error instanceof PathSyntaxError) {
          // If it's a syntax error, convert it to an evaluation error
          throw new ExpressionEvaluationError(
            `Failed to evaluate expression: ${path}`,
            path,
            error
          );
        } else if (error instanceof PropertyAccessError) {
          // If it's a property access error, preserve the error type
          throw error;
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof ExpressionError || error instanceof PathSyntaxError || error instanceof PropertyAccessError || error instanceof UnknownReferenceError) {
        throw error;
      }
      throw new ReferenceResolutionError(
        `Failed to resolve reference: ${path}`,
        path,
        error instanceof Error ? error : undefined
      );
    }
  }

  private evaluateTemplateString(template: string, extraContext: Record<string, any>): string {
    const context = { ...this.stepResults(), ...extraContext, context: this.context };
    
    try {
      // Replace ${...} with resolved values but keep the template syntax
      const resolvedTemplate = template.replace(
        /\$\{([^}]+)\}/g,
        (_, path) => {
          const value = this.evaluateReference(path, extraContext);
          return `\${${JSON.stringify(value)}}`;
        }
      );

      // Evaluate as a template literal
      const func = new Function(...Object.keys(context), `return ${resolvedTemplate}`);
      return func(...Object.values(context));
    } catch (error) {
      if (error instanceof ExpressionError || error instanceof PathSyntaxError || error instanceof PropertyAccessError) {
        throw error;
      }
      throw new ExpressionEvaluationError(
        `Failed to evaluate template string: ${template}`,
        template,
        error instanceof Error ? error : undefined
      );
    }
  }

  private stepResults(): Record<string, any> {
    const results: Record<string, any> = {};
    for (const [key, value] of this.referenceResolver.getStepResults()) {
      results[key] = value;
    }
    return results;
  }
}