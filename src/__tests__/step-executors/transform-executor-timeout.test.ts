import { TransformStepExecutor } from '../../step-executors/transform-executor';
import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ReferenceResolver } from '../../reference-resolver';
import { TimeoutResolver } from '../../util/timeout-resolver';
import { EnhancedTimeoutError } from '../../errors/timeout-error';
import { TestLogger } from '../../util/logger';
import { Flow, Step } from '../../types';
import { TransformStep, StepType } from '../../step-executors/types';

describe('TransformStepExecutor Timeout Tests', () => {
  let executor: TransformStepExecutor;
  let expressionEvaluator: SafeExpressionEvaluator;
  let referenceResolver: ReferenceResolver;
  let timeoutResolver: TimeoutResolver;
  let logger: TestLogger;
  let context: any;

  beforeEach(() => {
    // Enable fake timers
    jest.useFakeTimers();

    logger = new TestLogger('TransformExecutor');

    // Create real instances with minimal mocking
    const stepResults = new Map<string, any>();
    const contextObj = {};
    referenceResolver = new ReferenceResolver(stepResults, contextObj, logger);

    // Create mock flow
    const mockFlow: Flow = {
      name: 'Test Flow',
      description: 'Test flow description',
      steps: [],
      timeouts: {
        transform: 5000,
      },
    };

    timeoutResolver = new TimeoutResolver(mockFlow, { transform: 5000 }, logger);
    expressionEvaluator = new SafeExpressionEvaluator(logger, referenceResolver, timeoutResolver);

    // Setup context
    context = {
      referenceResolver,
      stepResults,
      timeout: 5000, // Default timeout
    };

    // Add test data
    stepResults.set('items', [1, 2, 3]);

    // Create executor
    executor = new TransformStepExecutor(
      expressionEvaluator,
      referenceResolver,
      contextObj,
      logger,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should pass timeout from context to expression evaluator', async () => {
    const step: TransformStep = {
      name: 'TestTransform',
      transform: {
        input: '${items}',
        operations: [
          {
            type: 'map',
            using: '${item} * 2',
          },
        ],
      },
    };

    // Mock only the evaluate method to throw a timeout error after the specified time
    jest.spyOn(expressionEvaluator, 'evaluate').mockImplementation(async (expression, context, step) => {
      const timeout = step?.timeout || context.timeout || 10000;
      await new Promise(resolve => setTimeout(resolve, timeout + 1000)); // Wait longer than the timeout
      throw EnhancedTimeoutError.forExpression(expression, timeout, timeout + 1000, step);
    });

    // Start the execution
    const executePromise = executor.execute(step, context);
    // Fast-forward time past the timeout
    jest.advanceTimersByTime(6000);
    await Promise.resolve();
    // Verify that the operation times out
    await expect(executePromise).rejects.toThrow(EnhancedTimeoutError);
    await expect(executePromise).rejects.toMatchObject({
      message: expect.stringContaining('Transform step "TestTransform" timed out'),
      timeout: 5000,
      executionTime: expect.any(Number),
      step: step,
      stepType: StepType.Transform,
      isExpressionTimeout: true,
    });
  });

  it('should use default timeout when not provided in context', async () => {
    const step: TransformStep = {
      name: 'TestTransform',
      transform: {
        input: '${items}',
        operations: [
          {
            type: 'map',
            using: '${item} * 2',
          },
        ],
      },
    };

    // Mock only the evaluate method to throw a timeout error after the specified time
    jest.spyOn(expressionEvaluator, 'evaluate').mockImplementation(async (expression, context, step) => {
      const timeout = step?.timeout || context.timeout || 10000;
      await new Promise(resolve => setTimeout(resolve, timeout + 1000)); // Wait longer than the timeout
      throw EnhancedTimeoutError.forExpression(expression, timeout, timeout + 1000, step);
    });

    // Remove timeout from context
    delete context.timeout;

    // Start the execution
    const executePromise = executor.execute(step, context);

    // Fast-forward time past the default timeout
    jest.advanceTimersByTime(11000);
    await Promise.resolve();

    // Verify that the operation times out
    await expect(executePromise).rejects.toThrow(EnhancedTimeoutError);
    await expect(executePromise).rejects.toMatchObject({
      message: expect.stringContaining('Transform step "TestTransform" timed out'),
      timeout: 10000, // Default transform timeout
      executionTime: expect.any(Number),
      step: step,
      stepType: StepType.Transform,
      isExpressionTimeout: true,
    });
  });

  it('should respect step-level timeout override', async () => {
    const step: TransformStep = {
      name: 'TestTransform',
      timeout: 3000, // Step-level timeout override
      transform: {
        input: '${items}',
        operations: [
          {
            type: 'map',
            using: '${item} * 2',
          },
        ],
      },
    };

    // Mock only the evaluate method to throw a timeout error after the specified time
    jest.spyOn(expressionEvaluator, 'evaluate').mockImplementation(async (expression, context, step) => {
      const timeout = step?.timeout || context.timeout || 10000;
      await new Promise(resolve => setTimeout(resolve, timeout + 1000)); // Wait longer than the timeout
      throw EnhancedTimeoutError.forExpression(expression, timeout, timeout + 1000, step);
    });

    // Start the execution
    const executePromise = executor.execute(step, context);

    // Fast-forward time past the step timeout
    jest.advanceTimersByTime(4000);
    await Promise.resolve();

    // Verify that the operation times out
    await expect(executePromise).rejects.toThrow(EnhancedTimeoutError);
    await expect(executePromise).rejects.toMatchObject({
      message: expect.stringContaining('Transform step "TestTransform" timed out'),
      timeout: 3000,
      executionTime: expect.any(Number),
      step: step,
      stepType: StepType.Transform,
      isExpressionTimeout: true,
    });
  });
}); 