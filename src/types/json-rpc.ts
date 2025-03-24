/**
 * Represents a JSON-RPC parameter value
 */
export type JsonRpcParamValue =
  | string
  | number
  | boolean
  | null
  | JsonRpcParamValue[]
  | JsonRpcParamObject;

/**
 * Represents a JSON-RPC parameter object
 */
export interface JsonRpcParamObject {
  [key: string]: JsonRpcParamValue;
}

/**
 * Represents a JSON-RPC request
 */
export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: JsonRpcParamObject | JsonRpcParamValue[];
  id: number;
}

/**
 * Represents a JSON-RPC response
 */
export interface JsonRpcResponse {
  jsonrpc: '2.0';
  result?: JsonRpcParamValue;
  error?: {
    code: number;
    message: string;
    data?: JsonRpcParamValue;
  };
  id: number;
}
