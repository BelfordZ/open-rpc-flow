import { Logger } from '../util/logger';

/**
 * Represents a token in an expression
 */
export interface Token {
  type:
    | 'string'
    | 'number'
    | 'operator'
    | 'reference'
    | 'object_literal'
    | 'array_literal'
    | 'punctuation'
    | 'identifier'
    | 'key'
    | 'template_literal';
  value: string | number | Token[] | any; // Allow any for now to handle complex nested structures
  raw: string;
}

export class TokenizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenizerError';
  }
}

const SPECIAL_CHARS = new Set(['(', ')', '[', ']', '{', '}', ',', ':']);
const OPERATORS = new Set([
  '+',
  '-',
  '*',
  '/',
  '>',
  '<',
  '=',
  '!',
  '&',
  '|',
  '.',
  '...',
  '%',
  '>=',
  '<=',
  '===',
  '!==',
  '&&',
  '||',
  '==',
  '!=',
  '??',
]);
const PUNCTUATION = new Set(['{', '}', '[', ']', '(', ')', ':', ',']);
const INVALID_OPERATOR_SEQUENCES = ['++', '--', '**', '$$', '@@', '<>', '>>', '<<'];
const UNARY_OPERATORS = ['+', '-', '!'];
const BINARY_OPERATORS = ['+', '-', '*', '/', '%', '=', '<', '>', '&', '|', '^', '??'];

interface TokenizerState {
  expression: string;
  currentIndex: number;
  logger: Logger;
  tokens: Token[];
  textBuffer: string;
  containerStack: string[];
  containerStart: number;
  currentContainer: string | null;
}

function createTokenizerState(expression: string, logger: Logger): TokenizerState {
  return {
    expression,
    currentIndex: 0,
    logger,
    tokens: [],
    textBuffer: '',
    containerStack: [],
    containerStart: 0,
    currentContainer: null,
  };
}

function _isSpecialChar(char: string): boolean {
  return SPECIAL_CHARS.has(char);
}

function isOperator(char: string): boolean {
  return OPERATORS.has(char) && !PUNCTUATION.has(char);
}

function isPunctuation(char: string): boolean {
  return PUNCTUATION.has(char);
}

function _isValidIdentifierChar(char: string): boolean {
  return /[a-zA-Z0-9_$]/.test(char);
}

