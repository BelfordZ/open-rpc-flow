import { StopStepExecutor } from '../../step-executors/stop-executor';
import { StopBranch } from '../../errors/stop-branch';
import { noLogger } from '../../util/logger';
import { createMockContext } from '../test-utils';

describe('StopStepExecutor', () => {
  let executor: StopStepExecutor;

  beforeEach(() => {
    executor = new StopStepExecutor(noLogger);
  });

  it('should stop the entire workflow when endWorkflow is true', async () => {
    const step = {
      name: 'stopStep',
      stop: {
        endWorkflow: true,
      },
    };

    const context = createMockContext();
    const result = await executor.execute(step, context);

    expect(result.type).toBe('stop');
    expect(result.result.endWorkflow).toBe(true);
    expect(result.metadata?.endWorkflow).toBe(true);
  });

  it('should throw StopBranch when endWorkflow is false', async () => {
    const step = {
      name: 'stopStep',
      stop: {
        endWorkflow: false,
      },
    };

    const context = createMockContext();
    const error = await executor.execute(step, context).catch((e) => e);

    expect(error).toBeInstanceOf(StopBranch);
    expect(error.stepName).toBe('stopStep');
    // The signal carries the result the step would have returned, so the
    // branch boundary can report the stop step as complete.
    expect(error.result.type).toBe('stop');
    expect(error.result.result.endWorkflow).toBe(false);
    expect(error.result.metadata?.endWorkflow).toBe(false);
  });

  it('should throw StopBranch by default when endWorkflow is not provided', async () => {
    const step = {
      name: 'stopStep',
      stop: {},
    };

    const context = createMockContext();
    const error = await executor.execute(step, context).catch((e) => e);

    expect(error).toBeInstanceOf(StopBranch);
    expect(error.stepName).toBe('stopStep');
    expect(error.result.type).toBe('stop');
    expect(error.result.result.endWorkflow).toBe(false);
    expect(error.result.metadata?.endWorkflow).toBe(false);
  });

  it('should throw an error for invalid step type', async () => {
    const invalidStep = {
      name: 'invalidStep',
      request: {
        method: 'some.method',
        params: {},
      },
    };

    const context = createMockContext();
    await expect(executor.execute(invalidStep as any, context)).rejects.toThrow(
      'Invalid step type for StopStepExecutor',
    );
  });
});
