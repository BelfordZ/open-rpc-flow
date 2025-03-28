import { Logger } from '../util/logger';
import { ExpressionError } from '../expression-evaluator/errors';
import { ReferenceResolver } from '../reference-resolver';
import { PathSyntaxError, PropertyAccessError } from '../path-accessor';
import { tokenize, Token } from './tokenizer';
import { TokenizerError } from './tokenizer';

type Operator = keyof typeof SafeExpressionEvaluator.OPERATORS;
type StackOperator = Operator | '(' | ')';

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

export class _UnknownReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownReferenceError';
  }
}

export class SafeExpressionEvaluator {
  private static readonly MAX_EXPRESSION_LENGTH = 1000;
  private TIMEOUT_MS = 1000;
  private logger: Logger;

  // Helper functions for operators
  private static ensureNumbers(a: any, b: any, operation: string): void {
    if (typeof a !== 'number' || typeof b !== 'number') {
      throw new ExpressionError(
        `Cannot perform ${operation} on non-numeric values: ${a} ${operation} ${b}`,
      );
    }
  }

  private static ensureSameType(a: any, b: any, operation: string): void {
    if (typeof a !== typeof b) {
      throw new ExpressionError(`Cannot compare values of different types: ${a} ${operation} ${b}`);
    }
  }

  private static checkDivisionByZero(b: any): void {
    if (b === 0) {
      throw new ExpressionError('Division/modulo by zero');
    }
  }

