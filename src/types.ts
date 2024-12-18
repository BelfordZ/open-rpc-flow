import { TransformOperation } from './transform-executor';

export interface Flow {
  name: string;
  description: string;
  steps: Step[];
  context?: Record<string, any>;
}

export interface Step {
  name: string;
  description?: string;
  request?: {
    method: string;
    params: Record<string, any> | any[];
  };
  loop?: {
    over: string;
    as: string;
    condition?: string;
    maxIterations?: number;
    step: Step;
  };
  aggregate?: {
    from: string;
    select?: string[];
    groupBy?: string;
    having?: string;
  };
  condition?: {
    if: string;
    then: Step;
    else?: Step;
  };
  transform?: {
    input?: string;
    operations: TransformOperation[];
  };
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, any> | any[];
  id: number;
} 