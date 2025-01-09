import { Logger } from '../util/logger';
import { ExpressionError } from '../expression-evaluator/errors';

type Operator = keyof typeof SafeExpressionEvaluator.OPERATORS;

interface AstNode {
  type: 'literal' | 'reference' | 'operation';
  value?: any;
  path?: string;
  operator?: Operator;
  left?: AstNode;
  right?: AstNode;
}

export class SafeExpressionEvaluator {
  private static readonly MAX_EXPRESSION_LENGTH = 1000;
  private TIMEOUT_MS = 1000;
  public static readonly OPERATORS = {
    '+': (a: any, b: any) => a + b,
    '-': (a: any, b: any) => a - b,
    '*': (a: any, b: any) => a * b,
    '/': (a: any, b: any) => a / b,
    '%': (a: any, b: any) => a % b,
    '==': (a: any, b: any) => a == b,
    '===': (a: any, b: any) => a === b,
    '!=': (a: any, b: any) => a != b,
    '!==': (a: any, b: any) => a !== b,
    '>': (a: any, b: any) => a > b,
    '>=': (a: any, b: any) => a >= b,
    '<': (a: any, b: any) => a < b,
    '<=': (a: any, b: any) => a <= b,
    '&&': (a: any, b: any) => a && b,
    '||': (a: any, b: any) => a || b,
    '??': (a: any, b: any) => a ?? b,
  } as const;

  constructor(private logger: Logger) {
    this.logger = logger.createNested('SafeExpressionEvaluator');
  }