  public static readonly OPERATORS = {
    '+': (a: any, b: any) => {
      if (typeof a === 'string' || typeof b === 'string') {
        return String(a) + String(b);
      }
      SafeExpressionEvaluator.ensureNumbers(a, b, '+');
      return a + b;
    },
    '-': (a: any, b: any) => {
      SafeExpressionEvaluator.ensureNumbers(a, b, '-');
      return a - b;
    },
    '*': (a: any, b: any) => {
      SafeExpressionEvaluator.ensureNumbers(a, b, '*');
      return a * b;
    },
    '/': (a: any, b: any) => {
      SafeExpressionEvaluator.ensureNumbers(a, b, '/');
      SafeExpressionEvaluator.checkDivisionByZero(b);
      return a / b;
    },
    '%': (a: any, b: any) => {
      SafeExpressionEvaluator.ensureNumbers(a, b, '%');
      SafeExpressionEvaluator.checkDivisionByZero(b);
      return a % b;
    },
    '==': (a: any, b: any) => a == b,
    '===': (a: any, b: any) => a === b,
    '!=': (a: any, b: any) => a != b,
    '!==': (a: any, b: any) => a !== b,
    '>': (a: any, b: any) => {
      SafeExpressionEvaluator.ensureSameType(a, b, '>');
      return a > b;
    },
    '>=': (a: any, b: any) => {
      SafeExpressionEvaluator.ensureSameType(a, b, '>=');
      return a >= b;
    },
    '<': (a: any, b: any) => {
      SafeExpressionEvaluator.ensureSameType(a, b, '<');
      return a < b;
    },
    '<=': (a: any, b: any) => {
      SafeExpressionEvaluator.ensureSameType(a, b, '<=');
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
      if (
        /^-?\d+(\.\d+)?$/.test(expression) ||
        ['true', 'false', 'null', 'undefined'].includes(expression)
      ) {
        return this.tokenToLiteral(expression);
      }

      // Tokenize the expression
      const tokens = tokenize(expression, this.logger);
      this.logger.debug('Tokens:', tokens);

      // Handle template literals
      if (expression.startsWith('`') && expression.endsWith('`')) {
        return tokens
          .map((token) => {
            if (token.type === 'string') {
              return token.value;
            }
            if (token.type === 'reference') {
              const path = this.buildReferencePath(token.value);
              try {
                const value = this.referenceResolver.resolvePath(path, context);
                return String(value);
              } catch (error) {
                this.handleReferenceError(error, 'Error resolving reference in template literal');
              }
            }
            throw new ExpressionError(
              `Unexpected token in template literal: ${JSON.stringify(token)}`,
            );
          })
          .join('');
      }

      // Handle single references
      if (tokens.length === 1 && tokens[0].type === 'reference') {
        const path = this.buildReferencePath(tokens[0].value);
        try {
          return this.referenceResolver.resolvePath(path, context);
        } catch (error) {
          this.handleReferenceError(error);
        }
      }

      // Parse and evaluate the AST
      const ast = this.parse(tokens);
      this.logger.debug('AST:', ast);
      return this.evaluateAst(ast, context, startTime);
    } catch (error) {
      if (
        error instanceof TokenizerError ||
        error instanceof PathSyntaxError ||
        error instanceof PropertyAccessError ||
        error instanceof ExpressionError
      ) {
        throw new ExpressionError(
          `Failed to evaluate expression: ${expression}. Got error: ${error.message}`,
        );
      }
      throw error;
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

  /**
   * Helper method to convert token values to JavaScript literal values
   */
  private tokenToLiteral(value: string): any {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (value === 'undefined') return undefined;
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    return value;
  }

  private parse(tokens: Token[]): AstNode {
    if (tokens.length === 0) {
      throw new ExpressionError('Empty expression');
    }

    // Handle literals
    if (tokens.length === 1) {
      const token = tokens[0];
      if (token.type === 'number') {
        return { type: 'literal', value: this.tokenToLiteral(token.value) };
      }
      if (token.type === 'string') {
        return { type: 'literal', value: token.value };
      }
      if (token.type === 'identifier') {
        return { type: 'literal', value: this.tokenToLiteral(token.value) };
      }
      if (token.type === 'reference') {
        return { type: 'reference', path: this.buildReferencePath(token.value) };
      }
      // New: handle object and array literal tokens
      if (token.type === 'object_literal') {
        const properties = this.parseObjectProperties(token.value);
        return { type: 'object', properties };
      }
      if (token.type === 'array_literal') {
        const elements = this.parseArrayElements(token.value);
        return { type: 'array', elements };
      }
    }

    // Handle array literals
    if (tokens[0]?.value === '[' && tokens[tokens.length - 1]?.value === ']') {
      const elements = this.parseArrayElements(tokens.slice(1, -1));
      return { type: 'array', elements };
    }

    // Handle object literals
    if (tokens[0]?.value === '{' && tokens[tokens.length - 1]?.value === '}') {
      const properties = this.parseObjectProperties(tokens.slice(1, -1));
      return { type: 'object', properties };
    }

    // Handle operators with precedence
    return this.parseExpression(tokens);
  }

  private parseExpression(tokens: Token[]): AstNode {
    const operatorStack: StackOperator[] = [];
    const outputQueue: AstNode[] = [];
    let expectOperator = false;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      // Handle parentheses tokens first, regardless of token type
      if (token.value === '(') {
        if (expectOperator) {
          throw new ExpressionError('Unexpected opening parenthesis');
        }
        operatorStack.push('(');
        continue;
      }
      if (token.value === ')') {
        if (!expectOperator) {
          throw new ExpressionError('Unexpected closing parenthesis');
        }
        let foundMatching = false;
        while (operatorStack.length > 0) {
          const operator = operatorStack.pop()!;
          if (operator === '(') {
            foundMatching = true;
            break;
          }
          // Ensure operator is a valid operation operator
          if (operator === ')') {
            throw new ExpressionError('Invalid operator: found closing parenthesis');
          }
          const right = outputQueue.pop()!;
          const left = outputQueue.pop()!;
          outputQueue.push({ type: 'operation', operator: operator as Operator, left, right });
        }
        if (!foundMatching) {
          throw new ExpressionError('Mismatched parentheses');
        }
        continue;
      }

      if (token.type === 'number') {
        if (expectOperator) {
          throw new ExpressionError('Unexpected number');
        }
        outputQueue.push({ type: 'literal', value: this.tokenToLiteral(token.value) });
        expectOperator = true;
      } else if (token.type === 'string') {
        if (expectOperator) {
          throw new ExpressionError('Unexpected string');
        }
        outputQueue.push({ type: 'literal', value: token.value });
        expectOperator = true;
      } else if (token.type === 'identifier') {
        // If the identifier is actually an operator symbol (e.g., '*', '/', '+', '-', etc.), treat it as an operator
        if (
          ['*', '/', '%', '+', '-', '==', '===', '!=', '!==', '>', '>=', '<', '<='].includes(
            token.value,
          )
        ) {
          if (!expectOperator) {
            throw new ExpressionError('Unexpected operator');
          }
          const op = token.value as Operator;
          operatorStack.push(op);
          expectOperator = false;
        } else {
          // Treat as a literal value, converting known keywords to proper types
          if (expectOperator) {
            throw new ExpressionError('Unexpected identifier');
          }
          outputQueue.push({ type: 'literal', value: this.tokenToLiteral(token.value) });
          expectOperator = true;
        }
      } else if (token.type === 'reference') {
        if (expectOperator) {
          throw new ExpressionError('Unexpected reference');
        }
        outputQueue.push({ type: 'reference', path: this.buildReferencePath(token.value) });
        expectOperator = true;
      } else if (
        token.type === 'operator' ||
        ['&&', '||', '??', '==', '===', '!=', '!==', '>', '>=', '<', '<='].includes(token.value)
      ) {
        if (!expectOperator) {
          throw new ExpressionError('Unexpected operator');
        }
        const op = token.value as Operator;
        while (operatorStack.length > 0) {
          const topOperator = operatorStack[operatorStack.length - 1];
          if (topOperator === '(' || topOperator === ')') break;
          if (this.getPrecedence(topOperator as Operator) >= this.getPrecedence(op)) {
            const operator = operatorStack.pop() as Operator;
            const right = outputQueue.pop()!;
            const left = outputQueue.pop()!;
            outputQueue.push({ type: 'operation', operator, left, right });
          } else {
            break;
          }
        }
        operatorStack.push(op);
        expectOperator = false;
      } else {
        throw new ExpressionError(`Unexpected token: ${JSON.stringify(token)}`);
      }
    }

    while (operatorStack.length > 0) {
      const operator = operatorStack.pop()!;
      if (operator === '(' || operator === ')') {
        throw new ExpressionError('Mismatched parentheses');
      }
      const right = outputQueue.pop()!;
      const left = outputQueue.pop()!;
      outputQueue.push({ type: 'operation', operator: operator as Operator, left, right });
    }

    if (outputQueue.length !== 1) {
      throw new ExpressionError('Invalid expression');
    }

    return outputQueue[0];
  }

  private getPrecedence(operator: Operator): number {
    switch (operator) {
      case '||':
        return 1;
      case '&&':
        return 2;
      case '==':
      case '===':
      case '!=':
      case '!==':
        return 3;
      case '<':
      case '<=':
      case '>':
      case '>=':
        return 4;
      case '+':
      case '-':
        return 5;
      case '*':
      case '/':
      case '%':
        return 6;
      case '??':
        return 7;
      default:
        return 0;
    }
  }

  // Helper method to parse grouped elements (arrays and objects)
  private parseGroupedElements(
    tokens: Token[],
    delimiter: string = ',',
    elementProcessor: (currentTokens: Token[], isSpread: boolean, key?: string) => any,
  ): any[] {
    if (tokens.length === 0) return [];

    const result: any[] = [];
    let currentTokens: Token[] = [];
    let depth = 0;
    let isSpread = false;
    let key: string | null = null;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (token.value === delimiter && depth === 0) {
        if (currentTokens.length > 0) {
          result.push(elementProcessor(currentTokens, isSpread, key || undefined));
          currentTokens = [];
          key = null;
          isSpread = false;
        }
        continue;
      }

      if (token.value === ':' && depth === 0 && !isSpread) {
        if (currentTokens.length !== 1) {
          throw new ExpressionError('Invalid object literal: invalid key');
        }
        key = currentTokens[0].value;
        currentTokens = [];
        continue;
      }

      if (token.value === '...' && depth === 0) {
        isSpread = true;
        continue;
      }

      if (token.value === '[' || token.value === '{' || token.value === '(') {
        depth++;
      } else if (token.value === ']' || token.value === '}' || token.value === ')') {
        depth--;
      }

      currentTokens.push(token);
    }

    if (currentTokens.length > 0) {
      result.push(elementProcessor(currentTokens, isSpread, key || undefined));
    }

    return result;
  }

