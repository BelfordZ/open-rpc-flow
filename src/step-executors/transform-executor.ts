import { Step, StepExecutionContext } from '../types';
import {
  StepExecutor,
  StepExecutionResult,
  StepType,
  TransformStep,
  TransformOperation,
} from './types';
import { Logger } from '../util/logger';
import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';
import { ReferenceResolver } from '../reference-resolver';

/**
 * Core transform executor that handles all transformation operations
 */
export class TransformExecutor {
  private logger: Logger;

  constructor(
    private expressionEvaluator: SafeExpressionEvaluator,
    private referenceResolver: ReferenceResolver,
    private context: Record<string, any>,
    logger: Logger,
  ) {
    this.logger = logger.createNested('TransformExecutor');
  }

  execute(operations: TransformOperation[], input: any): any {
    this.logger.debug('Starting transform execution', {
      operationCount: operations.length,
      operations: operations.map((op) => ({ type: op.type, as: op.as })),
      inputType: typeof input,
      isArray: Array.isArray(input),
    });

    let data = input;

    for (const op of operations) {
      this.logger.debug('Executing operation', {
        type: op.type,
        using: op.using,
        as: op.as,
        dataType: typeof data,
        isArray: Array.isArray(data),
      });

      data = this.executeOperation(op, data);

      if (op.as) {
        this.logger.debug('Storing operation result in context', {
          key: op.as,
          resultType: typeof data,
          isArray: Array.isArray(data),
        });
        this.context[op.as] = data;
      }
    }

    this.logger.debug('Transform execution completed', {
      resultType: typeof data,
      isArray: Array.isArray(data),
      resultLength: Array.isArray(data) ? data.length : undefined,
    });

    return data;
  }

  private executeOperation(op: TransformOperation, data: any): any {
    this.logger.debug('Executing operation', {
      type: op.type,
      using: op.using,
      as: op.as,
      dataType: typeof data,
      isArray: Array.isArray(data),
    });

    try {
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
          throw new Error(`Unknown transform operation type: ${op.type}`);
      }
    } catch (error) {
      this.logger.error('Operation execution failed', { type: op.type, error });
      throw error;
    }
  }

  private executeMap(op: TransformOperation, data: any[]): any[] {
    this.validateArray(data, 'map');
    this.logger.debug('Executing map operation', {
      inputLength: data.length,
      expression: op.using,
    });

    const result = data.map((item, index) => {
      const context = { item, index };
      const mapped = this.expressionEvaluator.evaluate(op.using, context);
      this.logger.debug('Mapped item', {
        index,
        originalType: typeof item,
        resultType: typeof mapped,
      });
      return mapped;
    });

    this.logger.debug('Map operation completed', {
      inputLength: data.length,
      outputLength: result.length,
    });
    return result;
  }

  private executeFilter(op: TransformOperation, data: any[]): any[] {
    this.validateArray(data, 'filter');
    this.logger.debug('Executing filter operation', {
      inputLength: data.length,
      expression: op.using,
    });

    const result = data.filter((item, index) => {
      const context = { item, index };
      const keep = this.expressionEvaluator.evaluate(op.using, context);
      this.logger.debug('Filter evaluation', { index, keep });
      return keep;
    });

    this.logger.debug('Filter operation completed', {
      inputLength: data.length,
      outputLength: result.length,
      filteredOutCount: data.length - result.length,
    });
    return result;
  }

  private executeReduce(op: TransformOperation, data: any[]): any {
    this.validateArray(data, 'reduce');
    this.logger.debug('Executing reduce operation', {
      inputLength: data.length,
      expression: op.using,
      hasInitialValue: 'initial' in op,
    });

    const result = data.reduce((acc, item, index) => {
      const context = { acc, item, index };
      const reduced = this.expressionEvaluator.evaluate(op.using, context);
      this.logger.debug('Reduced item', {
        index,
        accType: typeof acc,
        itemType: typeof item,
        resultType: typeof reduced,
      });
      return reduced;
    }, op.initial);

    this.logger.debug('Reduce operation completed', {
      inputLength: data.length,
      resultType: typeof result,
    });
    return result;
  }

  private executeFlatten(op: TransformOperation, data: any[]): any[] {
    this.validateArray(data, 'flatten');
    this.logger.debug('Executing flatten operation', {
      inputLength: data.length,
      nestedArraysCount: data.filter(Array.isArray).length,
    });

    const result = data.flat();
    this.logger.debug('Flatten operation completed', {
      inputLength: data.length,
      outputLength: result.length,
    });
    return result;
  }

  private executeSort(op: TransformOperation, data: any[]): any[] {
    this.validateArray(data, 'sort');
    this.logger.debug('Executing sort operation', {
      inputLength: data.length,
      expression: op.using,
    });

    const result = [...data].sort((a, b) => {
      const context = { a, b };
      return this.expressionEvaluator.evaluate(op.using, context);
    });

    this.logger.debug('Sort operation completed', {
      inputLength: data.length,
      outputLength: result.length,
    });
    return result;
  }

  private executeUnique(op: TransformOperation, data: any[]): any[] {
    this.validateArray(data, 'unique');
    this.logger.debug('Executing unique operation', {
      inputLength: data.length,
    });

    const result = [...new Set(data)];
    this.logger.debug('Unique operation completed', {
      inputLength: data.length,
      outputLength: result.length,
      duplicatesRemoved: data.length - result.length,
    });
    return result;
  }

  private executeGroup(op: TransformOperation, data: any[]): any[] {
    this.validateArray(data, 'group');
    this.logger.debug('Executing group operation', {
      inputLength: data.length,
      expression: op.using,
    });

    const groupedObj = data.reduce((acc, item, index) => {
      const context = { item, index };
      const key = this.expressionEvaluator.evaluate(op.using, context);
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    }, {});

    // Convert the grouped object to an array of key-value pairs
    const result = Object.entries(groupedObj).map(([key, items]) => ({
      key: isNaN(Number(key)) ? key : Number(key),
      items,
    }));

    this.logger.debug('Group operation completed', {
      inputLength: data.length,
      groupCount: result.length,
    });
    return result;
  }

  private executeJoin(op: TransformOperation, data: any[]): string {
    this.validateArray(data, 'join');
    this.logger.debug('Executing join operation', {
      inputLength: data.length,
      separator: op.using,
    });

    const result = data.join(op.using);
    this.logger.debug('Join operation completed', {
      inputLength: data.length,
      resultLength: result.length,
    });
    return result;
  }

  private validateArray(data: any, operation: string): void {
    if (!Array.isArray(data)) {
      throw new Error(`${operation} operation requires an array input, got ${typeof data}`);
    }
  }
}

