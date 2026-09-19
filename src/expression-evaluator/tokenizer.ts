import { Logger } from '../util/logger';
import type { Token } from './types';
export type { Token, TokenType, TokenWithKeyValue, TokenWithTokenArrayValue } from './types';
export { hasKeyValue, hasTokenArrayValue } from './types';
import { TimeoutError } from '../errors/timeout-error';
import type { Step } from '../types';
import type { StepType } from '../step-executors/types';

/**
 * Options for {@link tokenize}.
 *
 * When `startTime` and `timeoutMs` are both set, tokenization aborts with a
 * TimeoutError once the elapsed time exceeds the timeout (issue #163). The
 * check is coarse-grained — every 1024 characters, not per character — so
 * normal expressions see no measurable slowdown.
 */
export interface TokenizeOptions {
  /** When expression evaluation started, as a Date.now() value. */
  startTime?: number;
  /** Configured expression timeout in milliseconds. */
  timeoutMs?: number;
  /** Step context for the TimeoutError, when available. */
  step?: Step;
  /** Step type context for the TimeoutError, when available. */
  stepType?: StepType;
}

export class TokenizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenizerError';
  }
}
const _SPECIAL_CHARS = new Set(['(', ')', '[', ']', '{', '}', ',', ':']);
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
  startTime?: number;
  timeoutMs?: number;
  step?: Step;
  stepType?: StepType;
}

function createTokenizerState(
  expression: string,
  logger: Logger,
  options: TokenizeOptions,
): TokenizerState {
  return {
    expression,
    currentIndex: 0,
    logger,
    tokens: [],
    textBuffer: '',
    containerStack: [],
    containerStart: 0,
    currentContainer: null,
    startTime: options.startTime,
    timeoutMs: options.timeoutMs,
    step: options.step,
    stepType: options.stepType,
  };
}

/**
 * Characters processed between timeout checks. Coarse-grained on purpose:
 * tokenization is a tight loop and there is no reason to sample the clock
 * per character (issue #163).
 */
const TIMEOUT_CHECK_INTERVAL = 1024;

/**
 * Aborts tokenization with a TimeoutError once the configured expression
 * timeout has elapsed. A no-op unless the caller supplied a timeout via
 * TokenizeOptions.
 */
function checkTokenizeTimeout(state: TokenizerState, index: number): void {
  if (state.startTime === undefined || state.timeoutMs === undefined) {
    return;
  }
  if ((index & (TIMEOUT_CHECK_INTERVAL - 1)) !== 0) {
    return;
  }
  const elapsed = Date.now() - state.startTime;
  if (elapsed > state.timeoutMs) {
    throw TimeoutError.forExpression(
      state.expression,
      state.timeoutMs,
      elapsed,
      state.step,
      state.stepType,
    );
  }
}

function isOperator(char: string): boolean {
  return OPERATORS.has(char) && !PUNCTUATION.has(char);
}