  private parseArrayElements(tokens: Token[]): { value: AstNode; spread?: boolean }[] {
    return this.parseGroupedElements(tokens, ',', (currentTokens, isSpread) => ({
      value: this.parse(currentTokens),
      spread: isSpread,
    }));
  }

  private parseObjectProperties(
    tokens: Token[],
  ): { key: string; value: AstNode; spread?: boolean }[] {
    return this.parseGroupedElements(tokens, ',', (currentTokens, isSpread, key) => {
      if (key === undefined && !isSpread) {
        throw new ExpressionError('Invalid object literal: missing key');
      }
      return {
        key: key || '',
        value: this.parse(currentTokens),
        spread: isSpread,
      };
    });
  }

  private buildReferencePath(tokens: Token[]): string {
    return tokens
      .map((token) => {
        if (token.type === 'operator' && token.value === '.') {
          return '.';
        }
        if (token.type === 'punctuation') {
          if (token.value === '[') return '[';
          if (token.value === ']') return ']';
          return '';
        }
        return token.raw;
      })
      .join('');
  }

  private evaluateAst(ast: AstNode, context: Record<string, unknown>, startTime: number): unknown {
    this.checkTimeout(startTime);

    switch (ast.type) {
      case 'literal':
        return ast.value;

      case 'reference':
        if (!ast.path) {
          throw new ExpressionError('Reference node missing path');
        }
        try {
          return this.referenceResolver.resolvePath(ast.path, context);
        } catch (error) {
          this.handleReferenceError(error);
        }
        break;

      case 'operation': {
        if (!ast.operator || !ast.left || !ast.right) {
          throw new ExpressionError('Invalid operation node');
        }
        const operator = SafeExpressionEvaluator.OPERATORS[ast.operator];
        if (!operator) {
          throw new ExpressionError(
            `Failed to evaluate expression: unknown operator '${ast.operator}'`,
          );
        }
        const left = this.evaluateAst(ast.left, context, startTime);
        const right = this.evaluateAst(ast.right, context, startTime);
        try {
          return operator(left, right);
        } catch (error: unknown) {
          if (error instanceof ExpressionError) {
            throw error;
          }
          if (error instanceof Error) {
            throw new ExpressionError(`Failed to evaluate operation: ${error.message}`);
          }
          throw new ExpressionError('Failed to evaluate operation: Unknown error');
        }
      }

      case 'object': {
        if (!ast.properties) {
          throw new ExpressionError('Internal error: Object node missing properties');
        }
        const obj: Record<string, unknown> = {};
        for (const prop of ast.properties) {
          if (prop.spread) {
            const spreadValue = this.evaluateAst(prop.value, context, startTime);
            if (typeof spreadValue === 'object' && spreadValue !== null) {
              Object.assign(obj, spreadValue);
            } else {
              throw new ExpressionError('Invalid spread operator usage: can only spread objects');
            }
          } else {
            obj[prop.key] = this.evaluateAst(prop.value, context, startTime);
          }
        }
        return obj;
      }

      case 'array': {
        if (!ast.elements) {
          /* istanbul ignore next */
          throw new ExpressionError('Internal error: Array node missing elements');
        }
        const result: unknown[] = [];
        for (const elem of ast.elements) {
          if (elem.spread) {
            const spreadValue = this.evaluateAst(elem.value, context, startTime);
            if (Array.isArray(spreadValue)) {
              result.push(...spreadValue);
            } else if (spreadValue !== null && typeof spreadValue === 'object') {
              result.push(...Object.values(spreadValue));
            } else {
              throw new ExpressionError(
                'Invalid spread operator usage: can only spread arrays or objects',
              );
            }
          } else {
            result.push(this.evaluateAst(elem.value, context, startTime));
          }
        }
        return result;
      }

      default:
        throw new ExpressionError(`Unknown AST node type: ${(ast as AstNode).type}`);
    }
  }

