import {
  FlowError,
  ValidationError,
  ExecutionError,
  ErrorCode,
  RetryableOperation,
  RetryPolicy,
} from '../../errors';
import { noLogger, TestLogger } from '../../util/logger';
import { FlowExecutor } from '../../flow-executor';
import { Flow } from '../../types';
import { TransformStepExecutor } from '../../step-executors/transform-executor';
import { JsonRpcRequestError, StepType } from '../../step-executors/types';

describe('Error Framework', () => {
  let testLogger: TestLogger;

  beforeEach(() => {
    testLogger = new TestLogger('ErrorFrameworkTest');
  });

  afterEach(() => {
    //testLogger.print();
    testLogger.clear();
  });

  describe('Error Classes', () => {
    it('should create FlowError with context', () => {
      const context = { foo: 'bar' };
      const error = new FlowError('test error', ErrorCode.INTERNAL_ERROR, context);

      expect(error.message).toBe('test error');
      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.context).toEqual(context);
      expect(error.name).toBe('FlowError');
    });

    it('should create ValidationError', () => {
      const context = { field: 'name', value: null };
      const error = new ValidationError('Invalid field', context);

      expect(error.message).toBe('Invalid field');
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.context).toEqual(context);
      expect(error instanceof FlowError).toBe(true);
    });

    it('should create ExecutionError with cause', () => {
      const cause = new Error('original error');
      const context = { operation: 'test' };
      const error = new ExecutionError('Execution failed', context, cause);

      expect(error.message).toBe('Execution failed');
      expect(error.code).toBe(ErrorCode.EXECUTION_ERROR);
      expect(error.context).toEqual(context);
      expect(error.cause).toBe(cause);
      expect(error instanceof FlowError).toBe(true);
    });
  });

  describe('RetryableOperation', () => {
    const policy: RetryPolicy = {
      maxAttempts: 3,
      backoff: {
        initial: 0,
        multiplier: 1,
        maxDelay: 0,
      },
      retryableErrors: [ErrorCode.NETWORK_ERROR],
    };

    it('should retry on retryable error', async () => {
      const logger = testLogger.createNested('debugging');

      // Use the approach from recovery.test.ts that works
      const networkError = new FlowError('network error', ErrorCode.NETWORK_ERROR, {});

      // Verify that the error has the correct code
      logger.debug('Network error details', {
        error: networkError,
        code: networkError.code,
        codeType: typeof networkError.code,
        errorType: networkError.constructor.name,
        isFlowError: networkError instanceof FlowError,
      });

      // Use the working implementation from recovery.test.ts
      const operation = jest
        .fn()
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce('success');

      const retryable = new RetryableOperation(operation, policy, logger);

      const result = await retryable.execute();

      logger.debug('Operation result', { result });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should not retry on non-retryable error', async () => {
      const operation = jest.fn().mockImplementation(() => {
        throw new ValidationError('Invalid input', {
          code: ErrorCode.INVALID_INPUT,
        });
      });

      const retryable = new RetryableOperation(operation, policy, noLogger);

      await expect(retryable.execute()).rejects.toThrow('Invalid input');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should throw after max attempts', async () => {
      const operationLogger = testLogger.createNested('operation');
      let attempts = 0;

      const operation = jest.fn().mockImplementation(() => {
        attempts++;
        operationLogger.debug('Creating error', { attempt: attempts });

        // Create a FlowError directly instead of ExecutionError
        const error = new FlowError('Network error', ErrorCode.NETWORK_ERROR, {
          attempts,
        });

        operationLogger.debug('Created error', {
          errorType: error.constructor.name,
          errorCode: error.code,
          message: error.message,
        });

        throw error;
      });

      const retryableLogger = testLogger.createNested('retryable');
      const retryable = new RetryableOperation(operation, policy, retryableLogger);

      const error = (await retryable.execute().catch((e) => e)) as FlowError;

      // Check by constructor name instead of instanceof
      expect(error.constructor.name).toBe('MaxRetriesExceededError');
      expect(error.message).toBe('Max retry attempts exceeded');
      expect(error.context.code).toBe(ErrorCode.MAX_RETRIES_EXCEEDED);
      expect(operation).toHaveBeenCalledTimes(3);
      expect(attempts).toBe(3);
    });
  });

  describe('Issue #51: step error detail preservation', () => {
    let jsonRpcHandler: jest.Mock;

    const transformStep = (name: string): any => ({
      name,
      transform: {
        input: '${context.value}',
        operations: [{ type: 'map', using: '${item}' }],
      },
    });

    const makeFlow = (steps: any[]): Flow => ({
      name: 'Error Detail Flow',
      description: 'flow for issue #51 error detail tests',
      steps,
    });

    beforeEach(() => {
      jsonRpcHandler = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('wraps plain errors in ExecutionError preserving cause, code, and step context', async () => {
      const originalError = new Error('connection reset');
      (originalError as any).code = 'ECONNRESET';
      jest.spyOn(TransformStepExecutor.prototype, 'execute').mockRejectedValue(originalError);

      const executor = new FlowExecutor(makeFlow([transformStep('failing_step')]), jsonRpcHandler, {
        logger: testLogger,
      });

      const error = (await executor.execute().catch((e) => e)) as ExecutionError;

      expect(error).toBeInstanceOf(ExecutionError);
      expect(error.message).toBe('Failed to execute step failing_step: connection reset');
      expect(error.cause).toBe(originalError);
      expect(error.code).toBe('ECONNRESET');
      expect(error.context.stepName).toBe('failing_step');
    });

    it('passes FlowError subclasses through without wrapping', async () => {
      const validationError = new ValidationError('Invalid input value', { field: 'value' });
      jest.spyOn(TransformStepExecutor.prototype, 'execute').mockRejectedValue(validationError);

      const executor = new FlowExecutor(makeFlow([transformStep('bad_step')]), jsonRpcHandler, {
        logger: testLogger,
      });

      const error = await executor.execute().catch((e) => e);

      expect(error).toBe(validationError);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.context).toEqual({ field: 'value', stepResults: {} });
    });

    it('passes JsonRpcRequestError through so the error response stays intact', async () => {
      const rpcError = new JsonRpcRequestError('JSON-RPC error occurred', {
        code: -32602,
        message: 'Invalid params',
        data: { detail: 'missing required field' },
      });
      jsonRpcHandler.mockRejectedValue(rpcError);

      const executor = new FlowExecutor(
        makeFlow([{ name: 'rpc_step', request: { method: 'doThing', params: {} } }]),
        jsonRpcHandler,
        { logger: testLogger },
      );

      const error = await executor.execute().catch((e) => e);

      expect(error).toBe(rpcError);
      expect(error).toBeInstanceOf(JsonRpcRequestError);
      expect(error.error).toEqual({
        code: -32602,
        message: 'Invalid params',
        data: { detail: 'missing required field' },
      });
    });

    it('keeps the legacy message for non-Error throwables', async () => {
      const customError = { toString: () => 'Custom error without message' };
      jest.spyOn(TransformStepExecutor.prototype, 'execute').mockRejectedValue(customError);

      const executor = new FlowExecutor(makeFlow([transformStep('error_step')]), jsonRpcHandler, {
        logger: testLogger,
      });

      const error = (await executor.execute().catch((e) => e)) as ExecutionError;

      expect(error).toBeInstanceOf(ExecutionError);
      expect(error.message).toBe('Failed to execute step error_step: Custom error without message');
      expect(error.cause).toBeUndefined();
      expect(error.code).toBe(ErrorCode.EXECUTION_ERROR);
    });

    it('includes completed steps in the error context (issue #19)', async () => {
      jest
        .spyOn(TransformStepExecutor.prototype, 'execute')
        .mockImplementation(async (step: any) => {
          if (step.name === 'second_step') {
            throw new Error('second step blew up');
          }
          return { type: StepType.Transform, result: 'ok' };
        });

      // second_step references first_step so it runs strictly after it
      const secondStep = transformStep('second_step');
      secondStep.transform.input = '${first_step.result}';

      const executor = new FlowExecutor(
        makeFlow([transformStep('first_step'), secondStep]),
        jsonRpcHandler,
        { logger: testLogger },
      );

      const error = (await executor.execute().catch((e) => e)) as ExecutionError;

      expect(error).toBeInstanceOf(ExecutionError);
      expect(error.context.stepName).toBe('second_step');
      expect(error.context.completedSteps).toEqual(['first_step']);
      expect(error.cause).toBeInstanceOf(Error);
      expect((error.cause as Error).message).toBe('second step blew up');
    });
  });

  describe('Issue #162: successful step results in flow failure errors', () => {
    let jsonRpcHandler: jest.Mock;

    const requestStep = (name: string, method: string, params: unknown = {}): any => ({
      name,
      request: { method, params },
    });

    const makeFlow = (steps: any[]): Flow => ({
      name: 'Step Results Flow',
      description: 'flow for issue #162 step-results-in-failure tests',
      steps,
    });

    beforeEach(() => {
      jsonRpcHandler = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('attaches successful step results to a single-step failure', async () => {
      jsonRpcHandler.mockImplementation(async (req: any) => {
        if (req.method === 'fail') throw new Error('boom');
        return { echo: req.method };
      });
      // Each step references the previous one so they run strictly in order.
      const step2 = requestStep('step2', 'b', { prev: '${step1.result.echo}' });
      const step3 = requestStep('step3', 'fail', { prev: '${step2.result.echo}' });

      const executor = new FlowExecutor(
        makeFlow([requestStep('step1', 'a'), step2, step3]),
        jsonRpcHandler,
        { logger: testLogger },
      );

      const error = (await executor.execute().catch((e) => e)) as ExecutionError;

      expect(error).toBeInstanceOf(ExecutionError);
      expect(error.context.stepName).toBe('step3');
      expect(Object.keys(error.context.stepResults)).toEqual(['step1', 'step2']);
      expect(error.context.stepResults.step1.result).toEqual({ echo: 'a' });
      expect(error.context.stepResults.step2.result).toEqual({ echo: 'b' });
      expect(error.context.stepResults).not.toHaveProperty('step3');
    });

    it('keeps the error identity and message when attaching step results', async () => {
      jsonRpcHandler.mockRejectedValue(new Error('boom'));

      const executor = new FlowExecutor(
        makeFlow([requestStep('only_step', 'fail')]),
        jsonRpcHandler,
        { logger: testLogger },
      );

      const error = (await executor.execute().catch((e) => e)) as ExecutionError;

      expect(error).toBeInstanceOf(ExecutionError);
      expect(error.message).toBe('Failed to execute request step "only_step": boom');
      expect(error.context.stepResults).toEqual({});
    });

    it('attaches step results to the multi-error aggregation', async () => {
      jsonRpcHandler.mockImplementation(async (req: any) => {
        if (req.method === 'fail') throw new Error('boom');
        return { echo: req.method };
      });
      // Independent steps: the two failures accumulate instead of aborting.
      const executor = new FlowExecutor(
        makeFlow([
          requestStep('ok_step', 'a'),
          requestStep('bad_step_1', 'fail'),
          requestStep('bad_step_2', 'fail'),
        ]),
        jsonRpcHandler,
        { logger: testLogger },
      );

      const error = (await executor.execute().catch((e) => e)) as ExecutionError;

      expect(error).toBeInstanceOf(ExecutionError);
      expect(error.message).toBe('Flow execution failed with multiple errors');
      expect(error.context.failedSteps).toHaveLength(2);
      expect(error.context.failedSteps).toEqual(
        expect.arrayContaining(['bad_step_1', 'bad_step_2']),
      );
      expect(error.context.stepResults.ok_step.result).toEqual({ echo: 'a' });
      expect(Object.keys(error.context.stepResults)).toEqual(['ok_step']);
    });

    it('snapshots step results so later resets cannot corrupt the error', async () => {
      jsonRpcHandler.mockImplementation(async (req: any) => {
        if (req.method === 'fail') throw new Error('boom');
        return { echo: req.method };
      });
      const step2 = requestStep('step2', 'fail', { prev: '${step1.result.echo}' });

      const executor = new FlowExecutor(
        makeFlow([requestStep('step1', 'a'), step2]),
        jsonRpcHandler,
        { logger: testLogger },
      );

      const error = (await executor.execute().catch((e) => e)) as ExecutionError;
      expect(error.context.stepResults.step1.result).toEqual({ echo: 'a' });

      // reset() clears the executor's live results map; the error must keep
      // its own snapshot.
      await executor.reset();
      expect(error.context.stepResults.step1.result).toEqual({ echo: 'a' });
      expect(Object.keys(error.context.stepResults)).toEqual(['step1']);
    });
  });
});
