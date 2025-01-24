/**
 * Represents a token in an expression
 */
export interface Token {
  type: 'operator' | 'string' | 'number' | 'identifier' | 'punctuation';
  value: string;
  raw: string;
}

/**
 * Error thrown when tokenization fails
 */
export class TokenizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenizerError';
  }
}

// Define operators
const OPERATORS: Record<string, boolean> = {
  '+': true,
  '-': true,
  '*': true,
  '/': true,
  '%': true,
  '==': true,
  '===': true,
  '!=': true,
  '!==': true,
  '>': true,
  '>=': true,
  '<': true,
  '<=': true,
  '&&': true,
  '||': true,
  '??': true,
};

// Define punctuation
const PUNCTUATION = new Set(['(', ')', '[', ']', '{', '}', ':', ',']);

// Define valid operator characters
const VALID_OPERATOR_CHARS = new Set(['+', '-', '*', '/', '%', '=', '!', '<', '>', '&', '|', '?']);

// Define valid identifier characters
const VALID_IDENTIFIER_CHARS = /[a-zA-Z0-9_$.]/;

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function isDigit(char: string): boolean {
  return /\d/.test(char);
}

function isOperatorChar(char: string): boolean {
  return VALID_OPERATOR_CHARS.has(char);
}

function isQuote(char: string): boolean {
  return char === '"' || char === "'";
}

function isPunctuation(char: string): boolean {
  return PUNCTUATION.has(char);
}

function isValidIdentifierChar(char: string): boolean {
  return VALID_IDENTIFIER_CHARS.test(char);
}

/**
 * Tokenizes an expression string into an array of tokens
 * @throws {TokenizerError} If the expression is invalid
 */
export function tokenize(expression: string): Token[] {
  if (!expression || expression.trim() === '') {
    throw new TokenizerError('Expression cannot be empty');
  }

  const tokens: Token[] = [];
  let current = 0;

  while (current < expression.length) {
    const char = expression[current];

    // Skip whitespace
    if (isWhitespace(char)) {
      current++;
      continue;
    }

    // Handle string literals
    if (isQuote(char)) {
      const quote = char;
      current++; // Skip opening quote
      let value = '';
      let escaped = false;

      while (current < expression.length) {
        if (expression[current] === '\\' && !escaped) {
          escaped = true;
          value += expression[current];
          current++;
          continue;
        }

        if (expression[current] === quote && !escaped) {
          break;
        }

        value += expression[current];
        escaped = false;
        current++;
      }

      if (current >= expression.length) {
        throw new TokenizerError('Unterminated string literal');
      }

      current++; // Skip closing quote
      tokens.push({
        type: 'string',
        value: value.replace(/\\(.)/g, '$1'),
        raw: value + quote,
      });
      continue;
    }

    // Handle references
    if (char === '$' && expression[current + 1] === '{') {
      const start = current;
      let depth = 1;
      current += 2; // Skip ${

      while (current < expression.length && depth > 0) {
        if (expression[current] === '{') {
          depth++;
        } else if (expression[current] === '}') {
          depth--;
        }
        current++;
      }

      if (depth > 0) {
        throw new TokenizerError('Unterminated reference');
      }

      tokens.push({
        type: 'identifier',
        value: expression.slice(start, current),
        raw: expression.slice(start, current),
      });
      continue;
    }

    // Handle numbers
    if (isDigit(char) || (char === '.' && isDigit(expression[current + 1]))) {
      let value = '';
      let hasDecimal = false;

      while (current < expression.length) {
        const c = expression[current];
        if (isDigit(c)) {
          value += c;
        } else if (c === '.' && !hasDecimal && isDigit(expression[current + 1])) {
          value += c;
          hasDecimal = true;
        } else {
          break;
        }
        current++;
      }

      tokens.push({
        type: 'number',
        value,
        raw: value,
      });
      continue;
    }

    // Handle punctuation
    if (isPunctuation(char)) {
      tokens.push({
        type: 'punctuation',
        value: char,
        raw: char,
      });
      current++;
      continue;
    }

    // Handle operators
    if (isOperatorChar(char)) {
      // Try three-character operators
      if (current + 2 < expression.length) {
        const threeCharOp = expression.slice(current, current + 3);
        if (OPERATORS[threeCharOp]) {
          tokens.push({
            type: 'operator',
            value: threeCharOp,
            raw: threeCharOp,
          });
          current += 3;
          continue;
        }
      }

      // Try two-character operators
      if (current + 1 < expression.length) {
        const twoCharOp = expression.slice(current, current + 2);
        if (OPERATORS[twoCharOp]) {
          tokens.push({
            type: 'operator',
            value: twoCharOp,
            raw: twoCharOp,
          });
          current += 2;
          continue;
        }
      }

      // Single-character operators
      if (OPERATORS[char]) {
        tokens.push({
          type: 'operator',
          value: char,
          raw: char,
        });
        current++;
        continue;
      }
    }

    // Handle identifiers or throw on invalid characters
    if (isValidIdentifierChar(char)) {
      let identifier = '';
      while (
        current < expression.length &&
        !isWhitespace(expression[current]) &&
        !isOperatorChar(expression[current]) &&
        !isQuote(expression[current]) &&
        !isPunctuation(expression[current])
      ) {
        if (!isValidIdentifierChar(expression[current])) {
          throw new TokenizerError(`Invalid character in identifier: ${expression[current]}`);
        }
        identifier += expression[current];
        current++;
      }

      tokens.push({
        type: 'identifier',
        value: identifier,
        raw: identifier,
      });
      continue;
    }

    // If we get here, it's an invalid character
    throw new TokenizerError(`Invalid character: ${char}`);
  }

  // Validate the token sequence
  validateTokens(tokens);

  return tokens;
}

function validateTokens(tokens: Token[]): void {
  let parenDepth = 0;
  let braceDepth = 0;
  let lastType: Token['type'] | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    // Track parentheses depth
    if (token.type === 'punctuation') {
      if (token.value === '(') parenDepth++;
      if (token.value === ')') parenDepth--;
      if (token.value === '{') braceDepth++;
      if (token.value === '}') braceDepth--;
    }

    // Check for invalid operator sequences
    if (token.type === 'operator' && lastType === 'operator') {
      throw new TokenizerError('Invalid operator sequence');
    }

    // Check for invalid reference syntax
    if (
      token.type === 'identifier' &&
      token.value.startsWith('$') &&
      !token.value.startsWith('${')
    ) {
      throw new TokenizerError('Invalid reference syntax');
    }

    lastType = token.type;
  }

  // Check for unclosed parentheses or braces
  if (parenDepth !== 0) {
    throw new TokenizerError('Unmatched parentheses');
  }
  if (braceDepth !== 0) {
    throw new TokenizerError('Unmatched braces');
  }
}
