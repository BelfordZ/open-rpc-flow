import { ExpressionEvaluator } from './expression-evaluator';
import { ReferenceResolver } from './reference-resolver';

export interface TransformOperation {
  type: 'map' | 'filter' | 'reduce' | 'flatten' | 'sort' | 'unique' | 'group' | 'join';
  using: string;
  as?: string;
  initial?: any;
}

export class TransformExecutor {
  constructor(
    private expressionEvaluator: ExpressionEvaluator,
    private referenceResolver: ReferenceResolver,
    private context: Record<string, any>
  ) {}

  execute(operations: TransformOperation[], input: any): any {
    let data = input;

    for (const op of operations) {
      data = this.executeOperation(op, data);
      if (op.as) {
        this.context[op.as] = data;
      }
    }

    return data;
  }

  private executeOperation(op: TransformOperation, data: any): any {
    switch (op.type) {
      case 'map':
        return this.executeMap(op, data);
      case 'filter':
        return this.executeFilter(op, data);
      case 'reduce':
        return this.executeReduce(op, data);
      case 'flatten':
        return this.executeFlatten(op, data);
      case 'sort':
        return this.executeSort(op, data);
      case 'unique':
        return this.executeUnique(op, data);
      case 'group':
        return this.executeGroup(op, data);
      case 'join':
        return this.executeJoin(op, data);
      default:
        throw new Error(`Unknown transform operation type: ${(op as any).type}`);
    }
  }

  private executeMap(op: TransformOperation, data: any[]): any[] {
    this.validateArray(data, 'map');
    return data.map(item => {
      const context = { item };
      return this.expressionEvaluator.evaluateExpression(op.using, context);
    });
  }

  private executeFilter(op: TransformOperation, data: any[]): any[] {
    this.validateArray(data, 'filter');
    return data.filter(item => {
      const context = { item };
      return this.expressionEvaluator.evaluateExpression(op.using, context);
    });
  }

  private executeReduce(op: TransformOperation, data: any[]): any {
    this.validateArray(data, 'reduce');
    return data.reduce((acc, item) => {
        const context = { acc, item };
        return this.expressionEvaluator.evaluateExpression(op.using, context);
    }, op.initial);
  }

  private executeFlatten(op: TransformOperation, data: any[]): any[] {
    this.validateArray(data, 'flatten');
    return data.flat();
  }

  private executeSort(op: TransformOperation, data: any[]): any[] {
    this.validateArray(data, 'sort');
    return [...data].sort((a, b) => {
      const context = { a, b };
      return this.expressionEvaluator.evaluateExpression(op.using, context);
    });
  }

  private executeUnique(op: TransformOperation, data: any[]): any[] {
    this.validateArray(data, 'unique');
    return [...new Set(data)];
  }

  private executeGroup(op: TransformOperation, data: any[]): Record<string, any[]> {
    this.validateArray(data, 'group');
    const groups = new Map<string, any[]>();
    
    data.forEach(item => {
      const context = { item };
      const key = this.expressionEvaluator.evaluateExpression(op.using, context);
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(item);
    });

    return Object.fromEntries(groups);
  }

  private executeJoin(op: TransformOperation, data: any[]): string {
    this.validateArray(data, 'join');
    return data.join(op.using);
  }

  private validateArray(data: any, operation: string): void {
    if (!Array.isArray(data)) {
      throw new Error(`${operation} operation requires array input, got ${typeof data}`);
    }
  }
} 