function isUnaryContext(state: TokenizerState): boolean {
  if (!state.tokens.length) return true;
  const lastType = state.tokens[state.tokens.length - 1].type;
  return (
    lastType === 'operator' ||
    (state.tokens[state.tokens.length - 1].type === 'punctuation' &&
      state.tokens[state.tokens.length - 1].value === ',')
  );
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function isDigit(char: string): boolean {
  return /[0-9]/.test(char);
}

function _isQuote(char: string): boolean {
  return char === '"' || char === "'" || char === '`';
}

function isIdentifierStart(char: string): boolean {
  return /[a-zA-Z_$]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return isIdentifierStart(char) || isDigit(char);
}

function isIdentifier(text: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(text);
}

function isAlphanumeric(char: string): boolean {
  return /[a-zA-Z0-9]/.test(char);
}

function _validateChar(char: string): void {
  if (!isValidChar(char)) {
    throw new TokenizerError(`Invalid character in expression: ${char}`);
  }
}

function isValidChar(char: string): boolean {
  return (
    isAlphanumeric(char) ||
    isWhitespace(char) ||
    isOperator(char) ||
    isPunctuation(char) ||
    char === '"' ||
    char === "'" ||
    char === '`' ||
    char === '$' ||
    char === '_' ||
    char === '.'
  );
}

function validateOperatorSequence(state: TokenizerState, operator: string): void {
  const nextChar = state.expression[state.currentIndex + 1];

  // Check for invalid operator sequences
  if (nextChar && isOperator(nextChar)) {
    const sequence = operator + nextChar;
    if (INVALID_OPERATOR_SEQUENCES.includes(sequence)) {
      throw new TokenizerError(`Invalid operator sequence: ${sequence}`);
    }
  }

  // Determine if the operator should be treated as unary or binary
  if (UNARY_OPERATORS.includes(operator) && isUnaryContext(state)) {
    // Unary operator check starting at state.currentIndex
    const nextNonWhitespace = findNextNonWhitespace(state.expression, state.currentIndex);
    if (!nextNonWhitespace || isOperator(nextNonWhitespace)) {
      throw new TokenizerError(`Unary operator ${operator} missing operand`);
    }
  } else if (BINARY_OPERATORS.includes(operator)) {
    // Binary operator check starting at state.currentIndex
    if (state.tokens.length === 0) {
      throw new TokenizerError(`Operator ${operator} missing left operand`);
    }
    const nextNonWhitespace = findNextNonWhitespace(state.expression, state.currentIndex);
    if (!nextNonWhitespace || isOperator(nextNonWhitespace)) {
      throw new TokenizerError(`Operator ${operator} missing right operand`);
    }
  }
}

function findNextNonWhitespace(expression: string, startIndex: number): string | null {
  for (let i = startIndex; i < expression.length; i++) {
    if (!isWhitespace(expression[i])) {
      return expression[i];
    }
  }
  return null;
}

function _findPrevNonWhitespace(expression: string, startIndex: number): string | null {
  for (let i = startIndex - 1; i >= 0; i--) {
    if (!isWhitespace(expression[i])) {
      return expression[i];
    }
  }
  return null;
}

function _validateOperandCount(state: TokenizerState, operator: string): void {
  if (state.tokens.length === 0) {
    if (UNARY_OPERATORS.includes(operator)) {
      return; // Unary operator at start is fine
    }
    throw new TokenizerError(`Operator ${operator} missing operand`);
  }

  const lastToken = state.tokens[state.tokens.length - 1];
  if (
    lastToken.type === 'operator' ||
    (lastToken.type === 'punctuation' && lastToken.value === ',')
  ) {
    if (UNARY_OPERATORS.includes(operator)) {
      return; // Unary operator after another operator or comma is fine
    }
    throw new TokenizerError(`Operator ${operator} missing operand`);
  }
}

function _handleSpreadOperator(state: TokenizerState): Token {
  const _startIndex = state.currentIndex;
  state.currentIndex += 3; // Skip ...

  return {
    type: 'operator',
    value: '...',
    raw: '...',
  };
}

export function tokenize(expression: string, logger: Logger): Token[] {
  if (!expression || expression.trim() === '') {
    throw new TokenizerError('Expression cannot be empty');
  }
  return tokenizeExpression(expression, logger);
}

function flushTextBuffer(state: TokenizerState, _char: string, _logger: Logger): void {
  if (state.textBuffer.length === 0) {
    return;
  }

  const trimmedValue = state.textBuffer.trim();
  if (isIdentifier(trimmedValue)) {
    const token: Token = {
      type: 'identifier',
      value: trimmedValue,
      raw: trimmedValue,
    };
    state.tokens.push(token);
  } else {
    const token: Token = {
      type: 'string',
      value: trimmedValue,
      raw: state.textBuffer,
    };
    state.tokens.push(token);
  }

  state.textBuffer = '';
}

function _handleContainer(state: TokenizerState, char: string): void {
  const isClosing = char === '}' || char === ']';

  if (isClosing) {
    if (state.containerStack.length === 0) {
      throw new TokenizerError('Unmatched closing parenthesis/brace/bracket');
    }

    const openChar = state.containerStack.pop();
    if ((openChar === '{' && char !== '}') || (openChar === '[' && char !== ']')) {
      throw new TokenizerError(
        `Mismatched container: expected ${openChar === '{' ? '}' : ']'} but found ${char}`,
      );
    }

    flushTextBuffer(state, char, state.logger);

    // Get all tokens since container start
    const containerTokens = state.tokens.splice(state.containerStart);
    const containerType = openChar === '{' ? 'object_literal' : 'array_literal';
    const containerRaw = state.expression.substring(state.containerStart, state.currentIndex + 1);

    // Convert identifiers to strings in object keys
    if (containerType === 'object_literal') {
      for (let i = 0; i < containerTokens.length; i++) {
        if (
          containerTokens[i].type === 'identifier' &&
          i + 1 < containerTokens.length &&
          containerTokens[i + 1].type === 'punctuation' &&
          containerTokens[i + 1].value === ':'
        ) {
          containerTokens[i] = {
            type: 'string',
            value: containerTokens[i].value,
            raw: containerTokens[i].raw,
          };
        }
      }
    }

    state.tokens.push({
      type: containerType,
      value: containerTokens,
      raw: containerRaw,
    });

    state.currentContainer =
      state.containerStack.length > 0
        ? state.containerStack[state.containerStack.length - 1]
        : null;
  } else {
    flushTextBuffer(state, char, state.logger);
    state.containerStack.push(char);
    state.containerStart = state.currentIndex;
    state.currentContainer = char;
  }

  state.currentIndex++;
}

function isNumber(char: string): boolean {
  return /[0-9]/.test(char);
}

function handleNumber(state: TokenizerState): Token {
  const _startIndex = state.currentIndex;
  let numberStr = '';

  while (state.currentIndex < state.expression.length) {
    const char = state.expression[state.currentIndex];
    if (!isNumber(char) && char !== '.') {
      break;
    }
    numberStr += char;
    state.currentIndex++;
  }

  return {
    type: 'number',
    value: Number(numberStr),
    raw: numberStr,
  };
}

function handleReference(state: TokenizerState): Token {
  const startIndex = state.currentIndex;
  state.currentIndex += 2; // Skip ${

  const referenceTokens: Token[] = [];
  let textBuffer = '';
  let bracketCount = 1;
  let inOperator = false;

  while (state.currentIndex < state.expression.length) {
    const char = state.expression[state.currentIndex];

    if (char === '{') {
      bracketCount++;
      if (textBuffer) {
        referenceTokens.push({
          type: isNumber(textBuffer.trim()) ? 'number' : 'identifier',
          value: isNumber(textBuffer.trim()) ? Number(textBuffer.trim()) : textBuffer.trim(),
          raw: textBuffer,
        });
        textBuffer = '';
      }
      state.currentIndex++;
      continue;
    }

    if (char === '}') {
      bracketCount--;
      if (bracketCount === 0) {
        if (textBuffer) {
          referenceTokens.push({
            type: isNumber(textBuffer.trim()) ? 'number' : 'identifier',
            value: isNumber(textBuffer.trim()) ? Number(textBuffer.trim()) : textBuffer.trim(),
            raw: textBuffer,
          });
        }
        state.currentIndex++;
        return {
          type: 'reference',
          value: referenceTokens,
          raw: state.expression.substring(startIndex, state.currentIndex),
        };
      }
      state.currentIndex++;
      continue;
    }

    if (char === '[') {
      if (textBuffer) {
        referenceTokens.push({
          type: isNumber(textBuffer.trim()) ? 'number' : 'identifier',
          value: isNumber(textBuffer.trim()) ? Number(textBuffer.trim()) : textBuffer.trim(),
          raw: textBuffer,
        });
        textBuffer = '';
      }
      referenceTokens.push({
        type: 'punctuation',
        value: '[',
        raw: '[',
      });
      state.currentIndex++;
      continue;
    }

    if (char === ']') {
      if (textBuffer) {
        referenceTokens.push({
          type: isNumber(textBuffer.trim()) ? 'number' : 'identifier',
          value: isNumber(textBuffer.trim()) ? Number(textBuffer.trim()) : textBuffer.trim(),
          raw: textBuffer,
        });
        textBuffer = '';
      }
      referenceTokens.push({
        type: 'punctuation',
        value: ']',
        raw: ']',
      });
      state.currentIndex++;
      continue;
    }

    if (isOperator(char)) {
      if (textBuffer) {
        referenceTokens.push({
          type: isNumber(textBuffer.trim()) ? 'number' : 'identifier',
          value: isNumber(textBuffer.trim()) ? Number(textBuffer.trim()) : textBuffer.trim(),
          raw: textBuffer,
        });
        textBuffer = '';
      }
      referenceTokens.push({
        type: 'operator',
        value: char,
        raw: char,
      });
      state.currentIndex++;
      inOperator = true;
      continue;
    }

    if (char === '$' && state.expression[state.currentIndex + 1] === '{') {
      if (textBuffer) {
        referenceTokens.push({
          type: isNumber(textBuffer.trim()) ? 'number' : 'identifier',
          value: isNumber(textBuffer.trim()) ? Number(textBuffer.trim()) : textBuffer.trim(),
          raw: textBuffer,
        });
        textBuffer = '';
      }
      const nestedRef = handleReference(state);
      referenceTokens.push(nestedRef);
      continue;
    }

    if (isWhitespace(char)) {
      if (textBuffer && !inOperator) {
        referenceTokens.push({
          type: isNumber(textBuffer.trim()) ? 'number' : 'identifier',
          value: isNumber(textBuffer.trim()) ? Number(textBuffer.trim()) : textBuffer.trim(),
          raw: textBuffer,
        });
        textBuffer = '';
      }
      state.currentIndex++;
      continue;
    }

    textBuffer += char;
    inOperator = false;
    state.currentIndex++;
  }

  throw new TokenizerError('Unterminated reference');
}

function handleOperator(state: TokenizerState): Token {
  const _startIndex = state.currentIndex;
  const char = state.expression[state.currentIndex];

  // Handle spread operator
  if (
    char === '.' &&
    state.currentIndex + 2 < state.expression.length &&
    state.expression[state.currentIndex + 1] === '.' &&
    state.expression[state.currentIndex + 2] === '.'
  ) {
    state.currentIndex += 3;
    return {
      type: 'operator',
      value: '...',
      raw: '...',
    };
  }

  let operator = char;

  // Check for three-character operators
  if (state.currentIndex + 2 < state.expression.length) {
    const potentialOperator3 = state.expression.substring(
      state.currentIndex,
      state.currentIndex + 3,
    );
    if (OPERATORS.has(potentialOperator3)) {
      operator = potentialOperator3;
      state.currentIndex += 3;
      validateOperatorSequence(state, operator);
      return {
        type: 'operator',
        value: operator,
        raw: operator,
      };
    }
  }

  // Check for two-character operators
  const nextChar =
    state.currentIndex + 1 < state.expression.length
      ? state.expression[state.currentIndex + 1]
      : '';
  if (nextChar) {
    const potentialOperator = char + nextChar;
    if (OPERATORS.has(potentialOperator)) {
      operator = potentialOperator;
      state.currentIndex += 2;
      validateOperatorSequence(state, operator);
      return {
        type: 'operator',
        value: operator,
        raw: operator,
      };
    }
  }

  // Handle single-character operators
  state.currentIndex++;
  validateOperatorSequence(state, operator);
  return {
    type: 'operator',
    value: operator,
    raw: operator,
  };
}

function handleStringLiteral(state: TokenizerState, quote: string): Token {
  const startIndex = state.currentIndex;
  let value = '';

  state.currentIndex++; // Skip opening quote

  while (state.currentIndex < state.expression.length) {
    const char = state.expression[state.currentIndex];

    if (char === '\\') {
      if (state.currentIndex + 1 < state.expression.length) {
        const nextChar = state.expression[state.currentIndex + 1];
        if (nextChar === quote || nextChar === '\\') {
          value += nextChar;
          state.currentIndex += 2;
          continue;
        }
      }
      value += char;
      state.currentIndex++;
      continue;
    }

    if (char === quote) {
      state.currentIndex++; // Skip the closing quote
      return {
        type: 'string',
        value: value,
        raw: state.expression.substring(startIndex, state.currentIndex),
      };
    }

    value += char;
    state.currentIndex++;
  }

  throw new TokenizerError('Unterminated string literal');
}

function handleTemplateLiteral(state: TokenizerState): Token[] {
  const _startIndex = state.currentIndex;
  state.currentIndex++; // Skip opening backtick

  const tokens: Token[] = [];
  let textBuffer = '';
  let rawBuffer = '';

  while (state.currentIndex < state.expression.length) {
    const char = state.expression[state.currentIndex];

    if (char === '`') {
      if (textBuffer || rawBuffer) {
        tokens.push({
          type: 'string',
          value: textBuffer,
          raw: rawBuffer || textBuffer,
        });
      }
      state.currentIndex++;
      return tokens;
    }

    if (char === '\\') {
      const nextChar = state.expression[state.currentIndex + 1];
      if (nextChar === '$' && state.expression[state.currentIndex + 2] === '{') {
        textBuffer += '${';
        rawBuffer += '\\${';
        state.currentIndex += 3;
        continue;
      }
      if (nextChar === '`' || nextChar === '\\') {
        textBuffer += nextChar;
        rawBuffer += char + nextChar;
        state.currentIndex += 2;
        continue;
      }
      textBuffer += char;
      rawBuffer += char;
      state.currentIndex++;
      continue;
    }

    if (char === '$' && state.expression[state.currentIndex + 1] === '{') {
      if (textBuffer || rawBuffer) {
        tokens.push({
          type: 'string',
          value: textBuffer,
          raw: rawBuffer || textBuffer,
        });
        textBuffer = '';
        rawBuffer = '';
      }

      state.currentIndex += 2; // Skip ${
      const expressionStartIndex = state.currentIndex;
      let bracketCount = 1;

      while (state.currentIndex < state.expression.length && bracketCount > 0) {
        const current = state.expression[state.currentIndex];
        if (current === '{') bracketCount++;
        if (current === '}') bracketCount--;
        state.currentIndex++;
      }

      if (bracketCount > 0) {
        throw new TokenizerError('Unterminated expression in template literal');
      }

      const expressionContent = state.expression.substring(
        expressionStartIndex,
        state.currentIndex - 1,
      );
      const expressionTokens = tokenizeExpression(expressionContent, state.logger);

      tokens.push({
        type: 'reference',
        value: expressionTokens,
        raw: '${' + expressionContent + '}',
      });

      continue;
    }

    textBuffer += char;
    rawBuffer += char;
    state.currentIndex++;
  }

  throw new TokenizerError('Unterminated template literal');
}

interface _ObjectLiteralToken extends Token {
  type: 'object_literal';
  value: Token[];
}

function handleObjectLiteral(state: TokenizerState): Token {
  const startIndex = state.currentIndex;
  state.currentIndex++; // Skip opening brace

  const objectTokens: Token[] = [];
  state.textBuffer = '';
  let _expectingValue = true;
  let expectingKey = true;

  while (state.currentIndex < state.expression.length) {
    const char = state.expression[state.currentIndex];

    if (char === '"' || char === "'") {
      if (state.textBuffer) {
        objectTokens.push({
          type: expectingKey ? 'string' : 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      const stringToken = handleStringLiteral(state, char);
      objectTokens.push(stringToken);
      continue;
    }

    if (isWhitespace(char)) {
      if (state.textBuffer) {
        objectTokens.push({
          type: expectingKey ? 'string' : 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      state.currentIndex++;
      continue;
    }

    if (char === '}') {
      if (state.textBuffer) {
        objectTokens.push({
          type: expectingKey ? 'string' : 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
      }
      state.currentIndex++;
      return {
        type: 'object_literal',
        value: objectTokens,
        raw: state.expression.substring(startIndex, state.currentIndex),
      };
    }

    if (char === ':') {
      if (state.textBuffer) {
        objectTokens.push({
          type: 'string',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      objectTokens.push({
        type: 'punctuation',
        value: ':',
        raw: ':',
      });
      expectingKey = false;
      _expectingValue = true;
      state.currentIndex++;
      continue;
    }

    if (char === ',') {
      if (state.textBuffer) {
        objectTokens.push({
          type: 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      objectTokens.push({
        type: 'punctuation',
        value: ',',
        raw: ',',
      });
      expectingKey = true;
      _expectingValue = true;
      state.currentIndex++;
      continue;
    }

    if (
      char === '.' &&
      state.currentIndex + 2 < state.expression.length &&
      state.expression[state.currentIndex + 1] === '.' &&
      state.expression[state.currentIndex + 2] === '.'
    ) {
      if (state.textBuffer) {
        objectTokens.push({
          type: expectingKey ? 'string' : 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      objectTokens.push({
        type: 'operator',
        value: '...',
        raw: '...',
      });
      state.currentIndex += 3;
      continue;
    }

    if (char === '$') {
      if (state.textBuffer) {
        objectTokens.push({
          type: expectingKey ? 'string' : 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      const reference = handleReference(state);
      objectTokens.push(reference);
      _expectingValue = false;
      continue;
    }

    if (char === '{') {
      if (state.textBuffer) {
        objectTokens.push({
          type: expectingKey ? 'string' : 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      const nestedObject = handleObjectLiteral(state);
      objectTokens.push(nestedObject);
      _expectingValue = false;
      continue;
    }

    if (char === '[') {
      if (state.textBuffer) {
        objectTokens.push({
          type: expectingKey ? 'string' : 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      const array = handleArrayLiteral(state);
      objectTokens.push(array);
      _expectingValue = false;
      continue;
    }

    if (char === '`') {
      if (state.textBuffer) {
        objectTokens.push({
          type: expectingKey ? 'string' : 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      const template = handleTemplateLiteral(state);
      objectTokens.push(...template);
      _expectingValue = false;
      continue;
    }

    if (isNumber(char) && state.textBuffer === '') {
      const number = handleNumber(state);
      objectTokens.push(number);
      _expectingValue = false;
      continue;
    }

    state.textBuffer += char;
    state.currentIndex++;
  }

  throw new TokenizerError('Unterminated object literal');
}

function handleArrayLiteral(state: TokenizerState): Token {
  const startIndex = state.currentIndex;
  state.currentIndex++; // Skip opening bracket

  const arrayTokens: Token[] = [];
  state.textBuffer = '';
  let bracketCount = 1;

  while (state.currentIndex < state.expression.length) {
    const char = state.expression[state.currentIndex];

    if (char === '[') {
      bracketCount++;
      if (state.textBuffer.trim() !== '') {
        arrayTokens.push({
          type: 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
      }
      state.textBuffer = '';
      const nestedArray = handleArrayLiteral(state);
      arrayTokens.push(nestedArray);
      bracketCount--; // Decrement bracket count since nested array is complete
      continue;
    }

    if (char === ']') {
      bracketCount--;
      if (bracketCount === 0) {
        if (state.textBuffer.trim() !== '') {
          arrayTokens.push({
            type: 'identifier',
            value: state.textBuffer.trim(),
            raw: state.textBuffer,
          });
        }
        state.textBuffer = '';
        state.currentIndex++;
        return {
          type: 'array_literal',
          value: arrayTokens,
          raw: state.expression.substring(startIndex, state.currentIndex),
        };
      }
      state.currentIndex++;
      continue;
    }

    if (
      char === '.' &&
      state.currentIndex + 2 < state.expression.length &&
      state.expression[state.currentIndex + 1] === '.' &&
      state.expression[state.currentIndex + 2] === '.'
    ) {
      if (state.textBuffer.trim() !== '') {
        arrayTokens.push({
          type: 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
      }
      state.textBuffer = '';
      arrayTokens.push({
        type: 'operator',
        value: '...',
        raw: '...',
      });
      state.currentIndex += 3;
      continue;
    }

    if (char === ',') {
      if (state.textBuffer.trim() !== '') {
        arrayTokens.push({
          type: 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
      }
      state.textBuffer = '';
      arrayTokens.push({
        type: 'punctuation',
        value: ',',
        raw: ',',
      });
      state.currentIndex++;
      continue;
    }

    if (char === '$' && state.expression[state.currentIndex + 1] === '{') {
      if (state.textBuffer.trim() !== '') {
        arrayTokens.push({
          type: 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
      }
      state.textBuffer = '';
      const reference = handleReference(state);
      arrayTokens.push(reference);
      continue;
    }

    if (char === '{') {
      if (state.textBuffer.trim() !== '') {
        arrayTokens.push({
          type: 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
      }
      state.textBuffer = '';
      const object = handleObjectLiteral(state);
      arrayTokens.push(object);
      continue;
    }

    if (isNumber(char) && state.textBuffer === '') {
      const number = handleNumber(state);
      arrayTokens.push(number);
      continue;
    }

    // New branch: handle string literals inside array literals
    if (char === '"' || char === "'") {
      if (state.textBuffer.trim() !== '') {
        arrayTokens.push({
          type: 'identifier',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
      }
      state.textBuffer = '';
      const stringToken = handleStringLiteral(state, char);
      arrayTokens.push(stringToken);
      // Clear textBuffer explicitly after handling string literal
      state.textBuffer = '';
      continue;
    }

    if (isWhitespace(char) && state.textBuffer.trim() === '') {
      state.textBuffer = '';
      state.currentIndex++;
      continue;
    }

    state.textBuffer += char;
    state.currentIndex++;
  }

  throw new TokenizerError('Unterminated array literal');
}

function tokenizeExpression(expression: string, logger: Logger): Token[] {
  const state = createTokenizerState(expression, logger);
  const _expectingValue = true;
  let inTextSequence = false;
  let inBraces = false;

  while (state.currentIndex < expression.length) {
    const char = expression[state.currentIndex];

    if (char === '"' || char === "'") {
      if (state.textBuffer) {
        state.tokens.push({
          type: isNumber(state.textBuffer.trim()) ? 'number' : inBraces ? 'string' : 'identifier',
          value: isNumber(state.textBuffer.trim())
            ? Number(state.textBuffer.trim())
            : inBraces
              ? state.textBuffer
              : state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      const stringToken = handleStringLiteral(state, char);
      state.tokens.push(stringToken);
      continue;
    }

    if (char === '`') {
      if (state.textBuffer) {
        state.tokens.push({
          type: isNumber(state.textBuffer.trim()) ? 'number' : inBraces ? 'string' : 'identifier',
          value: isNumber(state.textBuffer.trim())
            ? Number(state.textBuffer.trim())
            : inBraces
              ? state.textBuffer
              : state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      const templateTokens = handleTemplateLiteral(state);
      state.tokens.push(...templateTokens);
      continue;
    }

    if (
      (state.currentIndex + 1 < expression.length &&
        expression.substring(state.currentIndex, state.currentIndex + 2) === '??') ||
      isOperator(char) ||
      isPunctuation(char)
    ) {
      if (state.textBuffer) {
        state.tokens.push({
          type: isNumber(state.textBuffer.trim()) ? 'number' : inBraces ? 'string' : 'identifier',
          value: isNumber(state.textBuffer.trim())
            ? Number(state.textBuffer.trim())
            : inBraces
              ? state.textBuffer
              : state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      inTextSequence = false;

      if (char === '{') {
        // Check if this is an object literal by looking ahead for key-value pairs or spread operator
        let isObjectLiteral = false;
        let lookAhead = state.currentIndex + 1;
        let depth = 1;

        while (lookAhead < expression.length && depth > 0) {
          if (expression[lookAhead] === '{') depth++;
          if (expression[lookAhead] === '}') depth--;

          // Check for spread operator
          if (
            expression[lookAhead] === '.' &&
            lookAhead + 2 < expression.length &&
            expression[lookAhead + 1] === '.' &&
            expression[lookAhead + 2] === '.'
          ) {
            isObjectLiteral = true;
            break;
          }

          // Check for key-value pairs
          if (expression[lookAhead] === ':') {
            isObjectLiteral = true;
            break;
          }

          // Check for references that might be keys
          if (
            expression[lookAhead] === '$' &&
            lookAhead + 1 < expression.length &&
            expression[lookAhead + 1] === '{'
          ) {
            let refDepth = 1;
            lookAhead += 2;
            while (lookAhead < expression.length && refDepth > 0) {
              if (expression[lookAhead] === '{') refDepth++;
              if (expression[lookAhead] === '}') refDepth--;
              lookAhead++;
            }
            continue;
          }

          lookAhead++;
        }

        if (isObjectLiteral) {
          state.tokens.push(handleObjectLiteral(state));
        } else {
          state.tokens.push({
            type: 'punctuation',
            value: '{',
            raw: '{',
          });
          state.currentIndex++;
          inBraces = true;
        }
      } else if (char === '}' && !state.containerStack.includes('{')) {
        state.tokens.push({
          type: 'punctuation',
          value: '}',
          raw: '}',
        });
        state.currentIndex++;
        inBraces = false;
      } else if (char === '[') {
        state.tokens.push(handleArrayLiteral(state));
      } else {
        state.tokens.push(handleOperator(state));
      }
      continue;
    }

    if (isWhitespace(char)) {
      if (inBraces) {
        if (!inTextSequence) {
          if (state.textBuffer) {
            state.tokens.push({
              type: isNumber(state.textBuffer.trim()) ? 'number' : 'string',
              value: isNumber(state.textBuffer.trim())
                ? Number(state.textBuffer.trim())
                : state.textBuffer,
              raw: state.textBuffer,
            });
            state.textBuffer = '';
          }
          inTextSequence = true;
        }
        state.textBuffer += char;
      } else if (state.textBuffer) {
        state.tokens.push({
          type: isNumber(state.textBuffer.trim()) ? 'number' : 'identifier',
          value: isNumber(state.textBuffer.trim())
            ? Number(state.textBuffer.trim())
            : state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      state.currentIndex++;
      continue;
    }

    if (char === '$') {
      if (state.textBuffer) {
        state.tokens.push({
          type: isNumber(state.textBuffer.trim()) ? 'number' : inBraces ? 'string' : 'identifier',
          value: isNumber(state.textBuffer.trim())
            ? Number(state.textBuffer.trim())
            : inBraces
              ? state.textBuffer
              : state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      inTextSequence = false;
      state.tokens.push(handleReference(state));
      continue;
    }

    state.textBuffer += char;
    state.currentIndex++;
  }

  if (state.textBuffer) {
    state.tokens.push({
      type: isNumber(state.textBuffer.trim()) ? 'number' : inBraces ? 'string' : 'identifier',
      value: isNumber(state.textBuffer.trim())
        ? Number(state.textBuffer.trim())
        : inBraces
          ? state.textBuffer
          : state.textBuffer.trim(),
      raw: state.textBuffer,
    });
  }

  return state.tokens;
}

function _createToken(type: Token['type'], value: string, raw: string): Token {
  return {
    type,
    value,
    raw,
  };
}

function _handleIdentifier(state: TokenizerState): Token {
  let identifier = '';
  const startIndex = state.currentIndex;

  while (state.currentIndex < state.expression.length) {
    const char = state.expression[state.currentIndex];
    if (!isIdentifierPart(char)) {
      break;
    }
    identifier += char;
    state.currentIndex++;
  }

  return {
    type: 'identifier',
    value: identifier,
    raw: state.expression.substring(startIndex, state.currentIndex),
  };
}

function _handlePunctuation(state: TokenizerState): Token {
  const char = state.expression[state.currentIndex];
  state.currentIndex++;
  return {
    type: 'punctuation',
    value: char,
    raw: char,
  };
}
