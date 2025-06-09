import { DelayStepExecutor } from '../../step-executors/delay-executor';
import { StepType } from '../../step-executors/types';
import { createMockContext } from '../test-utils';
import { noLogger } from '../../util/logger';

describe('DelayStepExecutor', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('executes the nested step after the delay', async () => {
    const nestedResult = { type: StepType.Request, result: { ok: true } } as any;
    const executeStep = jest.fn().mockResolvedValue(nestedResult);
    const executor = new DelayStepExecutor(executeStep, noLogger);
    const context = createMockContext();

    const step = {
      name: 'delayTest',
      delay: {
        duration: 100,
        step: { name: 'inner', request: { method: 'm', params: {} } },
      },
    };

    const promise = executor.execute(step as any, context);

    jest.advanceTimersByTime(100);
    await Promise.resolve();

    const result = await promise;

    expect(executeStep).toHaveBeenCalledWith(
      step.delay.step,
      { _nestedStep: true, _parentStep: step.name },
      undefined,
    );
    expect(result.type).toBe(StepType.Delay);
    expect(result.result).toBe(nestedResult);
  });

  it('throws for invalid step', async () => {
    const executor = new DelayStepExecutor(jest.fn(), noLogger);
    const context = createMockContext();

    await expect(
      executor.execute({ name: 'bad', request: { method: 'm', params: {} } } as any, context),
    ).rejects.toThrow('Invalid step type for DelayStepExecutor');
  });

  it('throws for negative duration', async () => {
    const executor = new DelayStepExecutor(jest.fn(), noLogger);
    const context = createMockContext();

    const step = {
      name: 'negative',
      delay: { duration: -1, step: { name: 'inner', request: { method: 'm', params: {} } } },
    } as any;

    await expect(executor.execute(step, context)).rejects.toThrow(
      'Delay duration must be non-negative',
    );
  });

  it('aborts when signal is triggered', async () => {
    const executeStep = jest.fn();
    const executor = new DelayStepExecutor(executeStep, noLogger);
    const context = createMockContext();
    const controller = new AbortController();

    const step = {
      name: 'abort',
      delay: { duration: 50, step: { name: 'inner', request: { method: 'm', params: {} } } },
    } as any;

    const promise = executor.execute(step, context, {}, controller.signal);
    controller.abort();

    await expect(promise).rejects.toThrow('Delay aborted');
    expect(executeStep).not.toHaveBeenCalled();
  });

  it('aborts immediately if already aborted', async () => {
    const executeStep = jest.fn();
    const executor = new DelayStepExecutor(executeStep, noLogger);
    const context = createMockContext();
    const controller = new AbortController();
    controller.abort();

    const step = {
      name: 'alreadyAborted',
      delay: { duration: 50, step: { name: 'inner', request: { method: 'm', params: {} } } },
    } as any;

    await expect(executor.execute(step, context, {}, controller.signal)).rejects.toThrow(
      'Delay aborted',
    );
    expect(executeStep).not.toHaveBeenCalled();
  });
});
