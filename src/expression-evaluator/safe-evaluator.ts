import { Logger } from '../util/logger';
import { ExpressionError } from '../expression-evaluator/errors';
import { ReferenceResolver } from '../reference-resolver';
import { PathSyntaxError, PropertyAccessError } from '../path-accessor';
import { UnknownReferenceError } from '../reference-resolver';
import { tokenize, Token } from './tokenizer';
import { TokenizerError } from './tokenizer';

type Operator = keyof typeof SafeExpressionEvaluator.OPERATORS;

interface AstNode {
  type: 'literal' | 'reference' | 'operation' | 'object' | 'array';
  value?: any;
  path?: string;
  operator?: Operator;
  left?: AstNode;
  right?: AstNode;
  properties?: { key: string; value: AstNode; spread?: boolean }[];
  elements?: { value: AstNode; spread?: boolean }[];
}

export class SafeExpressionEvaluator {
  private static readonly MAX_EXPRESSION_LENGTH = 1000;
  private TIMEOUT_MS = 1000;
  private logger: Logger;

  public static readonly OPERATORS = {
    '+': (a: any, b: any) => {
      if (typeof a === 'string' || typeof b === 'string') {
        return String(a) + String(b);
      }
      if (typeof a !== 'number' || typeof b !== 'number') {
        throw new ExpressionError(`Cannot perform addition on non-numeric values: ${a} + ${b}`);
      }
      return a + b;
    },
    '-': (a: any, b: any) => {
      if (typeof a !== 'number' || typeof b !== 'number') {
        throw new ExpressionError(`Cannot perform subtraction on non-numeric values: ${a} - ${b}`);
      }
      return a - b;
    },
    '*': (a: any, b: any) => {
      if (typeof a !== 'number' || typeof b !== 'number') {
        throw new ExpressionError(
          `Cannot perform multiplication on non-numeric values: ${a} * ${b}`,
        );
      }
      return a * b;
    },
    '/': (a: any, b: any) => {
      if (typeof a !== 'number' || typeof b !== 'number') {
        throw new ExpressionError(`Cannot perform division on non-numeric values: ${a} / ${b}`);
      }
      if (b === 0) {
        throw new Error('Failed to evaluate operation /');
      }
      return a / b;
    },
    '%': (a: any, b: any) => {
      if (typeof a !== 'number' || typeof b !== 'number') {
        throw new ExpressionError(`Cannot perform modulo on non-numeric values: ${a} % ${b}`);
      }
      if (b === 0) {
        throw new Error('Failed to evaluate operation %');
      }
      return a % b;
    },
    '==': (a: any, b: any) => a == b,
    '===': (a: any, b: any) => a === b,
    '!=': (a: any, b: any) => a != b,
    '!==': (a: any, b: any) => a !== b,
    '>': (a: any, b: any) => {
      if (typeof a !== typeof b) {
        throw new ExpressionError(`Cannot compare values of different types: ${a} > ${b}`);
      }
      return a > b;
    },
    '>=': (a: any, b: any) => {
      if (typeof a !== typeof b) {
        throw new ExpressionError(`Cannot compare values of different types: ${a} >= ${b}`);
      }
      return a >= b;
    },
    '<': (a: any, b: any) => {
      if (typeof a !== typeof b) {
        throw new ExpressionError(`Cannot compare values of different types: ${a} < ${b}`);
      }
      return a < b;
    },
    '<=': (a: any, b: any) => {
      if (typeof a !== typeof b) {
        throw new ExpressionError(`Cannot compare values of different types: ${a} <= ${b}`);
      }
      return a <= b;
    },
    '&&': (a: any, b: any) => a && b,
    '||': (a: any, b: any) => a || b,
    '??': (a: any, b: any) => a ?? b,
  } as const;

  constructor(
    logger: Logger,
    private referenceResolver: ReferenceResolver,
  ) {
    this.logger = logger.createNested('SafeExpressionEvaluator');
  }

