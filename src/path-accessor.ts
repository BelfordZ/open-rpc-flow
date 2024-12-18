/**
 * Represents a segment in a path, which can be either a property name, an array index, or an expression
 */
export interface PathSegment {
  type: 'property' | 'index' | 'expression';
  value: string;
  raw: string;
}

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
    public readonly position?: number
  ) {
    super(message);
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
    public readonly target: any
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
    public readonly path: string
  ) {
    super(message);
  }
}

/**
 * Utility class for parsing and accessing object paths using both dot and array notation
 */
export class PathAccessor {
  /**
   * Parse a path string into segments
   * Examples:
   * "foo.bar" -> [{type: 'property', value: 'foo'}, {type: 'property', value: 'bar'}]
   * "foo[0].bar" -> [{type: 'property', value: 'foo'}, {type: 'index', value: '0'}, {type: 'property', value: 'bar'}]
   * "foo['bar']" -> [{type: 'property', value: 'foo'}, {type: 'property', value: 'bar'}]
   * "foo[bar[0]]" -> [{type: 'property', value: 'foo'}, {type: 'expression', value: 'bar[0]'}]
   * @throws {PathSyntaxError} If the path syntax is invalid
   */
  static parsePath(path: string): PathSegment[] {
    const segments: PathSegment[] = [];
    let current = '';
    let inBracket = false;
    let inQuote = false;
    let quoteChar: string | null = null;
    let bracketContent = '';
    let bracketDepth = 0;
    let lastBracketPos = -1;

    // Remove leading dot if present
    if (path.startsWith('.')) {
      path = path.slice(1);
    }

    // Check for empty path
    if (!path) {
      throw new InvalidPathError('Path cannot be empty', path);
    }

    for (let i = 0; i < path.length; i++) {
      const char = path[i];

      if (char === '[' && !inQuote) {
        if (bracketDepth === 0 && current) {
          segments.push({ type: 'property', value: current, raw: current });
          current = '';
        }
        // Check for consecutive opening brackets at the same level, but allow bracket at start
        if (bracketDepth === 0 && i === lastBracketPos + 1 && i !== 0) {
          throw new PathSyntaxError(`Invalid bracket syntax at position ${i}`, path, i);
        }
        lastBracketPos = i;
        bracketDepth++;
        if (bracketDepth === 1) {
          inBracket = true;
          bracketContent = '';
        } else {
          // Only allow nested brackets in expressions that contain dots or identifiers
          if (!bracketContent.includes('.') && !/[a-zA-Z_$]/.test(bracketContent)) {
            throw new PathSyntaxError(`Invalid bracket syntax at position ${i}`, path, i);
          }
          bracketContent += char;
        }
        continue;
      }

      if (char === ']' && !inQuote) {
        if (!inBracket) {
          throw new PathSyntaxError(`Unexpected ] at position ${i}`, path, i);
        }
        bracketDepth--;
        if (bracketDepth === 0) {
          const raw = bracketContent;
          let value = bracketContent;
          let type: PathSegment['type'];

          // For array indices, strip quotes if present
          if (value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
            type = 'property';
          } else if (value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1);
            type = 'property';
          } else if (/^[0-9]+$/.test(value)) {
            type = 'index';
          } else {
            // If it contains any special characters or operations, treat it as an expression
            type = 'expression';
          }

          // Check for invalid bracket content
          if (!value && value !== '') {
            throw new PathSyntaxError('Empty brackets are not allowed', path, i);
          }

          segments.push({ type, value, raw: `[${raw}]` });
          current = '';
          inBracket = false;
          bracketContent = '';
        } else {
          bracketContent += char;
        }
        continue;
      }

      if ((char === '"' || char === "'") && (!inQuote || char === quoteChar)) {
        if (!inBracket && char === "'") {
          throw new PathSyntaxError(`Unexpected ' outside of brackets at position ${i}`, path, i);
        }
        if (inQuote) {
          quoteChar = null;
        } else {
          quoteChar = char;
        }
        inQuote = !inQuote;
        if (bracketDepth > 0) {
          bracketContent += char;
        }
        continue;
      }

      if (char === '.' && !inBracket && !inQuote) {
        if (current) {
          segments.push({ type: 'property', value: current, raw: current });
          current = '';
        } else if (segments.length === 0) {
          throw new PathSyntaxError('Path cannot start with .', path, i);
        } else if (i > 0 && path[i - 1] === '.') {
          throw new PathSyntaxError('Consecutive dots are not allowed', path, i);
        }
        continue;
      }

      if (bracketDepth > 0) {
        bracketContent += char;
      } else {
        // Check for invalid characters in property names
        if (!/[a-zA-Z0-9_$]/.test(char)) {
          throw new PathSyntaxError(`Invalid character '${char}' in property name at position ${i}`, path, i);
        }
        current += char;
      }
    }

    if (bracketDepth > 0) {
      throw new PathSyntaxError('Unclosed [', path);
    }
    if (inQuote) {
      throw new PathSyntaxError('Unclosed quote', path);
    }
    if (current) {
      segments.push({ type: 'property', value: current, raw: current });
    }

    // Check for empty segments
    if (segments.length === 0) {
      throw new InvalidPathError('Path cannot be empty', path);
    }

    return segments;
  }

  /**
   * Get a value from an object using a path
   * @throws {PropertyAccessError} If a property access fails
   * @throws {PathSyntaxError} If the path syntax is invalid
   */
  static get(obj: any, path: string): any {
    const segments = this.parsePath(path);
    return segments.reduce((current, segment) => {
      if (current === undefined || current === null) {
        throw new PropertyAccessError(
          `Cannot access property '${segment.value}' of ${current}`,
          path,
          segment,
          current
        );
      }

      // For array indices, try to parse as a number first
      let key: string | number = segment.value;
      if (segment.type === 'index') {
        const num = parseInt(key, 10);
        if (!isNaN(num)) {
          key = num;
        }
      }

      if (!current.hasOwnProperty(key)) {
        throw new PropertyAccessError(
          `Cannot access property '${key}' of ${JSON.stringify(current)}`,
          path,
          segment,
          current
        );
      }
      return current[key];
    }, obj);
  }

  /**
   * Check if a path exists in an object
   */
  static has(obj: any, path: string): boolean {
    try {
      this.get(obj, path);
      return true;
    } catch (error) {
      if (error instanceof PathSyntaxError) {
        throw error;
      }
      return false;
    }
  }

  /**
   * Get the root segment of a path (before any dots or brackets)
   * @throws {InvalidPathError} If the path is empty or invalid
   */
  static getRoot(path: string): string {
    const match = path.match(/^([^.[\s]+)/);
    if (!match) {
      throw new InvalidPathError(`Invalid path: ${path}`, path);
    }
    return match[1];
  }

  /**
   * Format a path segment for use in error messages
   */
  static formatSegment(segment: PathSegment): string {
    if (segment.type === 'index') {
      return `[${segment.value}]`;
    }
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(segment.value) 
      ? segment.value 
      : `[${JSON.stringify(segment.value)}]`;
  }

  /**
   * Format a full path for use in error messages
   */
  static formatPath(segments: PathSegment[]): string {
    return segments.map((segment, i) => {
      const formatted = this.formatSegment(segment);
      if (i === 0) return formatted;
      return segment.type === 'property' && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(segment.value)
        ? `.${formatted}`
        : formatted;
    }).join('');
  }
} 