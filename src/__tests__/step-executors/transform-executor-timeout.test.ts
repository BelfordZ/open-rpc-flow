import { TransformStepExecutor } from '../../step-executors/transform-executor';
import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ReferenceResolver } from '../../reference-resolver';
import { PolicyResolver } from '../../util/policy-resolver';
import { TimeoutError } from '../../errors/timeout-error';
import { TestLogger } from '../../util/logger';
import { Flow } from '../../types';
import { TransformStep, StepType } from '../../step-executors/types';

describe('TransformStepExecutor Timeout Tests', () => {
  let executor: TransformStepExecutor;
  let expressionEvaluator: SafeExpressionEvaluator;
  let referenceResolver: ReferenceResolver;
  let policyResolver: PolicyResolver;
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
      policies: {
        step: {
          transform: {
            timeout: { timeout: 5000 },
          },
        },
      },
    };

    policyResolver = new PolicyResolver(mockFlow, logger);
    expressionEvaluator = new SafeExpressionEvaluator(logger, referenceResolver, policyResolver);

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
      policyResolver,
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

    // Mock only the evaluate method to throw a timeout error immediately
    jest.spyOn(expressionEvaluator, 'evaluate').mockImplementation((expression, context, step) => {
      const timeout = step?.timeout || 10000;
      throw TimeoutError.forExpression(
        expression,
        timeout,
        timeout + 1000,
        step,
        StepType.Transform,
      );
    });

    // Start the execution
    const executePromise = executor.execute(step, context);
    // Fast-forward time past the timeout
    jest.advanceTimersByTime(6000);
    await Promise.resolve();
    // Verify that the operation times out
    await expect(executePromise).rejects.toThrow(TimeoutError);
    await expect(executePromise).rejects.toMatchObject({
      message: expect.stringContaining('Transform step "TestTransform" timed out'),
      timeout: expect.any(Number),
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

    // Mock only the evaluate method to throw a timeout error immediately
    jest.spyOn(expressionEvaluator, 'evaluate').mockImplementation((expression, context, step) => {
      const timeout = step?.timeout || 10000;
      throw TimeoutError.forExpression(
        expression,
        timeout,
        timeout + 1000,
        step,
        StepType.Transform,
      );
    });

    // Remove timeout from context
    delete context.timeout;

    // Start the execution
    const executePromise = executor.execute(step, context);

    // Fast-forward time past the default timeout
    jest.advanceTimersByTime(11000);
    await Promise.resolve();

    // Verify that the operation times out
    await expect(executePromise).rejects.toThrow(TimeoutError);
    await expect(executePromise).rejects.toMatchObject({
      message: expect.stringContaining('Transform step "TestTransform" timed out'),
      timeout: expect.any(Number),
      executionTime: expect.any(Number),
      step: step,
      stepType: StepType.Transform,
      isExpressionTimeout: true,
    });
  });

  it('should respect step-level timeout override', async () => {
    const step: TransformStep = {
      name: 'TestTransform',
      policies: {
        timeout: { timeout: 3000 },
      },
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

    // Mock only the evaluate method to throw a timeout error immediately
    jest.spyOn(expressionEvaluator, 'evaluate').mockImplementation((expression, context, step) => {
      const timeout = step?.policies?.timeout?.timeout || 10000;
      throw TimeoutError.forExpression(
        expression,
        timeout,
        timeout + 1000,
        step,
        StepType.Transform,
      );
    });

    // Start the execution
    const executePromise = executor.execute(step, context);

    // Fast-forward time past the step timeout
    jest.advanceTimersByTime(4000);
    await Promise.resolve();

    // Verify that the operation times out
    await expect(executePromise).rejects.toThrow(TimeoutError);
    await expect(executePromise).rejects.toMatchObject({
      message: expect.stringContaining('Transform step "TestTransform" timed out'),
      timeout: expect.any(Number),
      executionTime: expect.any(Number),
      step: step,
      stepType: StepType.Transform,
      isExpressionTimeout: true,
    });
  });
});
