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
import { TimeoutError } from '../errors/timeout-error';
import { PolicyResolver } from '../util/policy-resolver';
import { ValidationError } from '../errors/base';

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

  async execute(
    operations: TransformOperation[],
    input: string | any[],
    step?: Step,
    signal?: AbortSignal,
    outputCollector?: (key: string, value: unknown) => void,
  ): Promise<any> {
    this.logger.debug('Starting transform execution', {
      operationCount: operations.length,
      operations: operations.map((op) => ({ type: op.type, as: op.as })),
      inputType: typeof input,
      isArray: Array.isArray(input),
      hasStep: !!step,
    });

    let data: any;
    if (typeof input === 'string' && !Array.isArray(input)) {
      // Evaluate the input expression
      data = await this.expressionEvaluator.evaluate(input, this.context, step);
    } else {
      // Use the array literal directly
      data = input;
    }

    for (const op of operations) {
      this.logger.debug('Executing operation', {
        type: op.type,
        using: op.using,
        as: op.as,
        dataType: typeof data,
        isArray: Array.isArray(data),
      });

      if (signal?.aborted) {
        this.logger.warn('Transform aborted by signal', { stepName: step?.name });
        throw new Error('Transform step aborted');
      }

      data = await this.executeOperation(op, data, step, signal);

      if (op.as) {
        this.logger.debug('Storing operation result in metadata outputs', {
          key: op.as,
          resultType: typeof data,
          isArray: Array.isArray(data),
        });
        outputCollector?.(op.as, data);
      }
    }

    this.logger.debug('Transform execution completed', {
      resultType: typeof data,
      isArray: Array.isArray(data),
      resultLength: Array.isArray(data) ? data.length : undefined,
    });

    return data;
  }

  private async executeOperation(
    op: TransformOperation,
    data: any,
    step?: Step,
    signal?: AbortSignal,
  ): Promise<any> {
    this.logger.debug('Executing operation', {
      type: op.type,
      using: op.using,
      as: op.as,
      dataType: typeof data,
      isArray: Array.isArray(data),
      hasStep: !!step,
    });

    try {
      switch (op.type) {
        case 'map':
          return await this.executeMap(op, data, step, signal);
        case 'filter':
          return await this.executeFilter(op, data, step, signal);
        case 'reduce':
          return await this.executeReduce(op, data, step, signal);
        case 'flatten':
          return this.executeFlatten(op, data);
        case 'sort':
          return await this.executeSort(op, data, step, signal);
        case 'unique':
          return this.executeUnique(op, data);
        case 'group':
          return await this.executeGroup(op, data, step, signal);
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

  private async executeMap(
    op: TransformOperation,
    data: any[],
    step?: Step,
    signal?: AbortSignal,
  ): Promise<any[]> {
    this.validateArray(data, 'map');
    this.logger.debug('Executing map operation', {
      inputLength: data.length,
      expression: op.using,
      hasStep: !!step,
    });

    const start = Date.now();
    const timeout = step?.timeout ?? 10000; // fallback to default if not set
    const result: any[] = [];
    for (let index = 0; index < data.length; index++) {
      if (signal?.aborted) {
        this.logger.warn('Transform map aborted by signal', { stepName: step?.name });
        throw new Error('Transform map operation aborted');
      }
      if (Date.now() - start > timeout) {
        throw new TimeoutError(
          `Transform step "${step?.name}" timed out after ${timeout}ms`,
          timeout,
          Date.now() - start,
          step,
          StepType.Transform,
          false,
        );
      }
      const context = { item: data[index], index };
      const mapped = this.expressionEvaluator.evaluate(op.using, context, step);
      this.logger.debug('Mapped item', {
        index,
        originalType: typeof data[index],
        resultType: typeof mapped,
      });
      result.push(mapped);
    }

    this.logger.debug('Map operation completed', {
      inputLength: data.length,
      outputLength: result.length,
    });
    return result;
  }

  private async executeFilter(
    op: TransformOperation,
    data: any[],
    step?: Step,
    signal?: AbortSignal,
  ): Promise<any[]> {
    this.validateArray(data, 'filter');
    this.logger.debug('Executing filter operation', {
      inputLength: data.length,
      expression: op.using,
      hasStep: !!step,
    });

    const keepArr = await Promise.all(
      data.map(async (item, index) => {
        if (signal?.aborted) {
          this.logger.warn('Transform filter aborted by signal', { stepName: step?.name });
          throw new Error('Transform filter operation aborted');
        }
        const context = { item, index };
        const keep = await this.expressionEvaluator.evaluate(op.using, context, step);
        this.logger.debug('Filter evaluation', { index, keep });
        return keep;
      }),
    );
    const result = data.filter((_, idx) => keepArr[idx]);

    this.logger.debug('Filter operation completed', {
      inputLength: data.length,
      outputLength: result.length,
      filteredOutCount: data.length - result.length,
    });
    return result;
  }

  private async executeReduce(
    op: TransformOperation,
    data: any[],
    step?: Step,
    signal?: AbortSignal,
  ): Promise<any> {
    this.validateArray(data, 'reduce');
    this.logger.debug('Executing reduce operation', {
      inputLength: data.length,
      expression: op.using,
      hasInitialValue: 'initial' in op,
      hasStep: !!step,
    });

    let acc = op.initial;
    for (let index = 0; index < data.length; index++) {
      if (signal?.aborted) {
        this.logger.warn('Transform reduce aborted by signal', { stepName: step?.name });
        throw new Error('Transform reduce operation aborted');
      }
      const item = data[index];
      const context = { acc, item, index };
      acc = await this.expressionEvaluator.evaluate(op.using, context, step);
      this.logger.debug('Reduced item', {
        index,
        accType: typeof acc,
        itemType: typeof item,
        resultType: typeof acc,
      });
    }

    this.logger.debug('Reduce operation completed', {
      inputLength: data.length,
      resultType: typeof acc,
    });
    return acc;
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

  private async executeSort(
    op: TransformOperation,
    data: any[],
    step?: Step,
    signal?: AbortSignal,
  ): Promise<any[]> {
    this.validateArray(data, 'sort');
    this.logger.debug('Executing sort operation', {
      inputLength: data.length,
      expression: op.using,
      hasStep: !!step,
    });

    const result = [...data];
    for (let i = 0; i < result.length; i++) {
      for (let j = i + 1; j < result.length; j++) {
        if (signal?.aborted) {
          this.logger.warn('Transform sort aborted by signal', { stepName: step?.name });
          throw new Error('Transform sort operation aborted');
        }
        const context = { a: result[i], b: result[j], indexA: i, indexB: j };
        this.logger.debug('Sort comparison context', {
          aKey: context.a.key,
          bKey: context.b.key,
          aKeyType: typeof context.a.key,
          bKeyType: typeof context.b.key,
        });
        const cmp = await this.expressionEvaluator.evaluate(op.using, context, step);
        if (cmp > 0) {
          // Swap
          const temp = result[i];
          result[i] = result[j];
          result[j] = temp;
        }
      }
    }

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

    const result = Array.from(new Set(data));
    this.logger.debug('Unique operation completed', {
      inputLength: data.length,
      outputLength: result.length,
    });
    return result;
  }

  private async executeGroup(
    op: TransformOperation,
    data: any[],
    step?: Step,
    signal?: AbortSignal,
  ): Promise<any[]> {
    this.validateArray(data, 'group');
    this.logger.debug('Executing group operation', {
      inputLength: data.length,
      expression: op.using,
      hasStep: !!step,
    });

    const groups: Record<string, any[]> = {};
    for (let index = 0; index < data.length; index++) {
      if (signal?.aborted) {
        this.logger.warn('Transform group aborted by signal', { stepName: step?.name });
        throw new Error('Transform group operation aborted');
      }
      const item = data[index];
      const context = { item, index };
      const key = await this.expressionEvaluator.evaluate(op.using, context, step);
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }
    // Return array of { key, items }
    const result = Object.entries(groups).map(([key, items]) => ({ key, items }));
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
      throw new ValidationError(`Input to ${operation} operation must be an array`, {
        receivedType: typeof data,
        operation,
      });
    }
  }
}

/**
 * Step executor that handles transform steps
 */
export class TransformStepExecutor implements StepExecutor {
  private logger: Logger;
  private transformExecutor: TransformExecutor;
  private policyResolver: PolicyResolver;

  constructor(
    expressionEvaluator: SafeExpressionEvaluator,
    referenceResolver: ReferenceResolver,
    context: Record<string, any>,
    logger: Logger,
    policyResolver: PolicyResolver,
  ) {
    this.logger = logger.createNested('TransformStepExecutor');
    this.transformExecutor = new TransformExecutor(
      expressionEvaluator,
      referenceResolver,
      context,
      logger,
    );
    this.policyResolver = policyResolver;
  }

  canExecute(step: Step): step is TransformStep {
    return 'transform' in step;
  }

  async execute(
    step: Step,
    context: StepExecutionContext,
    extraContext: Record<string, any> = {},
    signal?: AbortSignal,
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
      // Get timeout using PolicyResolver
      const timeout = this.policyResolver.resolveTimeout(step, StepType.Transform);

      this.logger.debug('Using timeout for transform step', {
        stepName: step.name,
        timeout,
        hasStepTimeout: step.timeout !== undefined,
        hasContextTimeout: (context as any).timeout !== undefined,
      });

      // Create a step context for expression evaluation
      const stepContext: Step = {
        name: step.name,
        timeout,
      };

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

      const outputs: Record<string, unknown> = {};
      const result = await this.transformExecutor.execute(
        transformStep.transform.operations,
        resolvedInput,
        stepContext,
        signal,
        (key, value) => {
          outputs[key] = value;
        },
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
          inputType: 'array',
          resultType: Array.isArray(result) ? 'array' : typeof result,
          timestamp: new Date().toISOString(),
          timeout,
          ...(Object.keys(outputs).length > 0 ? { outputs } : {}),
        },
      };
    } catch (error: any) {
      this.logger.error('Transform failed', {
        stepName: step.name,
        error: error.toString(),
      });

      // Enhance timeout errors with step context
      if (error instanceof TimeoutError) {
        throw new TimeoutError(
          `Transform step "${step.name}" timed out: ${error.message}`,
          error.timeout,
          error.executionTime,
          step,
          StepType.Transform,
          error.isExpressionTimeout,
        );
      }

      throw error;
    }
  }
}
