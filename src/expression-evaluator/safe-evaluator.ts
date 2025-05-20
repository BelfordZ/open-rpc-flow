import { Logger } from '../util/logger';
import { ExpressionError } from '../expression-evaluator/errors';
import { ReferenceResolver } from '../reference-resolver';
import { PathSyntaxError, PropertyAccessError } from '../path-accessor';
import { tokenize, Token } from './tokenizer';
import { TokenizerError } from './tokenizer';
import { TimeoutError } from '../errors/timeout-error';
import { PolicyResolver } from '../util/policy-resolver';
import { Step, getStepType } from '../types';
import { StepType } from '../step-executors/types';
import { DEFAULT_TIMEOUTS } from '../constants/timeouts';

type Operator = keyof typeof SafeExpressionEvaluator.OPERATORS;
type StackOperator = Operator | '(' | ')';

interface AstNode {
  type: 'literal' | 'reference' | 'operation' | 'object' | 'array' | 'function_call';
  value?: any;
  path?: string;
  operator?: Operator;
  left?: AstNode;
  right?: AstNode;
  properties?: { key: string; value: AstNode; spread?: boolean }[];
  elements?: { value: AstNode; spread?: boolean }[];
  name?: string;
  args?: AstNode[];
}

export class _UnknownReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownReferenceError';
  }
}

export class SafeExpressionEvaluator {
  private static readonly MAX_EXPRESSION_LENGTH = 1000;
  private logger: Logger;
  private policyResolver?: PolicyResolver;
  private defaultExpressionTimeout: number = DEFAULT_TIMEOUTS.expression!;

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

  // Add whitelist of allowed global functions
  private static readonly ALLOWED_FUNCTIONS: {
    [key: string]: (...args: any[]) => any;
  } = {
    Number,
    String,
    Boolean,
    parseInt,
    parseFloat,
  };

  constructor(
    logger: Logger,
    private referenceResolver: ReferenceResolver,
    policyResolver?: PolicyResolver,
  ) {
    this.logger = logger.createNested('SafeExpressionEvaluator');
    this.policyResolver = policyResolver;
  }

  /**
   * Set the policy resolver to be used for expression timeouts
   * @param policyResolver The policy resolver
   */
  setPolicyResolver(policyResolver: PolicyResolver): void {
    this.policyResolver = policyResolver;
  }

  /**
   * Get the current expression timeout in milliseconds
   * @param step Optional step context for timeout resolution
   * @param stepType Optional step type for timeout resolution
   * @returns The resolved timeout value
   */
  getExpressionTimeout(step?: Step, stepType?: StepType): number {
    if (this.policyResolver && step && stepType) {
      return this.policyResolver.resolveExpressionTimeout(step, stepType as any);
    }
    return this.defaultExpressionTimeout;
  }

