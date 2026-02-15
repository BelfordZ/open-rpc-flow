export type TokenType =
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

export interface BaseToken<T extends TokenType, V> {
  type: T;
  value: V;
  raw: string;
}

export type StringToken = BaseToken<'string', string>;
export type NumberToken = BaseToken<'number', number>;
export type OperatorToken = BaseToken<'operator', string>;
export type ReferenceToken = BaseToken<'reference', Token[]>;
export type ObjectLiteralToken = BaseToken<'object_literal', Token[]>;
export type ArrayLiteralToken = BaseToken<'array_literal', Token[]>;
export type PunctuationToken = BaseToken<'punctuation', string>;
export type IdentifierToken = BaseToken<'identifier', string>;
export type KeyToken = BaseToken<'key', string>;
export type TemplateLiteralToken = BaseToken<'template_literal', Token[]>;

export type Token =
  | StringToken
  | NumberToken
  | OperatorToken
  | ReferenceToken
  | ObjectLiteralToken
  | ArrayLiteralToken
  | PunctuationToken
  | IdentifierToken
  | KeyToken
  | TemplateLiteralToken;

export type TokenWithTokenArrayValue =
  | ReferenceToken
  | ObjectLiteralToken
  | ArrayLiteralToken
  | TemplateLiteralToken;
export type TokenWithKeyValue = StringToken | IdentifierToken | KeyToken;

export function hasTokenArrayValue(token: Token): token is TokenWithTokenArrayValue {
  return (
    token.type === 'reference' ||
    token.type === 'object_literal' ||
    token.type === 'array_literal' ||
    token.type === 'template_literal'
  );
}

export function hasKeyValue(token: Token): token is TokenWithKeyValue {
  return token.type === 'string' || token.type === 'identifier' || token.type === 'key';
}

export type LiteralValue = string | number | boolean | null | undefined;

export type OperatorSymbol =
  | '+'
  | '-'
  | '*'
  | '/'
  | '%'
  | '=='
  | '==='
  | '!='
  | '!=='
  | '>'
  | '>='
  | '<'
  | '<='
  | '&&'
  | '||'
  | '??';

export interface LiteralNode {
  type: 'literal';
  value: LiteralValue;
}

export interface ReferenceNode {
  type: 'reference';
  path: string;
}

export interface OperationNode {
  type: 'operation';
  operator: OperatorSymbol;
  left: AstNode;
  right: AstNode;
}

export interface ObjectNode {
  type: 'object';
  properties: { key: string; value: AstNode; spread?: boolean }[];
}

export interface ArrayNode {
  type: 'array';
  elements: { value: AstNode; spread?: boolean }[];
}

export interface FunctionCallNode {
  type: 'function_call';
  name: string;
  args: AstNode[];
}

export type AstNode =
  | LiteralNode
  | ReferenceNode
  | OperationNode
  | ObjectNode
  | ArrayNode
  | FunctionCallNode;
