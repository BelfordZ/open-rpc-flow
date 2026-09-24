import { ConditionStepExecutor } from '../../step-executors';
import { ConditionStep, StepType } from '../../step-executors/types';
import { StepExecutionResult } from '../../step-executors';
import { TestLogger } from '../../util/logger';
import { createMockContext } from '../test-utils';
import { StepExecutionContext } from '../../types';
import { PolicyResolver } from '../../util/policy-resolver';

describe('ConditionStepExecutor switch', () => {
  let executor: ConditionStepExecutor;
  let context: StepExecutionContext;
  let executeStep: jest.Mock;
  let testLogger: TestLogger;

  const mockResult = (name: string): StepExecutionResult => ({
    result: `${name}-done`,
    type: StepType.Request,
    metadata: {},
  });

  const requestStep = (
    name: string,
  ): { name: string; request: { method: string; params: Record<string, unknown> } } => ({
    name,
    request: { method: 'test.method', params: {} },
  });

  beforeEach(() => {
    testLogger = new TestLogger('ConditionStepExecutor');
    executeStep = jest.fn();
    const dummyFlow = { name: 'dummy', description: '', steps: [] };
    const policyResolver = new PolicyResolver(dummyFlow, testLogger);
    executor = new ConditionStepExecutor(executeStep, testLogger, policyResolver);
    context = createMockContext();
    executeStep.mockImplementation((step: { name: string }) =>
      Promise.resolve(mockResult(step.name)),
    );
  });

  afterEach(() => {
    testLogger.clear();
  });

  it('executes the matching string case', async () => {
    context.stepResults.set('step1', { status: 'foo' });

    const step: ConditionStep = {
      name: 'route',
      condition: {
        switch: '${step1.status}',
        cases: {
          foo: requestStep('handleFoo'),
          bar: requestStep('handleBar'),
        },
      },
    };

    const result = (await executor.execute(step, context)) as StepExecutionResult & {
      metadata: { branchTaken: string; conditionValue: unknown; condition: string };
    };

    expect(executeStep).toHaveBeenCalledTimes(1);
    expect(executeStep.mock.calls[0][0].name).toBe('handleFoo');
    expect(result.result).toEqual(mockResult('handleFoo'));
    expect(result.metadata.branchTaken).toBe('foo');
    expect(result.metadata.conditionValue).toBe('foo');
    expect(result.metadata.condition).toBe('${step1.status}');
  });

  it('matches a number value against its stringified case key', async () => {
    context.stepResults.set('step1', { code: 42 });

    const step: ConditionStep = {
      name: 'route',
      condition: {
        switch: '${step1.code}',
        cases: { '42': requestStep('handle42') },
      },
    };

    const result = (await executor.execute(step, context)) as StepExecutionResult & {
      metadata: { branchTaken: string; conditionValue: unknown };
    };

    expect(executeStep).toHaveBeenCalledTimes(1);
    expect(result.metadata.branchTaken).toBe('42');
    expect(result.metadata.conditionValue).toBe(42);
  });

  it('matches a boolean value against its stringified case key', async () => {
    context.stepResults.set('step1', { ok: true });

    const step: ConditionStep = {
      name: 'route',
      condition: {
        switch: '${step1.ok}',
        cases: { true: requestStep('handleTrue') } as unknown as Record<
          string,
          { name: string; request: { method: string; params: Record<string, unknown> } }
        >,
      },
    };

    const result = (await executor.execute(step, context)) as StepExecutionResult & {
      metadata: { branchTaken: string };
    };

    expect(executeStep).toHaveBeenCalledTimes(1);
    expect(result.metadata.branchTaken).toBe('true');
  });

  it('falls back to default when no case matches', async () => {
    context.stepResults.set('step1', { status: 'unknown' });

    const step: ConditionStep = {
      name: 'route',
      condition: {
        switch: '${step1.status}',
        cases: { foo: requestStep('handleFoo') },
        default: requestStep('handleDefault'),
      },
    };

    const result = (await executor.execute(step, context)) as StepExecutionResult & {
      metadata: { branchTaken: string };
    };

    expect(executeStep).toHaveBeenCalledTimes(1);
    expect(executeStep.mock.calls[0][0].name).toBe('handleDefault');
    expect(result.metadata.branchTaken).toBe('default');
  });

  it('skips when no case matches and no default is defined', async () => {
    context.stepResults.set('step1', { status: 'unknown' });

    const step: ConditionStep = {
      name: 'route',
      condition: {
        switch: '${step1.status}',
        cases: { foo: requestStep('handleFoo') },
      },
    };

    const result = (await executor.execute(step, context)) as StepExecutionResult & {
      metadata: { branchTaken: string };
    };

    expect(executeStep).not.toHaveBeenCalled();
    expect(result.result).toBeUndefined();
    expect(result.metadata.branchTaken).toBe('none');
  });

  it('executes a list of steps for a matching case in order', async () => {
    context.stepResults.set('step1', { status: 'bar' });

    const step: ConditionStep = {
      name: 'route',
      condition: {
        switch: '${step1.status}',
        cases: {
          bar: [requestStep('first'), requestStep('second')],
        },
      },
    };

    const result = (await executor.execute(step, context)) as StepExecutionResult & {
      metadata: { branchTaken: string };
    };

    expect(executeStep).toHaveBeenCalledTimes(2);
    expect(executeStep.mock.calls[0][0].name).toBe('first');
    expect(executeStep.mock.calls[1][0].name).toBe('second');
    expect(result.result).toEqual([mockResult('first'), mockResult('second')]);
    expect(result.metadata.branchTaken).toBe('bar');
  });

  it('supports a list of steps in default', async () => {
    context.stepResults.set('step1', { status: 'nope' });

    const step: ConditionStep = {
      name: 'route',
      condition: {
        switch: '${step1.status}',
        cases: { foo: requestStep('handleFoo') },
        default: [requestStep('d1'), requestStep('d2')],
      },
    };

    const result = (await executor.execute(step, context)) as StepExecutionResult;

    expect(executeStep).toHaveBeenCalledTimes(2);
    expect(result.result).toEqual([mockResult('d1'), mockResult('d2')]);
  });

  it('supports nested switch conditions inside a case', async () => {
    context.stepResults.set('step1', { status: 'outer' });
    context.stepResults.set('step2', { level: 'inner' });
    executeStep.mockImplementation((nestedStep: ConditionStep) => {
      if ('condition' in nestedStep && nestedStep.condition) {
        return executor.execute(nestedStep, context);
      }
      return Promise.resolve(mockResult(nestedStep.name));
    });

    const step: ConditionStep = {
      name: 'route',
      condition: {
        switch: '${step1.status}',
        cases: {
          outer: {
            name: 'nested',
            condition: {
              switch: '${step2.level}',
              cases: { inner: requestStep('deepLeaf') },
            },
          },
        },
      },
    };

    const result = (await executor.execute(step, context)) as StepExecutionResult & {
      metadata: { branchTaken: string };
    };

    expect(result.metadata.branchTaken).toBe('outer');
    const nestedResult = result.result as StepExecutionResult & {
      metadata: { branchTaken: string };
    };
    expect(nestedResult.metadata.branchTaken).toBe('inner');
    expect(nestedResult.result).toEqual(mockResult('deepLeaf'));
  });

  it('rejects when both if and switch are present', async () => {
    const step = {
      name: 'bad',
      condition: {
        if: 'true',
        then: requestStep('a'),
        switch: '${x}',
        cases: {},
      },
    } as unknown as ConditionStep;

    await expect(executor.execute(step, context)).rejects.toThrow(
      'cannot define both "if" and "switch"',
    );
  });

  it('does not match Object.prototype keys as cases', async () => {
    context.stepResults.set('step1', { status: 'toString' });

    const step: ConditionStep = {
      name: 'route',
      condition: {
        switch: '${step1.status}',
        cases: { foo: requestStep('handleFoo') },
        default: requestStep('handleDefault'),
      },
    };

    const result = (await executor.execute(step, context)) as StepExecutionResult & {
      metadata: { branchTaken: string };
    };

    expect(executeStep.mock.calls[0][0].name).toBe('handleDefault');
    expect(result.metadata.branchTaken).toBe('default');
  });

  it('tolerates a missing cases object at runtime by falling through to default', async () => {
    context.stepResults.set('step1', { status: 'foo' });

    const step = {
      name: 'route',
      condition: { switch: '${step1.status}', default: requestStep('handleDefault') },
    } as unknown as ConditionStep;

    const result = (await executor.execute(step, context)) as StepExecutionResult & {
      metadata: { branchTaken: string };
    };

    expect(executeStep.mock.calls[0][0].name).toBe('handleDefault');
    expect(result.metadata.branchTaken).toBe('default');
  });

  it('includes a timestamp in metadata', async () => {
    context.stepResults.set('step1', { status: 'foo' });

    const step: ConditionStep = {
      name: 'route',
      condition: { switch: '${step1.status}', cases: { foo: requestStep('handleFoo') } },
    };

    const result = (await executor.execute(step, context)) as StepExecutionResult & {
      metadata: { timestamp: string };
    };

    expect(result.metadata.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});