  /**
   * Extract all references from an expression without evaluating it.
   * This is useful for dependency analysis.
   * @param expression The expression to extract references from
   * @returns An array of reference paths found in the expression
   */
  public extractReferences(expression: string): string[] {
    const refs = new Set<string>();

    const extractRefs = (expr: string): void => {
      let pos = 0;
      while (pos < expr.length) {
        const startIdx = expr.indexOf('${', pos);
        if (startIdx === -1) break;
        let braceCount = 1;
        let i = startIdx + 2;
        while (i < expr.length && braceCount > 0) {
          if (expr.startsWith('${', i)) {
            braceCount++;
            i += 2;
          } else if (expr[i] === '}') {
            braceCount--;
            i++;
          } else {
            i++;
          }
        }
        if (braceCount === 0) {
          const inner = expr.substring(startIdx + 2, i - 1);
          const baseRef = inner.split(/[[.\s]+/)[0];
          if (baseRef && !this.isSpecialVariable(baseRef)) {
            refs.add(baseRef);
          }
          extractRefs(inner);
          pos = i;
        } else {
          break;
        }
      }
    };

    extractRefs(expression);

    return Array.from(refs).sort();
  }

  /**
   * Check if a variable name is a special variable that should be ignored
   */
  private isSpecialVariable(name: string): boolean {
    return ['item', 'context', 'acc'].includes(name);
  }

  /**
   * Helper method to handle reference resolution errors consistently
   */
  private handleReferenceError(
    error: unknown,
    message: string = 'Error resolving reference',
  ): never {
    if (error instanceof PropertyAccessError || error instanceof PathSyntaxError) {
      throw new ExpressionError(error.message);
    }
    if (error instanceof Error) {
      throw new ExpressionError(`${message}: ${error.message}`);
    }
    throw new ExpressionError(`${message}: ${String(error)}`);
  }
}
