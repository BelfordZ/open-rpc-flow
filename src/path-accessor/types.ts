/**
 * Represents a segment in a path, which can be either a property name, an array index, or an expression
 */
export interface PathSegment {
  type: 'property' | 'index' | 'expression';
  value: string;
  raw: string;
} 