function isPunctuation(char: string): boolean {
  return PUNCTUATION.has(char);
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

function isQuote(char: string): boolean {
  return char === '"' || char === "'" || char === '`';
}

function validateOperatorSequence(state: TokenizerState, operator: string): void {
  // NOTE: handleOperator advances state.currentIndex past the operator token
  // before calling this function, so state.currentIndex is already the index
  // of the character immediately following the operator. (Issue #142: using
  // currentIndex + 1 here skipped a character and misidentified valid
  // unspaced chains like `1+1+1` as invalid `++` sequences.)
  const nextChar = state.expression[state.currentIndex];

  // Check for invalid operator sequences
  if (nextChar && isOperator(nextChar)) {
    const sequence = operator + nextChar;
    if (INVALID_OPERATOR_SEQUENCES.includes(sequence)) {
      throw new TokenizerError(`Invalid operator sequence: ${sequence}`);
    }
  }

  // A prefix unary operator (`+`, `-`, `!`) may start the operand of a unary
  // or binary operator -- e.g. the `-` in `5 + -3`, or the second `!` in
  // `!!flag`. (Issues #144, #149.)
  const nextNonWhitespace = findNextNonWhitespace(state.expression, state.currentIndex);
  const nextStartsOperand =
    nextNonWhitespace !== null &&
    (!isOperator(nextNonWhitespace) || UNARY_OPERATORS.includes(nextNonWhitespace));

  // Determine if the operator should be treated as unary or binary
  if (UNARY_OPERATORS.includes(operator) && isUnaryContext(state)) {
    // Unary operator check starting at state.currentIndex
    if (!nextStartsOperand) {
      throw new TokenizerError(`Unary operator ${operator} missing operand`);
    }
  } else if (BINARY_OPERATORS.includes(operator)) {
    // Binary operator check starting at state.currentIndex
    if (state.tokens.length === 0) {
      /* istanbul ignore next */
      throw new TokenizerError(`Operator ${operator} missing left operand`);
    }
    if (!nextStartsOperand) {
      throw new TokenizerError(`Operator ${operator} missing right operand`);
    }
  }
}

/**
 * Find the next non-whitespace character in the expression
 */
function findNextNonWhitespace(expression: string, startIndex: number): string | null {
  for (let i = startIndex; i < expression.length; i++) {
    if (!isWhitespace(expression[i])) {
      return expression[i];
    }
  }
  return null;
}

export function tokenize(
  expression: string,
  logger: Logger,
  options: TokenizeOptions = {},
): Token[] {
  if (!expression || expression.trim() === '') {
    throw new TokenizerError('Expression cannot be empty');
  }
  return tokenizeExpression(expression, logger, options);
}

function handleNumber(state: TokenizerState): Token {
  const _startIndex = state.currentIndex;
  let numberStr = '';

  while (state.currentIndex < state.expression.length) {
    checkTokenizeTimeout(state, state.currentIndex);
    const char = state.expression[state.currentIndex];
    if (!isDigit(char) && char !== '.') {
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

/**
 * Flush text buffer and add token to the provided array
 */
function flushBufferToArray(
  textBuffer: string,
  tokensArray: Token[],
  inBraces: boolean = false,
  rawText: string = textBuffer,
): void {
  if (!textBuffer || textBuffer.trim() === '') {
    return;
  }

  tokensArray.push(createTokenFromContent(textBuffer, inBraces, rawText));
}

/**
 * Check if the current position starts a template expression ${...}
 */
function isTemplateExpression(expression: string, index: number): boolean {
  return (
    expression[index] === '$' && index + 1 < expression.length && expression[index + 1] === '{'
  );
}

function handleReference(state: TokenizerState): Token {
  const _startIndex = state.currentIndex;
  state.currentIndex += 2; // Skip ${

  const referenceTokens: Token[] = [];
  let textBuffer = '';
  let bracketCount = 1;
  let inOperator = false;

  while (state.currentIndex < state.expression.length) {
    checkTokenizeTimeout(state, state.currentIndex);
    const char = state.expression[state.currentIndex];

    if (char === '{') {
      bracketCount++;
      flushBufferToArray(textBuffer, referenceTokens);
      textBuffer = '';
      state.currentIndex++;
      continue;
    }

    if (char === '}') {
      bracketCount--;
      if (bracketCount === 0) {
        flushBufferToArray(textBuffer, referenceTokens);
        state.currentIndex++;
        return {
          type: 'reference',
          value: referenceTokens,
          raw: state.expression.substring(_startIndex, state.currentIndex),
        };
      }
      /* istanbul ignore next */
      state.currentIndex++;
      /* istanbul ignore next */
      continue;
    }

    if (char === '[') {
      flushBufferToArray(textBuffer, referenceTokens);
      textBuffer = '';
      referenceTokens.push(createPunctuationToken('['));
      state.currentIndex++;
      continue;
    }

    if (char === ']') {
      flushBufferToArray(textBuffer, referenceTokens);
      textBuffer = '';
      referenceTokens.push(createPunctuationToken(']'));
      state.currentIndex++;
      continue;
    }

    if (isOperator(char)) {
      flushBufferToArray(textBuffer, referenceTokens);
      textBuffer = '';
      referenceTokens.push({
        type: 'operator',
        value: char,
        raw: char,
      });
      state.currentIndex++;
      inOperator = true;
      continue;
    }

    if (isQuote(char)) {
      flushBufferToArray(textBuffer, referenceTokens);
      textBuffer = '';
      const stringToken = handleStringLiteral(state, char);
      referenceTokens.push(stringToken);
      continue;
    }

    if (isTemplateExpression(state.expression, state.currentIndex)) {
      flushBufferToArray(textBuffer, referenceTokens);
      textBuffer = '';
      const nestedRef = handleReference(state);
      referenceTokens.push(nestedRef);
      continue;
    }

    if (isWhitespace(char)) {
      if (textBuffer && !inOperator) {
        flushBufferToArray(textBuffer, referenceTokens);
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

/**
 * Check if the current position starts a spread operator
 */
function isSpreadOperator(expression: string, index: number): boolean {
  return (
    expression[index] === '.' &&
    index + 2 < expression.length &&
    expression[index + 1] === '.' &&
    expression[index + 2] === '.'
  );
}

function handleOperator(state: TokenizerState): Token {
  const _startIndex = state.currentIndex;
  const char = state.expression[state.currentIndex];

  // Handle spread operator
  if (isSpreadOperator(state.expression, state.currentIndex)) {
    state.currentIndex += 3;
    return createOperatorToken('...');
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
      return createOperatorToken(operator);
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
      return createOperatorToken(operator);
    }
  }

  // Handle single-character operators
  state.currentIndex++;
  validateOperatorSequence(state, operator);
  return createOperatorToken(operator);
}

function handleStringLiteral(state: TokenizerState, quote: string): Token {
  const _startIndex = state.currentIndex;
  let value = '';

  state.currentIndex++; // Skip opening quote

  while (state.currentIndex < state.expression.length) {
    checkTokenizeTimeout(state, state.currentIndex);
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
        raw: state.expression.substring(_startIndex, state.currentIndex),
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
    checkTokenizeTimeout(state, state.currentIndex);
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
      if (isTemplateExpression(state.expression, state.currentIndex + 1)) {
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
        checkTokenizeTimeout(state, state.currentIndex);
        const current = state.expression[state.currentIndex];
        if (current === '{') bracketCount++;
        if (current === '}') bracketCount--;
        state.currentIndex++;
      }

      if (bracketCount > 0) {
        /* istanbul ignore next */
        throw new TokenizerError('Unterminated expression in template literal');
      }

      const expressionContent = state.expression.substring(
        expressionStartIndex,
        state.currentIndex - 1,
      );
      const expressionTokens = tokenizeExpression(expressionContent, state.logger, {
        startTime: state.startTime,
        timeoutMs: state.timeoutMs,
        step: state.step,
        stepType: state.stepType,
      });

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

function handleObjectLiteral(state: TokenizerState): Token {
  const _startIndex = state.currentIndex;
  state.currentIndex++; // Skip opening brace

  const objectTokens: Token[] = [];
  state.textBuffer = '';
  let _expectingValue = true;
  let _expectingKey = true;

  while (state.currentIndex < state.expression.length) {
    checkTokenizeTimeout(state, state.currentIndex);
    const char = state.expression[state.currentIndex];

    if (isQuote(char) && char !== '`') {
      flushBufferToArray(state.textBuffer, objectTokens, false, state.textBuffer);
      state.textBuffer = '';
      const stringToken = handleStringLiteral(state, char);
      objectTokens.push(stringToken);
      continue;
    }

    if (isWhitespace(char)) {
      flushBufferToArray(state.textBuffer, objectTokens, false, state.textBuffer);
      state.textBuffer = '';
      state.currentIndex++;
      continue;
    }

    if (char === '}') {
      flushBufferToArray(state.textBuffer, objectTokens, false, state.textBuffer);
      state.currentIndex++;
      return {
        type: 'object_literal',
        value: objectTokens,
        raw: state.expression.substring(_startIndex, state.currentIndex),
      };
    }

    if (char === ':') {
      if (state.textBuffer) {
        // For object keys, always use string type
        objectTokens.push({
          type: 'string',
          value: state.textBuffer.trim(),
          raw: state.textBuffer,
        });
        state.textBuffer = '';
      }
      objectTokens.push(createPunctuationToken(':'));
      _expectingKey = false;
      _expectingValue = true;
      state.currentIndex++;
      continue;
    }

    if (char === ',') {
      flushBufferToArray(state.textBuffer, objectTokens, false, state.textBuffer);
      state.textBuffer = '';
      objectTokens.push(createPunctuationToken(','));
      _expectingKey = true;
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
        objectTokens.push(createTokenFromContent(state.textBuffer, false, state.textBuffer));
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

    if (isSpreadOperator(state.expression, state.currentIndex)) {
      /* istanbul ignore next */
      throw new Error('suspected dead code path hit. Please open a ticket if you see this.');
    }

    if (char === '$') {
      flushBufferToArray(state.textBuffer, objectTokens, false, state.textBuffer);
      state.textBuffer = '';
      const reference = handleReference(state);
      objectTokens.push(reference);
      _expectingValue = false;
      continue;
    }

    if (char === '{') {
      flushBufferToArray(state.textBuffer, objectTokens, false, state.textBuffer);
      state.textBuffer = '';
      const nestedObject = handleObjectLiteral(state);
      objectTokens.push(nestedObject);
      _expectingValue = false;
      continue;
    }

    if (char === '[') {
      flushBufferToArray(state.textBuffer, objectTokens, false, state.textBuffer);
      state.textBuffer = '';
      const array = handleArrayLiteral(state);
      objectTokens.push(array);
      _expectingValue = false;
      continue;
    }

    if (char === '`') {
      flushBufferToArray(state.textBuffer, objectTokens, false, state.textBuffer);
      state.textBuffer = '';
      const template = handleTemplateLiteral(state);
      objectTokens.push(...template);
      _expectingValue = false;
      continue;
    }

    if (isDigit(char) && state.textBuffer === '') {
      const number = handleNumber(state);
      objectTokens.push(number);
      _expectingValue = false;
      continue;
    }

    state.textBuffer += char;
    state.currentIndex++;
  }

  /* istanbul ignore next */
  throw new TokenizerError('Unterminated object literal');
}

function handleArrayLiteral(state: TokenizerState): Token {
  const _startIndex = state.currentIndex;
  state.currentIndex++; // Skip opening bracket

  const arrayTokens: Token[] = [];
  state.textBuffer = '';
  let bracketCount = 1;

  while (state.currentIndex < state.expression.length) {
    checkTokenizeTimeout(state, state.currentIndex);
    const char = state.expression[state.currentIndex];

    if (char === '[') {
      bracketCount++;
      flushBufferToArray(state.textBuffer, arrayTokens);
      state.textBuffer = '';
      const nestedArray = handleArrayLiteral(state);
      arrayTokens.push(nestedArray);
      bracketCount--; // Decrement bracket count since nested array is complete
      continue;
    }

    if (char === ']') {
      bracketCount--;
      if (bracketCount === 0) {
        flushBufferToArray(state.textBuffer, arrayTokens);
        state.textBuffer = '';
        state.currentIndex++;
        return {
          type: 'array_literal',
          value: arrayTokens,
          raw: state.expression.substring(_startIndex, state.currentIndex),
        };
      }
      /* istanbul ignore next */
      state.currentIndex++;
      /* istanbul ignore next */
      continue;
    }

    if (isSpreadOperator(state.expression, state.currentIndex)) {
      flushBufferToArray(state.textBuffer, arrayTokens);
      state.textBuffer = '';
      arrayTokens.push(createOperatorToken('...'));
      state.currentIndex += 3;
      continue;
    }

    if (char === ',') {
      flushBufferToArray(state.textBuffer, arrayTokens);
      state.textBuffer = '';
      arrayTokens.push(createPunctuationToken(','));
      state.currentIndex++;
      continue;
    }

    if (char === '$') {
      flushBufferToArray(state.textBuffer, arrayTokens);
      state.textBuffer = '';
      const reference = handleReference(state);
      arrayTokens.push(reference);
      continue;
    }

    if (char === '{') {
      flushBufferToArray(state.textBuffer, arrayTokens);
      state.textBuffer = '';
      const object = handleObjectLiteral(state);
      arrayTokens.push(object);
      continue;
    }

    if (isDigit(char) && state.textBuffer === '') {
      const number = handleNumber(state);
      arrayTokens.push(number);
      continue;
    }

    // Handle string literals inside array literals
    if (isQuote(char) && char !== '`') {
      flushBufferToArray(state.textBuffer, arrayTokens);
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

function tokenizeExpression(expression: string, logger: Logger, options: TokenizeOptions): Token[] {
  const state = createTokenizerState(expression, logger, options);
  const _expectingValue = true;
  let inTextSequence = false;
  let inBraces = false;

  while (state.currentIndex < expression.length) {
    checkTokenizeTimeout(state, state.currentIndex);
    const char = expression[state.currentIndex];

    if (isQuote(char) && char !== '`') {
      flushBufferToArray(state.textBuffer, state.tokens, inBraces);
      state.textBuffer = '';
      const stringToken = handleStringLiteral(state, char);
      state.tokens.push(stringToken);
      continue;
    }

    if (char === '`') {
      flushBufferToArray(state.textBuffer, state.tokens, inBraces);
      state.textBuffer = '';
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
      flushBufferToArray(state.textBuffer, state.tokens, inBraces);
      state.textBuffer = '';
      inTextSequence = false;

      if (char === '{') {
        // Check if this is an object literal by looking ahead for key-value pairs or spread operator
        let isObjectLiteral = false;
        let lookAhead = state.currentIndex + 1;
        let depth = 1;

        while (lookAhead < expression.length && depth > 0) {
          checkTokenizeTimeout(state, lookAhead);
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
              checkTokenizeTimeout(state, lookAhead);
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
        state.tokens.push(createPunctuationToken('}'));
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
          flushBufferToArray(state.textBuffer, state.tokens, inBraces);
          state.textBuffer = '';
          inTextSequence = true;
        }
        state.textBuffer += char;
      } else {
        flushBufferToArray(state.textBuffer, state.tokens, inBraces);
        state.textBuffer = '';
      }
      state.currentIndex++;
      continue;
    }

    if (char === '$') {
      flushBufferToArray(state.textBuffer, state.tokens, inBraces);
      state.textBuffer = '';
      inTextSequence = false;
      state.tokens.push(handleReference(state));
      continue;
    }

    state.textBuffer += char;
    state.currentIndex++;
  }

  flushBufferToArray(state.textBuffer, state.tokens, inBraces);

  return state.tokens;
}

/**
 * Utility function to create a token based on text content
 * Handles common pattern of determining token type from content
 */
function createTokenFromContent(
  text: string,
  inBraces: boolean = false,
  rawText: string = text,
): Token {
  const trimmedText = text.trim();

  // Determine token type based on content
  if (/^-?\d+(\.\d+)?$/.test(trimmedText)) {
    return {
      type: 'number',
      value: Number(trimmedText),
      raw: rawText,
    };
  } else if (inBraces) {
    return {
      type: 'string',
      value: text,
      raw: rawText,
    };
  } else {
    return {
      type: 'identifier',
      value: trimmedText,
      raw: rawText,
    };
  }
}

// Helper function for simple operator tokens
function createOperatorToken(operator: string): Token {
  return {
    type: 'operator',
    value: operator,
    raw: operator,
  };
}

// Helper function for simple punctuation tokens
function createPunctuationToken(value: string): Token {
  return {
    type: 'punctuation',
    value,
    raw: value,
  };
}
