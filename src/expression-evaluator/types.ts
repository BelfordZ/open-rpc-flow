export type TokenValue = string | number | Token[];

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
  value: TokenValue;
  raw: string;
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