  evaluate(expression: string, context: Record<string, any>): any {
    this.logger.debug('Evaluating expression:', expression);
    this.logger.debug('Context:', JSON.stringify(context, null, 2));
    this.validateExpression(expression);
    const startTime = Date.now();
    this.logger.debug(`Expression validated at: ${startTime}`);
    try {
      this.checkTimeout(startTime);

      // Handle simple literals directly
      if (/^-?\d+(\.\d+)?$/.test(expression)) {
        this.logger.debug('Evaluating numeric literal:', expression);
        return Number(expression);
      }
      if (expression === 'true') {
        this.logger.debug('Evaluating boolean literal: true');
        return true;
      }
      if (expression === 'false') {
        this.logger.debug('Evaluating boolean literal: false');
        return false;
      }
      if (expression === 'null') {
        this.logger.debug('Evaluating null literal');
        return null;
      }
      if (expression === 'undefined') {
        this.logger.debug('Evaluating undefined literal');
        return undefined;
      }

      // Handle array literals with references
      if (expression.trim().startsWith('[') && expression.trim().endsWith(']')) {
        this.logger.debug('Found array literal with references:', expression);
        // First resolve any references in the expression
        const resolvedExpression = expression.replace(/\${([^}]+)}/g, (match, path) => {
          try {
            const value = this.referenceResolver.resolvePath(path, context);
            return JSON.stringify(value);
          } catch (error) {
            this.logger.error('Error resolving reference in array literal:', error);
            if (error instanceof PropertyAccessError) {
              throw new ExpressionError(error.message);
            }
            throw error;
          }
        });

        // Then tokenize and parse as normal
        const tokens = tokenize(resolvedExpression, this.logger);
        this.logger.debug('Tokens:', tokens);
        const ast = this.parse(tokens);
        this.logger.debug('AST:', ast);
        return this.evaluateAst(ast, context, startTime);
      }

      // Handle object literals with references
      if (expression.trim().startsWith('{') && expression.trim().endsWith('}')) {
        this.logger.debug('Found object literal with references:', expression);
        // First resolve any references in the expression
        const resolvedExpression = expression.replace(/\${([^}]+)}/g, (match, path) => {
          try {
            const value = this.referenceResolver.resolvePath(path, context);
            return JSON.stringify(value);
          } catch (error) {
            this.logger.error('Error resolving reference in object literal:', error);
            if (error instanceof PropertyAccessError) {
              throw new ExpressionError(error.message);
            }
            throw error;
          }
        });

        // Then tokenize and parse as normal
        const tokens = tokenize(resolvedExpression, this.logger);
        this.logger.debug('Tokens:', tokens);
        const ast = this.parse(tokens);
        this.logger.debug('AST:', ast);
        return this.evaluateAst(ast, context, startTime);
      }