  evaluate(expression: string, context: Record<string, any>): any {
    this.validateExpression(expression);
    const startTime = Date.now();

    try {
      // Handle simple literals directly
      if (/^-?\d+(\.\d+)?$/.test(expression)) {
        return Number(expression);
      }
      if (expression === 'true') return true;
      if (expression === 'false') return false;
      if (expression === 'null') return null;
      if (expression === 'undefined') return undefined;
      if (/^["'].*["']$/.test(expression)) {
        return expression.slice(1, -1);
      }

      const tokens = this.tokenize(expression);
      const ast = this.parse(tokens);
      return this.evaluateAst(ast, context, startTime);
    } catch (error) {
      if (error instanceof ExpressionError) {
        throw error;
      }
      throw new ExpressionError(
        `Failed to evaluate expression: ${expression}`,
        error instanceof Error ? error : undefined,
      );
    }
  }

  private validateExpression(expression: string): void {
    if (!expression || typeof expression !== 'string') {
      throw new ExpressionError('Expression must be a non-empty string');
    }

    if (expression.length > SafeExpressionEvaluator.MAX_EXPRESSION_LENGTH) {
      throw new ExpressionError(
        `Expression length exceeds maximum of ${SafeExpressionEvaluator.MAX_EXPRESSION_LENGTH} characters`,
      );
    }

    // Check for potentially dangerous patterns
    const dangerousPatterns = ['eval', 'Function', 'constructor', '__proto__', 'prototype'];

    for (const pattern of dangerousPatterns) {
      if (expression.includes(pattern)) {
        throw new ExpressionError(`Expression contains forbidden pattern: ${pattern}`);
      }
    }
  }

  private checkTimeout(startTime: number): void {
    if (Date.now() - startTime > this.TIMEOUT_MS) {
      throw new ExpressionError('Expression evaluation timed out');
    }
  }

  private tokenize(expression: string): string[] {
    // Handle parentheses and operators
    const withSpaces = expression
      .replace(/([+\-*/%=!<>&|?()])/g, ' $1 ')
      .replace(/([<>]=?|[!=]==?|\|\||&&|\?\?)/g, ' $1 ')
      .replace(/\s+/g, ' ')
      .trim();

    // Split into tokens, preserving quoted strings
    const tokens: string[] = [];
    let current = '';
    let inQuote: string | null = null;

    for (let i = 0; i < withSpaces.length; i++) {
      const char = withSpaces[i];

      if (inQuote) {
        if (char === inQuote) {
          tokens.push(current + char);
          current = '';
          inQuote = null;
        } else {
          current += char;
        }
      } else if (char === '"' || char === "'") {
        current = char;
        inQuote = char;
      } else if (char === ' ') {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current) {
      tokens.push(current);
    }

    // Combine multi-character operators
    const result: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const nextToken = tokens[i + 1];
      const combined = token + nextToken;

      if (
        nextToken &&
        (combined === '===' ||
          combined === '!==' ||
          combined === '==' ||
          combined === '!=' ||
          combined === '>=' ||
          combined === '<=' ||
          combined === '||' ||
          combined === '&&' ||
          combined === '??')
      ) {
        result.push(combined);
        i++; // Skip next token
      } else {
        result.push(token);
      }
    }

    const filtered = result.filter((t) => t.trim());
    if (filtered.length === 0) {
      throw new ExpressionError('Empty expression');
    }

    return filtered;
  }

  private parse(tokens: string[]): AstNode {
    // Handle parentheses first
    const stack: string[][] = [[]];
    let current = stack[0];

    for (const token of tokens) {
      if (token === '(') {
        stack.push([]);
        current = stack[stack.length - 1];
      } else if (token === ')') {
        if (stack.length === 1) {
          throw new ExpressionError('Unmatched closing parenthesis');
        }
        const completed = this.parseTokens(current);
        stack.pop();
        current = stack[stack.length - 1];
        current.push(`__expr_${JSON.stringify(completed)}`);
      } else {
        current.push(token);
      }
    }

    if (stack.length > 1) {
      throw new ExpressionError('Unmatched opening parenthesis');
    }

    return this.parseTokens(stack[0]);
  }

  private parseTokens(tokens: string[]): AstNode {
    if (tokens.length === 0) {
      throw new ExpressionError('Empty expression');
    }

    // Handle special expression tokens
    if (tokens.length === 1) {
      const token = tokens[0];
      if (token.startsWith('__expr_')) {
        return JSON.parse(token.slice(7));
      }
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
      // Check for unknown operators
      for (const token of tokens) {
        if (token.match(/[+\-*/%=!<>&|?@]/)) {
          throw new ExpressionError(`Unknown operator: ${token}`);
        }
      }

      // Try to combine tokens as a reference
      const combined = tokens.join('');
      if (combined.includes('(') || combined.includes(')')) {
        throw new ExpressionError('Invalid expression: mismatched parentheses');
      }
      return { type: 'reference', path: combined };
    }

    const operator = tokens[lowestPrecedenceIndex] as Operator;
    const left = tokens.slice(0, lowestPrecedenceIndex);
    const right = tokens.slice(lowestPrecedenceIndex + 1);

    return {
      type: 'operation',
      operator,
      left: this.parseTokens(left),
      right: this.parseTokens(right),
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
    // Handle numbers
    if (/^-?\d+(\.\d+)?$/.test(token)) {
      return { type: 'literal', value: Number(token) };
    }

    // Handle booleans
    if (token === 'true') return { type: 'literal', value: true };
    if (token === 'false') return { type: 'literal', value: false };

    // Handle null
    if (token === 'null') return { type: 'literal', value: null };

    // Handle undefined
    if (token === 'undefined') return { type: 'literal', value: undefined };

    // Handle strings
    if (/^["'].*["']$/.test(token)) {
      return { type: 'literal', value: token.slice(1, -1) };
    }

    // Check for unknown operators
    if (token.match(/[+\-*/%=!<>&|?@]/)) {
      throw new ExpressionError(`Unknown operator: ${token}`);
    }

    // Handle references
    return { type: 'reference', path: token };
  }

  private evaluateAst(ast: AstNode, context: Record<string, any>, startTime: number): any {
    this.checkTimeout(startTime);

    if (ast.type === 'literal') {
      return ast.value;
    }

    if (ast.type === 'reference') {
      if (!ast.path) {
        throw new ExpressionError('Internal error: Reference node missing path');
      }
      return this.resolveReference(ast.path, context);
    }

    if (ast.type === 'operation') {
      if (!ast.operator || !ast.left || !ast.right) {
        throw new ExpressionError('Invalid operation node');
      }

      const operator = SafeExpressionEvaluator.OPERATORS[ast.operator];
      if (!operator) {
        throw new ExpressionError(`Unknown operator: ${ast.operator}`);
      }

      const left = this.evaluateAst(ast.left, context, startTime);
      const right = this.evaluateAst(ast.right, context, startTime);

      try {
        return operator(left, right);
      } catch (error) {
        throw new ExpressionError(
          `Failed to evaluate operation ${ast.operator}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    throw new ExpressionError(`Unknown AST node type: ${ast.type}`);
  }

  private resolveReference(path: string, context: Record<string, any>): any {
    const parts = path.split('.');
    let current = context;

    for (const part of parts) {
      if (current === null || current === undefined) {
        throw new ExpressionError(`Cannot access property '${part}' of ${current}`);
      }

      if (!(part in current)) {
        throw new ExpressionError(`Property '${part}' not found in context`);
      }

      try {
        current = current[part];
      } catch (error) {
        throw new ExpressionError(
          `Failed to access property '${part}': ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    return current;
  }
}
