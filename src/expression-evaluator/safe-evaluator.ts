import { Logger } from '../util/logger';
import { ExpressionError as InternalExpressionError } from './errors';
import { ExpressionError as FlowExpressionError } from '../errors';
import { ReferenceResolver, UnknownReferenceError } from '../reference-resolver';
import { PathSyntaxError, PropertyAccessError } from '../path-accessor';
import { tokenize, Token } from './tokenizer';
import { TokenizerError } from './tokenizer';
import { tokenize as old_tokenize, Token as OldToken } from './tokenizer';
import { TokenizerError as OldTokenizerError } from './tokenizer';

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
  // Maximum expression length for security
  static readonly MAX_EXPRESSION_LENGTH = 10000;
  
  // Maximum execution time in milliseconds
  static readonly MAX_EXECUTION_TIME_MS = 5000;
  
  private TIMEOUT_MS = 1000;
  private logger: Logger;

  public static readonly OPERATORS = {
    '+': (a: any, b: any) => {
      if (typeof a === 'string' || typeof b === 'string') {
        return String(a) + String(b);
      }
      if (typeof a !== 'number' || typeof b !== 'number') {
        throw new InternalExpressionError(`Cannot perform addition on non-numeric values: ${a} + ${b}`);
      }
      return a + b;
    },
    '-': (a: any, b: any) => {
      if (typeof a !== 'number' || typeof b !== 'number') {
        throw new InternalExpressionError(`Cannot perform subtraction on non-numeric values: ${a} - ${b}`);
      }
      return a - b;
    },
    '*': (a: any, b: any) => {
      if (typeof a !== 'number' || typeof b !== 'number') {
        throw new InternalExpressionError(
          `Cannot perform multiplication on non-numeric values: ${a} * ${b}`,
        );
      }
      return a * b;
    },
    '/': (a: any, b: any) => {
      if (typeof a !== 'number' || typeof b !== 'number') {
        throw new InternalExpressionError(`Cannot perform division on non-numeric values: ${a} / ${b}`);
      }
      if (b === 0) {
        throw new InternalExpressionError('Division/modulo by zero');
      }
      return a / b;
    },
    '%': (a: any, b: any) => {
      if (typeof a !== 'number' || typeof b !== 'number') {
        throw new InternalExpressionError(`Cannot perform modulo on non-numeric values: ${a} % ${b}`);
      }
      if (b === 0) {
        throw new InternalExpressionError('Division/modulo by zero');
      }
      return a % b;
    },
    '==': (a: any, b: any) => a == b,
    '===': (a: any, b: any) => a === b,
    '!=': (a: any, b: any) => a != b,
    '!==': (a: any, b: any) => a !== b,
    '>': (a: any, b: any) => {
      if (typeof a !== typeof b) {
        throw new InternalExpressionError(`Cannot compare values of different types: ${a} > ${b}`);
      }
      return a > b;
    },
    '>=': (a: any, b: any) => {
      if (typeof a !== typeof b) {
        throw new InternalExpressionError(`Cannot compare values of different types: ${a} >= ${b}`);
      }
      return a >= b;
    },
    '<': (a: any, b: any) => {
      if (typeof a !== typeof b) {
        throw new InternalExpressionError(`Cannot compare values of different types: ${a} < ${b}`);
      }
      return a < b;
    },
    '<=': (a: any, b: any) => {
      if (typeof a !== typeof b) {
        throw new InternalExpressionError(`Cannot compare values of different types: ${a} <= ${b}`);
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
    this.logger = logger;
  }

  evaluate(expression: string, context: Record<string, any> = {}): any {
    try {
      // Maximum expression length for security
      this.validateExpression(expression);

      // Start timeout monitoring
      const startTime = Date.now();

      // Skip empty expressions
      if (!expression.trim()) return undefined;

      // Handle direct references like ${variable}
      if (expression.startsWith('${') && expression.endsWith('}')) {
        const path = expression.slice(2, -1).trim();
        try {
          return this.referenceResolver.resolvePath(path, context);
        } catch (error) {
          if (error instanceof PropertyAccessError) {
            throw new FlowExpressionError(`Reference resolution failed: ${error.message}`, {
              expression,
              path,
              context: Object.keys(context),
            });
          }
          if (error instanceof PathSyntaxError) {
            throw new FlowExpressionError(`Reference resolution failed: ${error.message}`, {
              expression,
              path: error.path,
            });
          }
          if (error instanceof UnknownReferenceError) {
            throw new FlowExpressionError(`Reference not found: ${error.reference}`, {
              expression,
              reference: error.reference,
              availableReferences: error.availableReferences,
            });
          }
          // For any other error, wrap it in FlowExpressionError
          throw new FlowExpressionError(`Expression evaluation failed: ${String(error)}`, {
            expression,
          });
        }
      }

      // Tokenize the expression
      let tokens: Token[];
      try {
        tokens = tokenize(expression, this.logger);
      } catch (error) {
        if (error instanceof TokenizerError) {
          throw new InternalExpressionError(`Expression syntax error: ${error.message}`);
        }
        throw error;
      }

      if (tokens.length === 0) return undefined;

      // Parse tokens into AST
      const ast = this.parse(tokens);

      // Evaluate AST
      const result = this.evaluateAst(ast, context);
      
      // Check if execution time exceeded limit
      const endTime = Date.now();
      if (endTime - startTime > this.TIMEOUT_MS) {
        this.logger.warn(`Expression evaluation took too long: ${endTime - startTime}ms`);
      }
      
      return result;
    } catch (error) {
      // If it's already a FlowExpressionError, just rethrow it
      if (error instanceof FlowExpressionError) {
        throw error;
      }
      
      // For any other error, wrap it in FlowExpressionError
      throw new FlowExpressionError(`Expression evaluation failed: ${String(error)}`, {
        expression,
      });
    }
  }

  private validateExpression(expression: string): void {
    this.logger.debug('Validating expression:', expression);
    if (!expression || typeof expression !== 'string') {
      this.logger.error('Invalid expression: must be a non-empty string');
      throw new InternalExpressionError('Expression must be a non-empty string');
    }

    if (expression.length > SafeExpressionEvaluator.MAX_EXPRESSION_LENGTH) {
      this.logger.error(
        `Expression length ${expression.length} exceeds maximum of ${SafeExpressionEvaluator.MAX_EXPRESSION_LENGTH} characters`,
      );
      throw new InternalExpressionError(
        `Expression length exceeds maximum of ${SafeExpressionEvaluator.MAX_EXPRESSION_LENGTH} characters`,
      );
    }

    // Check for potentially dangerous patterns
    const dangerousPatterns = ['eval', 'Function', 'constructor', '__proto__', 'prototype'];
    this.logger.debug('Checking for dangerous patterns');

    for (const pattern of dangerousPatterns) {
      if (expression.includes(pattern)) {
        this.logger.error(`Found forbidden pattern in expression: ${pattern}`);
        throw new InternalExpressionError(`Expression contains forbidden pattern: ${pattern}`);
      }
    }

    // Validate template literals
    const templateLiteralMatches = expression.match(/\${[^}]*}/g);
    if (templateLiteralMatches) {
      // Check for empty template literals
      if (templateLiteralMatches.some((match) => match === '${}')) {
        throw new InternalExpressionError('Empty template literal: ${}');
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
      throw new InternalExpressionError('Malformed template literal: unclosed ${');
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
      throw new InternalExpressionError('Expression evaluation timed out');
    }
  }

  private parse(tokens: Token[]): AstNode {
    if (tokens.length === 0) {
      throw new InternalExpressionError('Empty expression');
    }

    // Handle literals
    if (tokens.length === 1) {
      const token = tokens[0];
      if (token.type === 'number') {
        return { type: 'literal', value: Number(token.value) };
      }
      if (token.type === 'string') {
        return { type: 'literal', value: token.value };
      }
      if (token.type === 'identifier') {
        if (token.value === 'true') return { type: 'literal', value: true };
        if (token.value === 'false') return { type: 'literal', value: false };
        if (token.value === 'null') return { type: 'literal', value: null };
        if (token.value === 'undefined') return { type: 'literal', value: undefined };
        return { type: 'literal', value: token.value };
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
          throw new InternalExpressionError('Unexpected opening parenthesis');
        }
        operatorStack.push('(');
        continue;
      }
      if (token.value === ')') {
        if (!expectOperator) {
          throw new InternalExpressionError('Unexpected closing parenthesis');
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
            throw new InternalExpressionError('Invalid operator: found closing parenthesis');
          }
          const right = outputQueue.pop()!;
          const left = outputQueue.pop()!;
          outputQueue.push({ type: 'operation', operator: operator as Operator, left, right });
        }
        if (!foundMatching) {
          throw new InternalExpressionError('Mismatched parentheses');
        }
        continue;
      }

      if (token.type === 'number') {
        if (expectOperator) {
          throw new InternalExpressionError('Unexpected number');
        }
        outputQueue.push({ type: 'literal', value: Number(token.value) });
        expectOperator = true;
      } else if (token.type === 'string') {
        if (expectOperator) {
          throw new InternalExpressionError('Unexpected string');
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
            throw new InternalExpressionError('Unexpected operator');
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
          // Treat as a literal value, converting known keywords to proper types
          if (expectOperator) {
            throw new InternalExpressionError('Unexpected identifier');
          }
          let literalValue: any = token.value;
          if (token.value === 'true') literalValue = true;
          else if (token.value === 'false') literalValue = false;
          else if (token.value === 'null') literalValue = null;
          else if (token.value === 'undefined') literalValue = undefined;
          outputQueue.push({ type: 'literal', value: literalValue });
          expectOperator = true;
        }
      } else if (token.type === 'reference') {
        if (expectOperator) {
          throw new InternalExpressionError('Unexpected reference');
        }
        outputQueue.push({ type: 'reference', path: this.buildReferencePath(token.value) });
        expectOperator = true;
      } else if (
        token.type === 'operator' ||
        ['&&', '||', '??', '==', '===', '!=', '!==', '>', '>=', '<', '<='].includes(token.value)
      ) {
        if (!expectOperator) {
          throw new InternalExpressionError('Unexpected operator');
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
        throw new InternalExpressionError(`Unexpected token: ${JSON.stringify(token)}`);
      }
    }

    while (operatorStack.length > 0) {
      const operator = operatorStack.pop()!;
      if (operator === '(' || operator === ')') {
        throw new InternalExpressionError('Mismatched parentheses');
      }
      const right = outputQueue.pop()!;
      const left = outputQueue.pop()!;
      outputQueue.push({ type: 'operation', operator: operator as Operator, left, right });
    }

    if (outputQueue.length !== 1) {
      throw new InternalExpressionError('Invalid expression');
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

  private parseArrayElements(tokens: Token[]): { value: AstNode; spread?: boolean }[] {
    if (tokens.length === 0) return [];

    const elements: { value: AstNode; spread?: boolean }[] = [];
    let currentTokens: Token[] = [];
    let depth = 0;
    let isSpread = false;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (token.value === ',' && depth === 0) {
        if (currentTokens.length > 0) {
          elements.push({
            value: this.parse(currentTokens),
            spread: isSpread,
          });
          currentTokens = [];
          isSpread = false;
        }
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
      elements.push({
        value: this.parse(currentTokens),
        spread: isSpread,
      });
    }

    return elements;
  }

  private parseObjectProperties(
    tokens: Token[],
  ): { key: string; value: AstNode; spread?: boolean }[] {
    if (tokens.length === 0) return [];

    const properties: { key: string; value: AstNode; spread?: boolean }[] = [];
    let currentTokens: Token[] = [];
    let depth = 0;
    let isSpread = false;
    let key: string | null = null;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      if (token.value === ',' && depth === 0) {
        if (currentTokens.length > 0) {
          if (key === null && !isSpread) {
            throw new InternalExpressionError('Invalid object literal: missing key');
          }
          properties.push({
            key: key || '',
            value: this.parse(currentTokens),
            spread: isSpread,
          });
          currentTokens = [];
          key = null;
          isSpread = false;
        }
        continue;
      }

      if (token.value === ':' && depth === 0 && !isSpread) {
        if (currentTokens.length !== 1) {
          throw new InternalExpressionError('Invalid object literal: invalid key');
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
      if (key === null && !isSpread) {
        throw new InternalExpressionError('Invalid object literal: missing key');
      }
      properties.push({
        key: key || '',
        value: this.parse(currentTokens),
        spread: isSpread,
      });
    }

    return properties;
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
      throw new InternalExpressionError(`Unknown operator: ${token}`);
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

  private evaluateAst(ast: AstNode, context: Record<string, unknown>): unknown {
    this.checkTimeout(Date.now());

    switch (ast.type) {
      case 'literal':
        return ast.value;

      case 'reference':
        if (!ast.path) {
          throw new InternalExpressionError('Reference node missing path');
        }
        try {
          return this.referenceResolver.resolvePath(ast.path, context);
        } catch (error) {
          if (error instanceof PropertyAccessError) {
            throw new InternalExpressionError(error.message);
          }
          throw error;
        }

      case 'operation': {
        if (!ast.operator || !ast.left || !ast.right) {
          throw new InternalExpressionError('Invalid operation node');
        }
        const operator = SafeExpressionEvaluator.OPERATORS[ast.operator];
        if (!operator) {
          throw new InternalExpressionError(
            `Failed to evaluate expression: unknown operator '${ast.operator}'`,
          );
        }
        const left = this.evaluateAst(ast.left, context);
        const right = this.evaluateAst(ast.right, context);
        try {
          return operator(left, right);
        } catch (error: unknown) {
          if (error instanceof InternalExpressionError) {
            throw error;
          }
          if (error instanceof Error) {
            if (
              error.message.toLowerCase().includes('division') &&
              error.message.toLowerCase().includes('zero')
            ) {
              throw new InternalExpressionError('Division/modulo by zero');
            }
            throw new InternalExpressionError(`Failed to evaluate operation: ${error.message}`);
          }
          throw new InternalExpressionError('Failed to evaluate operation: Unknown error');
        }
      }

      case 'object': {
        if (!ast.properties) {
          throw new InternalExpressionError('Internal error: Object node missing properties');
        }
        const obj: Record<string, unknown> = {};
        for (const prop of ast.properties) {
          if (prop.spread) {
            const spreadValue = this.evaluateAst(prop.value, context);
            if (typeof spreadValue === 'object' && spreadValue !== null) {
              Object.assign(obj, spreadValue);
            } else {
              throw new InternalExpressionError('Invalid spread operator usage: can only spread objects');
            }
          } else {
            obj[prop.key] = this.evaluateAst(prop.value, context);
          }
        }
        return obj;
      }

      case 'array': {
        if (!ast.elements) {
          throw new InternalExpressionError('Internal error: Array node missing elements');
        }
        const result: unknown[] = [];
        for (const elem of ast.elements) {
          if (elem.spread) {
            const spreadValue = this.evaluateAst(elem.value, context);
            if (Array.isArray(spreadValue)) {
              result.push(...spreadValue);
            } else if (spreadValue !== null && typeof spreadValue === 'object') {
              result.push(...Object.values(spreadValue));
            } else {
              throw new InternalExpressionError(
                'Invalid spread operator usage: can only spread arrays or objects',
              );
            }
          } else {
            result.push(this.evaluateAst(elem.value, context));
          }
        }
        return result;
      }

      default:
        throw new InternalExpressionError(`Unknown AST node type: ${(ast as AstNode).type}`);
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

    try {
      extractRefs(expression);
    } catch (error) {
      return [];
    }

    return Array.from(refs).sort();
  }

  /**
   * Check if a variable name is a special variable that should be ignored
   */
  private isSpecialVariable(name: string): boolean {
    return ['item', 'context', 'acc'].includes(name);
  }
}
