import { Logger } from '../util/logger';

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
  '...': true,
};

// Define unary operators
const UNARY_OPERATORS = new Set(['-', '+', '!']);

// Define punctuation
const PUNCTUATION = new Set(['(', ')', '[', ']', '{', '}', ':', ',']);

// Define valid operator characters
const VALID_OPERATOR_CHARS = new Set([
  '+',
  '-',
  '*',
  '/',
  '%',
  '=',
  '!',
  '<',
  '>',
  '&',
  '|',
  '?',
  '.',
]);

// Define invalid operator sequences
const INVALID_OPERATOR_SEQUENCES = new Set(['++', '--', '**', '<>', '>>', '<<', '@', '$$']);

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
export function tokenize(expression: string, parentLogger: Logger): Token[] {
  const logger = parentLogger.createNested('Tokenizer');
  logger.debug('Starting tokenization of expression:', expression);

  if (!expression || expression.trim() === '') {
    logger.error('Empty expression provided');
    throw new TokenizerError('Expression cannot be empty');
  }

  const tokens: Token[] = [];
  let current = 0;

  while (current < expression.length) {
    const char = expression[current];
    logger.debug(`Processing character at position ${current}:`, char);

    // Skip whitespace
    if (isWhitespace(char)) {
      logger.debug('Skipping whitespace');
      current++;
      continue;
    }

    // Handle string literals
    if (isQuote(char)) {
      logger.debug('Found string literal start');
      const quote = char;
      current++; // Skip opening quote
      let value = '';
      let escaped = false;

      while (current < expression.length) {
        if (expression[current] === '\\' && !escaped) {
          escaped = true;
          value += expression[current];
          current++;
          logger.debug('Found escape character in string');
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
        logger.error('String literal not terminated');
        throw new TokenizerError('Unterminated string literal');
      }

      current++; // Skip closing quote
      logger.debug('Completed string literal:', value);
      tokens.push({
        type: 'string',
        value: value.replace(/\\(.)/g, '$1'),
        raw: value + quote,
      });
      continue;
    }

    // Handle references
    if (char === '$' && expression[current + 1] === '{') {
      logger.debug('Found reference start');
      const start = current;
      let depth = 1;
      current += 2; // Skip ${

      while (current < expression.length && depth > 0) {
        if (expression[current] === '{') {
          depth++;
          logger.debug('Found nested opening brace, depth:', depth);
        } else if (expression[current] === '}') {
          depth--;
          logger.debug('Found closing brace, depth:', depth);
        }
        current++;
      }

      if (depth > 0) {
        logger.error('Reference not properly closed');
        throw new TokenizerError('Unterminated reference');
      }

      const reference = expression.slice(start, current);
      logger.debug('Completed reference:', reference);
      tokens.push({
        type: 'identifier',
        value: reference,
        raw: reference,
      });
      continue;
    }

    // Handle numbers
    if (isDigit(char) || (char === '.' && isDigit(expression[current + 1]))) {
      logger.debug('Found number start');
      let value = '';
      let hasDecimal = false;

      while (current < expression.length) {
        const c = expression[current];
        if (isDigit(c)) {
          value += c;
        } else if (c === '.' && !hasDecimal && isDigit(expression[current + 1])) {
          value += c;
          hasDecimal = true;
          logger.debug('Found decimal point in number');
        } else {
          break;
        }
        current++;
      }

      logger.debug('Completed number:', value);
      tokens.push({
        type: 'number',
        value,
        raw: value,
      });
      continue;
    }

    // Handle punctuation
    if (isPunctuation(char)) {
      logger.debug('Found punctuation:', char);
      tokens.push({
        type: 'punctuation',
        value: char,
        raw: char,
      });
      current++;
      continue;
    }

    // Handle operators
    if (isOperatorChar(char) || char === '.') {
      logger.debug('Found potential operator:', char);

      // Try three-character operators (including spread operator)
      if (current + 2 < expression.length) {
        const threeCharOp = expression.slice(current, current + 3);
        if (OPERATORS[threeCharOp]) {
          logger.debug('Found three-character operator:', threeCharOp);

          // Add the spread operator token
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
          logger.debug('Found two-character operator:', twoCharOp);
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
        logger.debug('Found single-character operator:', char);
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
      logger.debug('Found identifier start:', char);
      let identifier = '';
      while (
        current < expression.length &&
        !isWhitespace(expression[current]) &&
        !isOperatorChar(expression[current]) &&
        !isQuote(expression[current]) &&
        !isPunctuation(expression[current])
      ) {
        if (!isValidIdentifierChar(expression[current])) {
          logger.error('Invalid character in identifier:', expression[current]);
          throw new TokenizerError(`Invalid character in identifier: ${expression[current]}`);
        }
        identifier += expression[current];
        current++;
      }

      logger.debug('Completed identifier:', identifier);
      tokens.push({
        type: 'identifier',
        value: identifier,
        raw: identifier,
      });
      continue;
    }

    // If we get here, we've encountered an invalid character
    logger.error('Invalid character encountered:', char);
    throw new TokenizerError(`Invalid character: ${char}`);
  }

  logger.debug('Tokenization completed. Validating tokens...');
  validateTokens(tokens, logger);
  logger.debug('Token validation successful. Final tokens:', tokens);
  return tokens;
}

function validateTokens(tokens: Token[], logger: Logger): void {
  logger.debug('Starting token validation');

  let parenDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;

  // Validate operator placement and other syntax rules
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const prevToken = i > 0 ? tokens[i - 1] : null;
    const nextToken = i < tokens.length - 1 ? tokens[i + 1] : null;

    // Track parentheses/braces/brackets depth
    if (token.type === 'punctuation') {
      switch (token.value) {
        case '(':
          parenDepth++;
          break;
        case ')':
          parenDepth--;
          break;
        case '{':
          braceDepth++;
          break;
        case '}':
          braceDepth--;
          break;
        case '[':
          bracketDepth++;
          break;
        case ']':
          bracketDepth--;
          break;
      }

      if (parenDepth < 0 || braceDepth < 0 || bracketDepth < 0) {
        throw new TokenizerError('Unmatched closing parenthesis/brace/bracket');
      }
    }

    if (token.type === 'operator') {
      logger.debug(`Validating operator placement for: ${token.value}`);

      // Validate spread operator usage
      if (token.value === '...' && nextToken) {
        if (nextToken.type === 'number') {
          throw new TokenizerError('Invalid spread operator usage: cannot spread number literal');
        }
        if (nextToken.type === 'string') {
          throw new TokenizerError('Invalid spread operator usage: cannot spread string literal');
        }
        if (nextToken.type === 'identifier') {
          const value = nextToken.value;
          if (value === 'true' || value === 'false') {
            throw new TokenizerError(
              'Invalid spread operator usage: cannot spread boolean literal',
            );
          }
          if (value === 'null') {
            throw new TokenizerError('Invalid spread operator usage: cannot spread null');
          }
          if (value === 'undefined') {
            throw new TokenizerError('Invalid spread operator usage: cannot spread undefined');
          }
        }
      }

      // Binary operators need both operands, except unary operators
      if (!UNARY_OPERATORS.has(token.value)) {
        if (!prevToken || !nextToken) {
          logger.error(`Operator ${token.value} missing operand`);
          throw new TokenizerError(`Operator ${token.value} missing operand`);
        }
        // Check for operators followed by closing punctuation
        if (
          nextToken.type === 'punctuation' &&
          (nextToken.value === '}' || nextToken.value === ']' || nextToken.value === ')')
        ) {
          logger.error('Operator followed by closing punctuation');
          throw new TokenizerError('Unmatched closing parenthesis/brace/bracket');
        }
      } else {
        // Unary operators only need the next operand
        if (!nextToken) {
          logger.error(`Unary operator ${token.value} missing operand`);
          throw new TokenizerError(`Unary operator ${token.value} missing operand`);
        }
        // Check for unary operators followed by closing punctuation
        if (
          nextToken.type === 'punctuation' &&
          (nextToken.value === '}' || nextToken.value === ']' || nextToken.value === ')')
        ) {
          logger.error('Unary operator followed by closing punctuation');
          throw new TokenizerError('Unmatched closing parenthesis/brace/bracket');
        }
      }

      // Validate specific operator rules
      if (token.value === '/' || token.value === '%') {
        if (nextToken.type === 'number' && nextToken.value === '0') {
          logger.error(`Division/modulo by zero detected`);
          throw new TokenizerError(`Division/modulo by zero`);
        }
      }

      // Check for invalid operator sequences
      const operatorSequence = token.value + (nextToken?.value || '');
      if (INVALID_OPERATOR_SEQUENCES.has(operatorSequence)) {
        throw new TokenizerError(`Invalid operator sequence: ${operatorSequence}`);
      }
    }

    // Validate reference syntax
    if (token.type === 'identifier' && token.value.startsWith('$')) {
      // Skip validation for spread operator references
      if (prevToken?.type === 'operator' && prevToken.value === '...') {
        continue;
      }

      if (!token.value.startsWith('${') || !token.value.endsWith('}')) {
        throw new TokenizerError('Invalid reference syntax');
      }
    }
  }

  // Check for unclosed parentheses/braces/brackets
  if (parenDepth > 0) {
    throw new TokenizerError('Unclosed parentheses');
  }
  if (braceDepth > 0) {
    throw new TokenizerError('Unclosed braces');
  }
  if (bracketDepth > 0) {
    throw new TokenizerError('Unclosed brackets');
  }

  logger.debug('Token validation completed successfully');
}