/**
 * Step executor that handles transform steps
 */
export class TransformStepExecutor implements StepExecutor {
  private logger: Logger;
  private transformExecutor: TransformExecutor;

  constructor(
    expressionEvaluator: SafeExpressionEvaluator,
    referenceResolver: ReferenceResolver,
    context: Record<string, any>,
    logger: Logger,
  ) {
    this.logger = logger.createNested('TransformStepExecutor');
    this.transformExecutor = new TransformExecutor(
      expressionEvaluator,
      referenceResolver,
      context,
      logger,
    );
  }

  canExecute(step: Step): step is TransformStep {
    return 'transform' in step;
  }

  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): Promise<StepExecutionResult> {
    if (!this.canExecute(step)) {
      throw new Error('Invalid step type for TransformStepExecutor');
    }

    const transformStep = step as TransformStep;

    this.logger.debug('Executing transform step', {
      stepName: step.name,
      operations: transformStep.transform.operations.map((op) => op.type),
    });

    try {
      // Resolve input references
      const resolvedInput = context.referenceResolver.resolveReferences(
        transformStep.transform.input,
        extraContext,
      );

      this.logger.debug('Resolved transform input', {
        stepName: step.name,
        inputType: typeof resolvedInput,
        isArray: Array.isArray(resolvedInput),
      });

      const result = await this.transformExecutor.execute(
        transformStep.transform.operations,
        resolvedInput,
      );

      this.logger.debug('Transform completed successfully', {
        stepName: step.name,
        resultType: typeof result,
        isArray: Array.isArray(result),
      });

      return {
        result,
        type: StepType.Transform,
        metadata: {
          operations: transformStep.transform.operations.map((op) => ({
            type: op.type,
            using: op.using,
            initial: 'initial' in op ? op.initial : undefined,
          })),
          inputType: Array.isArray(resolvedInput) ? 'array' : typeof resolvedInput,
          resultType: Array.isArray(result) ? 'array' : typeof result,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      this.logger.error('Transform failed', {
        stepName: step.name,
        error: error.message || String(error),
      });
      throw error;
    }
  }
}