      // Handle string literals with references
      if (expression.includes('${')) {
        // If it's a single reference expression (e.g., ${context.config.threshold})
        if (
          expression.startsWith('${') &&
          expression.endsWith('}') &&
          expression.indexOf('${', 2) === -1
        ) {
          const path = expression.slice(2, -1);
          try {
            return this.referenceResolver.resolvePath(path, context);
          } catch (error: any) {
            this.logger.error('Error resolving reference:', error);
            // Re-throw UnknownReferenceError and PropertyAccessError as is
            if (error instanceof UnknownReferenceError || error instanceof PropertyAccessError) {
              throw error;
            }
            throw new ExpressionError(error.message);
          }
        }

        // If it's an expression containing references (e.g., ${context.config.threshold} > 50 or ${step1.data.value} * 2)
        if (
          /\${[^}]+}(?:\s*[><=!+\-*/%]+\s*(?:\d+|"[^"]*"|'[^']*'|\${[^}]+}|\btrue\b|\bfalse\b))/.test(
            expression,
          )
        ) {
          const resolvedExpression = expression.replace(/\${([^}]+)}/g, (match, path) => {
            try {
              const value = this.referenceResolver.resolvePath(path, context);
              if (typeof value === 'string') {
                return `"${value}"`;
              }
              return String(value);
            } catch (error: any) {
              this.logger.error('Error resolving reference in expression:', error);
              if (error instanceof PropertyAccessError) {
                throw new ExpressionError(error.message);
              }
              throw error;
            }
          });
          const tokens = tokenize(resolvedExpression, this.logger);
          this.logger.debug('Tokens:', tokens);
          const ast = this.parse(tokens);
          this.logger.debug('AST:', ast);
          return this.evaluateAst(ast, context, startTime);
        }

        // Otherwise, treat it as a template literal
        this.logger.debug('Found template literal:', expression);
        return expression.replace(/\${([^}]+)}/g, (match, path) => {
          try {
            const value = this.referenceResolver.resolvePath(path, context);
            return String(value);
          } catch (error: any) {
            this.logger.error('Error resolving reference in template literal:', error);
            if (error instanceof PropertyAccessError) {
              throw new ExpressionError(error.message);
            }
            throw error;
          }
        });
      }

      const tokens = tokenize(expression, this.logger);
      this.logger.debug('Tokens:', tokens);
      const ast = this.parse(tokens);
      this.logger.debug('AST:', ast);
      return this.evaluateAst(ast, context, startTime);
    } catch (error) {
      this.logger.error('Error evaluating expression:', error);
      // Re-throw UnknownReferenceError and PropertyAccessError as is
      if (
        error instanceof ExpressionError ||
        error instanceof UnknownReferenceError ||
        error instanceof PropertyAccessError
      ) {
        throw error;
      }
      // Wrap TokenizerError in ExpressionError
      if (error instanceof TokenizerError) {
        throw new ExpressionError(
          `Failed to evaluate expression: ${expression}. Got error: ${error.message}`,
        );
      }
      throw new ExpressionError(
        `Failed to evaluate expression: ${expression}. got error: ${error}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private validateExpression(expression: string): void {
    this.logger.debug('Validating expression:', expression);
    if (!expression || typeof expression !== 'string') {
      this.logger.error('Invalid expression: must be a non-empty string');
      throw new ExpressionError('Expression must be a non-empty string');
    }

    if (expression.length > SafeExpressionEvaluator.MAX_EXPRESSION_LENGTH) {
      this.logger.error(
        `Expression length ${expression.length} exceeds maximum of ${SafeExpressionEvaluator.MAX_EXPRESSION_LENGTH} characters`,
      );
      throw new ExpressionError(
        `Expression length exceeds maximum of ${SafeExpressionEvaluator.MAX_EXPRESSION_LENGTH} characters`,
      );
    }

    // Check for potentially dangerous patterns
    const dangerousPatterns = ['eval', 'Function', 'constructor', '__proto__', 'prototype'];
    this.logger.debug('Checking for dangerous patterns');

    for (const pattern of dangerousPatterns) {
      if (expression.includes(pattern)) {
        this.logger.error(`Found forbidden pattern in expression: ${pattern}`);
        throw new ExpressionError(`Expression contains forbidden pattern: ${pattern}`);
      }
    }

    // Validate template literals
    const templateLiteralMatches = expression.match(/\${[^}]*}/g);
    if (templateLiteralMatches) {
      // Check for empty template literals
      if (templateLiteralMatches.some((match) => match === '${}')) {
        throw new ExpressionError('Empty template literal: ${}');
      }
    }

    // Check for unclosed template literal start
    let openCount = 0;
    let closeCount = 0;

    // Count template literal starts and ends, respecting object literals
    for (let i = 0; i < expression.length; i++) {
      if (expression[i] === '{') {
        // Check if it's a template literal start
        if (i > 0 && expression[i - 1] === '$') {
          openCount++;
        }
      } else if (expression[i] === '}') {
        // Only count closing braces that match template literal starts
        if (openCount > closeCount) {
          closeCount++;
        }
      }
    }

    if (openCount !== closeCount) {
      throw new ExpressionError('Malformed template literal: unclosed ${');
    }
  }

  private checkTimeout(startTime: number): void {
    const currentTime = Date.now();
    const elapsedTime = currentTime - startTime;
    this.logger.debug(
      `Checking timeout - elapsed time: ${elapsedTime}ms, timeout: ${this.TIMEOUT_MS}ms`,
    );
    if (elapsedTime > this.TIMEOUT_MS) {
      this.logger.error(`Expression evaluation timed out after ${elapsedTime}ms`);
      throw new ExpressionError('Expression evaluation timed out');
    }
  }

  private parse(tokens: Token[]): AstNode {
    this.logger.debug('Starting to parse tokens:', tokens);
    // Handle parentheses first
    const stack: (Token | string)[][] = [[]];
    let current = stack[0];

    for (const token of tokens) {
      if (token.type === 'punctuation' && token.value === '(') {
        stack.push([]);
        current = stack[stack.length - 1];
      } else if (token.type === 'punctuation' && token.value === ')') {
        if (stack.length === 1) {
          throw new ExpressionError('Unmatched closing parenthesis');
        }
        const completed = stack.pop()!;
        current = stack[stack.length - 1];
        // Parse the contents of the parentheses into an AST node and convert to string
        const innerAst = this.parseTokens(
          completed.map((t) => (typeof t === 'string' ? t : t.value)),
        );
        current.push(`__expr_${JSON.stringify(innerAst)}`);
      } else {
        current.push(token);
      }
    }

    if (stack.length > 1) {
      throw new ExpressionError('Unclosed parenthesis');
    }

    // Convert the final tokens to values for parsing
    const finalTokens = stack[0].map((t) => (typeof t === 'string' ? t : t.value));
    return this.parseTokens(finalTokens);
  }

  private parseTokens(tokens: string[]): AstNode {
    const logger = this.logger.createNested('parseTokens');
    logger.debug('Parsing tokens:', tokens);
    if (tokens.length === 0) {
      logger.error('Empty expression');
      throw new ExpressionError('Empty expression');
    }

    // Handle array literals
    if (tokens[0] === '[') {
      logger.debug('Parsing array literal');
      return this.parseArrayLiteral(tokens);
    }

    // Handle object literals
    if (tokens[0] === '{') {
      logger.debug('Parsing object literal');
      return this.parseObjectLiteral(tokens);
    }

    // Handle special expression tokens
    if (tokens.length === 1) {
      const token = tokens[0];
      if (token.startsWith('__expr_')) {
        logger.debug('Parsing expression:', token);
        return JSON.parse(token.slice(7));
      }
      logger.debug('Parsing value:', token);
      return this.parseValue(token);
    }

    // Find the operator with lowest precedence
    let lowestPrecedenceIndex = -1;
    let lowestPrecedence = Infinity;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.startsWith('__expr_')) continue;

      // Skip operators that are part of a multi-character operator
      if (i < tokens.length - 1) {
        const nextToken = tokens[i + 1];
        const combined = token + nextToken;
        if (
          combined === '===' ||
          combined === '!==' ||
          combined === '==' ||
          combined === '!=' ||
          combined === '>=' ||
          combined === '<=' ||
          combined === '||' ||
          combined === '&&' ||
          combined === '??'
        ) {
          continue;
        }
      }

      const precedence = this.getOperatorPrecedence(token);
      if (precedence > 0 && precedence <= lowestPrecedence) {
        lowestPrecedence = precedence;
        lowestPrecedenceIndex = i;
      }
    }

    if (lowestPrecedenceIndex === -1) {
      // If no operator found, concatenate adjacent tokens with +
      let result = this.parseValue(tokens[0]);
      for (let i = 1; i < tokens.length; i++) {
        const right = this.parseValue(tokens[i]);
        result = {
          type: 'operation',
          operator: '+',
          left: result,
          right,
        };
      }
      return result;
    }

    const operator = tokens[lowestPrecedenceIndex] as Operator;
    const left = tokens.slice(0, lowestPrecedenceIndex);
    const right = tokens.slice(lowestPrecedenceIndex + 1);

    logger.debug(`Parsed operation: ${operator} with left: ${left} and right: ${right}`);
    return {
      type: 'operation',
      operator,
      left: this.parseTokens(left),
      right: this.parseTokens(right),
    };
  }

  private parseObjectLiteral(tokens: string[]): AstNode {
    const logger = this.logger.createNested('parseObjectLiteral');
    logger.debug('Parsing object literal:', tokens);
    if (tokens[0] !== '{' || tokens[tokens.length - 1] !== '}') {
      logger.error('Invalid object literal syntax');
      throw new ExpressionError('Invalid object literal syntax');
    }

    const properties: { key: string; value: AstNode; spread?: boolean }[] = [];
    let i = 1; // Skip opening brace

    while (i < tokens.length - 1) {
      // Stop before closing brace
      logger.debug('Parsing property:', tokens[i]);

      // Handle spread operator
      if (tokens[i] === '...') {
        i++;
        if (i >= tokens.length - 1) {
          logger.error('Invalid spread operator usage: missing value');
          throw new ExpressionError('Invalid spread operator usage: missing value');
        }

        // Get value tokens for the spread
        const valueTokens: string[] = [];
        let braceCount = 0;

        while (i < tokens.length - 1) {
          const token = tokens[i];
          if (token === '{') braceCount++;
          if (token === '}') braceCount--;
          if (token === ',' && braceCount === 0) {
            i++; // Skip the comma
            break;
          }
          valueTokens.push(token);
          i++;
        }

        if (valueTokens.length === 0) {
          logger.error('Invalid spread operator usage: empty value');
          throw new ExpressionError('Invalid spread operator usage: empty value');
        }

        // Parse the spread value
        const value = this.parseTokens(valueTokens);
        properties.push({ key: '', value, spread: true });
        continue;
      }

      // Get key
      const key = tokens[i].endsWith(':') ? tokens[i].slice(0, -1) : tokens[i];
      i++;

      // Skip colon if it's a separate token
      if (tokens[i] === ':') {
        i++;
      }

      if (i >= tokens.length - 1) {
        logger.error('Invalid object literal syntax: missing value');
        throw new ExpressionError('Invalid object literal syntax: missing value');
      }

      // Get value tokens
      const valueTokens: string[] = [];
      let braceCount = 0;

      while (i < tokens.length - 1) {
        const token = tokens[i];
        if (token === '{') braceCount++;
        if (token === '}') braceCount--;
        if (token === ',' && braceCount === 0) {
          i++; // Skip the comma
          break;
        }
        valueTokens.push(token);
        i++;
      }

      if (valueTokens.length === 0) {
        const errorMessage = `Invalid object literal syntax: empty value at key: ${key}`;
        logger.error(errorMessage);
        throw new ExpressionError(errorMessage);
      }

      // Parse value - if it's a single token, try parsing it as a literal first
      let value: AstNode;
      if (valueTokens.length === 1) {
        const token = valueTokens[0];
        if (/^-?\d+(\.\d+)?$/.test(token)) {
          logger.debug('Parsed number:', token);
          value = { type: 'literal', value: Number(token) };
        } else if (token === 'true') {
          logger.debug('Parsed boolean:', token);
          value = { type: 'literal', value: true };
        } else if (token === 'false') {
          logger.debug('Parsed boolean:', token);
          value = { type: 'literal', value: false };
        } else if (token === 'null') {
          logger.debug('Parsed null:', token);
          value = { type: 'literal', value: null };
        } else if (token === 'undefined') {
          logger.debug('Parsed undefined:', token);
          value = { type: 'literal', value: undefined };
        } else if (/^["'].*["']$/.test(token)) {
          logger.debug('Parsed string:', token);
          value = { type: 'literal', value: token.slice(1, -1) };
        } else {
          logger.debug('Parsing nested expression:', valueTokens);
          value = this.parseTokens(valueTokens);
        }
      } else {
        logger.debug('Parsing nested expression:', valueTokens);
        value = this.parseTokens(valueTokens);
      }

      properties.push({ key, value });
    }

    logger.debug('Parsed object:', properties);
    return {
      type: 'object',
      properties,
    };
  }

  private parseArrayLiteral(tokens: string[]): AstNode {
    const logger = this.logger.createNested('parseArrayLiteral');
    logger.debug('Parsing array literal:', tokens);
    if (tokens[0] !== '[' || tokens[tokens.length - 1] !== ']') {
      logger.error('Invalid array literal syntax');
      throw new ExpressionError('Invalid array literal syntax');
    }

    const elements: { value: AstNode; spread?: boolean }[] = [];
    let i = 1; // Skip opening bracket

    while (i < tokens.length - 1) {
      // Stop before closing bracket
      logger.debug('Parsing element:', tokens[i]);

      // Handle spread operator
      if (tokens[i] === '...') {
        logger.debug('Found spread operator');
        i++;
        if (i >= tokens.length - 1) {
          logger.error('Invalid spread operator usage: missing value');
          throw new ExpressionError('Invalid spread operator usage: missing value');
        }

        // Get value tokens for the spread
        const valueTokens: string[] = [];
        let braceCount = 0;
        let bracketCount = 0;

        while (i < tokens.length - 1) {
          const token = tokens[i];
          if (token === '{') braceCount++;
          if (token === '}') braceCount--;
          if (token === '[') bracketCount++;
          if (token === ']') bracketCount--;
          if (token === ',' && braceCount === 0 && bracketCount === 0) {
            i++; // Skip the comma
            break;
          }
          valueTokens.push(token);
          i++;
        }

        if (valueTokens.length === 0) {
          logger.error('Invalid spread operator usage: empty value');
          throw new ExpressionError('Invalid spread operator usage: empty value');
        }

        // Parse the spread value
        const value = this.parseTokens(valueTokens);
        elements.push({ value, spread: true });
        continue;
      }

      // Get element tokens
      const elementTokens: string[] = [];
      let braceCount = 0;
      let bracketCount = 0;

      while (i < tokens.length - 1) {
        const token = tokens[i];
        if (token === '{') braceCount++;
        if (token === '}') braceCount--;
        if (token === '[') bracketCount++;
        if (token === ']') bracketCount--;
        if (token === ',' && braceCount === 0 && bracketCount === 0) {
          i++; // Skip the comma
          break;
        }
        elementTokens.push(token);
        i++;
      }

      if (elementTokens.length === 0) {
        logger.error('Invalid array literal syntax: empty element');
        throw new ExpressionError('Invalid array literal syntax: empty element');
      }

      // Parse the element value
      const value = this.parseTokens(elementTokens);
      elements.push({ value });
    }

    logger.debug('Parsed array:', elements);
    return {
      type: 'array',
      elements,
    };
  }

  private getOperatorPrecedence(operator: string): number {
    const precedenceMap: Record<Operator, number> = {
      '||': 1,
      '&&': 2,
      '==': 3,
      '===': 3,
      '!=': 3,
      '!==': 3,
      '<': 4,
      '<=': 4,
      '>': 4,
      '>=': 4,
      '+': 5,
      '-': 5,
      '*': 6,
      '/': 6,
      '%': 6,
      '??': 1,
    };

    return precedenceMap[operator as Operator] || 0;
  }

  private parseValue(token: string): AstNode {
    const logger = this.logger.createNested('parseValue');
    logger.debug('Parsing value:', token);

    // Handle numbers
    if (/^-?\d+(\.\d+)?$/.test(token)) {
      logger.debug('Parsed number:', token);
      return { type: 'literal', value: Number(token) };
    }

    // Handle booleans
    if (token === 'true') {
      logger.debug('Parsed boolean:', token);
      return { type: 'literal', value: true };
    }
    if (token === 'false') {
      logger.debug('Parsed boolean:', token);
      return { type: 'literal', value: false };
    }

    // Handle null
    if (token === 'null') {
      logger.debug('Parsed null:', token);
      return { type: 'literal', value: null };
    }

    // Handle undefined
    if (token === 'undefined') {
      logger.debug('Parsed undefined:', token);
      return { type: 'literal', value: undefined };
    }

    // Handle strings
    if (/^["'].*["']$/.test(token)) {
      logger.debug('Parsed string:', token);
      return { type: 'literal', value: token.slice(1, -1) };
    }

    // Check for unknown operators
    if (token.match(/^[+\-*/%=!<>&|?@]+$/)) {
      logger.error(`Unknown operator: ${token}`);
      throw new ExpressionError(`Unknown operator: ${token}`);
    }

    // Handle references - strip ${} syntax if present
    if (token.startsWith('${') && token.endsWith('}')) {
      const path = token.slice(2, -1);
      logger.debug('Parsed reference:', path);
      return { type: 'reference', path };
    }

    // Handle string literals with references
    if (token.includes('${')) {
      logger.debug('Parsed string with references:', token);
      return { type: 'literal', value: token };
    }

    // Handle plain text as string literals
    logger.debug('Parsed plain text as string:', token);
    return { type: 'literal', value: token };
  }

  private evaluateAst(ast: AstNode, context: Record<string, unknown>, startTime: number): unknown {
    const logger = this.logger.createNested('evaluateAst');
    logger.debug('Evaluating AST node:', { ...ast });
    this.checkTimeout(startTime);

    if (ast.type === 'literal') {
      logger.debug('Evaluating literal value:', ast.value);
      // If the literal is a string, check for references to interpolate
      if (typeof ast.value === 'string' && ast.value.includes('${')) {
        logger.debug('Found reference in string literal, interpolating:', ast.value);
        // Replace all ${...} references with their evaluated values
        return ast.value.replace(/\${([^}]+)}/g, (match, path) => {
          try {
            const value = this.referenceResolver.resolvePath(path, context);
            logger.debug(`Interpolated reference ${path} with value:`, value);
            return String(value);
          } catch (error) {
            logger.error(`Error resolving reference ${path} in string:`, error);
            throw error;
          }
        });
      }
      return ast.value;
    }

    if (ast.type === 'reference') {
      logger.debug('Evaluating reference path:', ast.path);
      if (!ast.path) {
        logger.error('Internal error: Reference node missing path');
        throw new ExpressionError('Internal error: Reference node missing path');
      }
      try {
        const value = this.referenceResolver.resolvePath(ast.path, context);
        logger.debug(`Resolved reference ${ast.path} to value:`, value);
        return value;
      } catch (error) {
        logger.error(`Error resolving reference ${ast.path}:`, error);
        if (
          error instanceof PathSyntaxError ||
          error instanceof PropertyAccessError ||
          error instanceof UnknownReferenceError
        ) {
          throw new ExpressionError(`Failed to resolve reference: ${ast.path}`, error);
        }
        throw error;
      }
    }

    if (ast.type === 'object') {
      logger.debug('Evaluating object:', ast.properties);
      if (!ast.properties) {
        logger.error('Internal error: Object node missing properties');
        throw new ExpressionError('Internal error: Object node missing properties');
      }
      const result: Record<string, any> = {};
      for (const { key, value, spread } of ast.properties) {
        if (spread) {
          const spreadValue = this.evaluateAst(value, context, startTime);
          if (spreadValue && typeof spreadValue === 'object') {
            Object.assign(result, spreadValue);
          } else {
            logger.error('Invalid spread operator usage: can only spread objects');
            throw new ExpressionError('Invalid spread operator usage: can only spread objects');
          }
        } else {
          result[key] = this.evaluateAst(value, context, startTime);
        }
      }
      return result;
    }

    if (ast.type === 'array') {
      logger.debug('Evaluating array:', ast.elements);
      if (!ast.elements) {
        logger.error('Internal error: Array node missing elements');
        throw new ExpressionError('Internal error: Array node missing elements');
      }

      const result: unknown[] = [];
      for (const element of ast.elements) {
        const value = element.value;
        if (element.spread) {
          const spreadValue = this.evaluateAst(value, context, startTime);
          if (Array.isArray(spreadValue)) {
            result.push(...spreadValue);
          } else if (spreadValue && typeof spreadValue === 'object') {
            result.push(...Object.values(spreadValue));
          } else {
            logger.error('Invalid spread operator usage:', spreadValue);
            throw new ExpressionError(
              'Invalid spread operator usage: can only spread arrays and objects',
            );
          }
        } else {
          result.push(this.evaluateAst(value, context, startTime));
        }
      }
      return result;
    }

    if (ast.type === 'operation') {
      logger.debug('Evaluating operation:', ast.operator);
      if (!ast.operator || !ast.left || !ast.right) {
        logger.error('Internal error: Operation node missing operator or operands');
        throw new ExpressionError('Internal error: Operation node missing operator or operands');
      }

      const operator = SafeExpressionEvaluator.OPERATORS[ast.operator];
      if (!operator) {
        logger.error(`Unknown operator: ${ast.operator}`);
        throw new ExpressionError(`Unknown operator: ${ast.operator}`);
      }

      const left = this.evaluateAst(ast.left, context, startTime);
      const right = this.evaluateAst(ast.right, context, startTime);

      try {
        logger.debug(`Evaluating operation ${ast.operator}:`, { left, right });
        const result = operator(left, right);
        logger.debug(`Operation result:`, result);
        return result;
      } catch (error) {
        logger.error(`Failed to evaluate operation ${ast.operator} with operands:`, {
          left,
          right,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        throw new ExpressionError(
          `Failed to evaluate operation ${ast.operator}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    throw new ExpressionError(`Unknown AST node type: ${ast.type}`);
  }

  /**
   * Extract all references from an expression without evaluating it.
   * This is useful for dependency analysis.
   * @param expression The expression to extract references from
   * @returns An array of reference paths found in the expression
   */
  public extractReferences(expression: string): string[] {
    try {
      const refs = new Set<string>();
      
      // Handle spread operator syntax directly
      const spreadMatches = expression.match(/\.\.\.\${([^}]+)}/g);
      if (spreadMatches) {
        spreadMatches.forEach(match => {
          const ref = match.slice(5, -1); // Remove ...${} wrapper
          const baseRef = ref.split('.')[0]; // Get the base reference
          if (!this.isSpecialVariable(baseRef)) {
            refs.add(baseRef);
          }
        });
      }

      // Handle regular references through AST
      const tokens = tokenize(expression, this.logger);
      const ast = this.parse(tokens);
      this.collectReferencesFromAst(ast, refs);
      return Array.from(refs).sort(); // Sort references for consistent order
    } catch (error) {
      // Return empty array for invalid expressions
      return [];
    }
  }

  private collectReferencesFromAst(node: AstNode, refs: Set<string>): void {
    switch (node.type) {
      case 'reference':
        if (node.path) {
          // Extract base reference and any nested references in array indices
          const baseRef = node.path.split('.')[0];
          if (!this.isSpecialVariable(baseRef)) {
            refs.add(baseRef);
          }
          
          // Extract references from array indices
          const arrayIndexMatches = node.path.match(/\${([^}]+)}/g);
          if (arrayIndexMatches) {
            arrayIndexMatches.forEach(match => {
              const innerRef = match.slice(2, -1).split('.')[0];
              if (!this.isSpecialVariable(innerRef)) {
                refs.add(innerRef);
              }
            });
          }
        }
        break;

      case 'operation':
        if (node.left) this.collectReferencesFromAst(node.left, refs);
        if (node.right) this.collectReferencesFromAst(node.right, refs);
        break;

      case 'object':
        if (node.properties) {
          node.properties.forEach(prop => {
            // Handle spread operator in object properties
            if (prop.spread) {
              if (prop.value.type === 'reference') {
                const baseRef = prop.value.path?.split('.')[0];
                if (baseRef && !this.isSpecialVariable(baseRef)) {
                  refs.add(baseRef);
                }
              }
              // Also collect any nested references in the spread value
              this.collectReferencesFromAst(prop.value, refs);
            } else {
              this.collectReferencesFromAst(prop.value, refs);
            }
          });
        }
        break;

      case 'array':
        if (node.elements) {
          node.elements.forEach(element => {
            // Handle spread operator in array elements
            if (element.spread) {
              if (element.value.type === 'reference') {
                const baseRef = element.value.path?.split('.')[0];
                if (baseRef && !this.isSpecialVariable(baseRef)) {
                  refs.add(baseRef);
                }
              }
              // Also collect any nested references in the spread value
              this.collectReferencesFromAst(element.value, refs);
            } else {
              this.collectReferencesFromAst(element.value, refs);
            }
          });
        }
        break;
    }
  }

  /**
   * Check if a variable name is a special variable that should be ignored
   */
  private isSpecialVariable(name: string): boolean {
    return ['context', 'metadata', 'item', 'acc', 'a', 'b'].includes(name);
  }
}
