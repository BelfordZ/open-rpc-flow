import { StopStepExecutor } from '../../step-executors/stop-executor';
import { noLogger } from '../../util/logger';

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

    const result = await executor.execute(step, {});

    expect(result.type).toBe('stop');
    expect(result.result.endWorkflow).toBe(true);
    expect(result.metadata?.endWorkflow).toBe(true);
  });

  it('should stop the current branch when endWorkflow is false', async () => {
    const step = {
      name: 'stopStep',
      stop: {
        endWorkflow: false,
      },
    };

    const result = await executor.execute(step, {});

    expect(result.type).toBe('stop');
    expect(result.result.endWorkflow).toBe(false);
    expect(result.metadata?.endWorkflow).toBe(false);
  });

  it('should default to stopping the current branch when endWorkflow is not provided', async () => {
    const step = {
      name: 'stopStep',
      stop: {},
    };

    const result = await executor.execute(step, {});

    expect(result.type).toBe('stop');
    expect(result.result.endWorkflow).toBe(false);
    expect(result.metadata?.endWorkflow).toBe(false);
  });

  it('should throw an error for invalid step type', async () => {
    const invalidStep = {
      name: 'invalidStep',
      request: {
        method: 'some.method',
        params: {},
      },
    };

    await expect(executor.execute(invalidStep as any, {})).rejects.toThrow(
      'Invalid step type for StopStepExecutor',
    );
  });
});