  evaluate(expression: string, context: Record<string, any>, step?: Step): any {
    this.logger.debug('Evaluating expression:', expression);
    this.logger.debug('Context:', JSON.stringify(context, null, 2));
    this.validateExpression(expression);
    const startTime = Date.now();
    this.logger.debug(`Expression validated at: ${startTime}`);

    try {
      const stepType = step ? getStepType(step) : undefined;
      this.checkTimeout(startTime, expression, step, stepType);

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
      return this.evaluateAst(ast, context, startTime, expression, step, stepType);
    } catch (error) {
      let extraHint = '';
      if (
        error instanceof TokenizerError ||
        error instanceof PathSyntaxError ||
        error instanceof PropertyAccessError ||
        error instanceof ExpressionError
      ) {
        if (typeof expression === 'string' && /^[a-zA-Z_][a-zA-Z0-9_ ]*$/.test(expression.trim())) {
          extraHint = ` (Did you mean to use a string literal? Wrap your value in quotes, e.g. "'${expression.trim()}'")`;
        }
        throw new ExpressionError(
          `Failed to evaluate expression: ${expression}. Got error: ${error.message}${extraHint}`,
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

  private checkTimeout(
    startTime: number,
    expression: string,
    step?: Step,
    stepType?: StepType,
  ): void {
    const currentTime = Date.now();
    const elapsedTime = currentTime - startTime;
    const timeout = this.getExpressionTimeout(step, stepType);

    this.logger.debug(`Checking timeout - elapsed time: ${elapsedTime}ms, timeout: ${timeout}ms`);

    if (elapsedTime > timeout) {
      this.logger.error(`Expression evaluation timed out after ${elapsedTime}ms`);
      this.logger.debug('TimeoutError debug info:', {
        step,
        stepType: step ? getStepType(step) : undefined,
      });
      throw TimeoutError.forExpression(
        expression,
        timeout,
        elapsedTime,
        step,
        step ? (getStepType(step) as StepType) : undefined,
      );
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

      // Function call: identifier followed by '('
      if (token.type === 'identifier' && tokens[i + 1] && tokens[i + 1].value === '(') {
        // Find matching closing parenthesis
        let depth = 1;
        let j = i + 2;
        const argTokens: Token[] = [];
        while (j < tokens.length && depth > 0) {
          if (tokens[j].value === '(') depth++;
          else if (tokens[j].value === ')') depth--;
          if (depth > 0) argTokens.push(tokens[j]);
          j++;
        }
        if (depth !== 0) throw new ExpressionError('Mismatched parentheses in function call');
        // Split args by commas at top level
        const args: AstNode[] = [];
        let current: Token[] = [];
        let argDepth = 0;
        for (const t of argTokens) {
          if (t.value === '(') argDepth++;
          if (t.value === ')') argDepth--;
          if (t.value === ',' && argDepth === 0) {
            if (current.length > 0) args.push(this.parse(current));
            current = [];
          } else {
            current.push(t);
          }
        }
        if (current.length > 0) args.push(this.parse(current));
        outputQueue.push({ type: 'function_call', name: token.value, args });
        i = j - 1;
        expectOperator = true;
        continue;
      }

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

  private evaluateAst(
    ast: AstNode,
    context: Record<string, unknown>,
    startTime: number,
    expression: string,
    step?: Step,
    stepType?: StepType,
  ): unknown {
    this.checkTimeout(startTime, expression, step, stepType);

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
        const left = this.evaluateAst(ast.left, context, startTime, expression, step, stepType);
        const right = this.evaluateAst(ast.right, context, startTime, expression, step, stepType);
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
            const spreadValue = this.evaluateAst(
              prop.value,
              context,
              startTime,
              expression,
              step,
              stepType,
            );
            if (typeof spreadValue === 'object' && spreadValue !== null) {
              Object.assign(obj, spreadValue);
            } else {
              throw new ExpressionError('Invalid spread operator usage: can only spread objects');
            }
          } else {
            obj[prop.key] = this.evaluateAst(
              prop.value,
              context,
              startTime,
              expression,
              step,
              stepType,
            );
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
            const spreadValue = this.evaluateAst(
              elem.value,
              context,
              startTime,
              expression,
              step,
              stepType,
            );
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
            result.push(
              this.evaluateAst(elem.value, context, startTime, expression, step, stepType),
            );
          }
        }
        return result;
      }

      case 'function_call': {
        if (!ast.name || !Array.isArray(ast.args)) {
          throw new ExpressionError('Malformed function call node');
        }
        if (
          !Object.prototype.hasOwnProperty.call(
            SafeExpressionEvaluator.ALLOWED_FUNCTIONS,
            ast.name as keyof typeof SafeExpressionEvaluator.ALLOWED_FUNCTIONS,
          )
        ) {
          throw new ExpressionError(`Function '${ast.name}' is not allowed`);
        }
        const fn =
          SafeExpressionEvaluator.ALLOWED_FUNCTIONS[
            ast.name as keyof typeof SafeExpressionEvaluator.ALLOWED_FUNCTIONS
          ];
        const argVals = ast.args.map((arg: AstNode) =>
          this.evaluateAst(arg, context, startTime, expression, step, stepType),
        );
        return fn(...argVals);
      }

      default:
        throw new ExpressionError(`Unknown AST node type: ${(ast as AstNode).type}`);
    }
  }

  private handleReferenceError(error: unknown, customMessage?: string): never {
    const originalMessage = error instanceof Error ? error.message : String(error);
    const message = customMessage ? `${customMessage}: ${originalMessage}` : originalMessage;
    throw new ExpressionError(message, error instanceof Error ? error : undefined);
  }

  private static isSpecialVariable(name: string): boolean {
    return ['item', 'context', 'acc'].includes(name);
  }

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
          if (baseRef && !SafeExpressionEvaluator.isSpecialVariable(baseRef)) {
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
}
