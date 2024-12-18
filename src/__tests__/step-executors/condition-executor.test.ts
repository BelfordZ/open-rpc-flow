import { ConditionStepExecutor } from '../../step-executors';
import { StepExecutionContext, ConditionStep } from '../../step-executors/types';
import { createMockContext } from '../test-utils';

describe('ConditionStepExecutor', () => {
  let executor: ConditionStepExecutor;
  let context: StepExecutionContext;
  let executeStep: jest.Mock;

  beforeEach(() => {
    executeStep = jest.fn();
    executor = new ConditionStepExecutor(executeStep);
    context = createMockContext();
  });

  it('executes then branch when condition is true', async () => {
    context.stepResults.set('user', { role: 'admin' });

    const step: ConditionStep = {
      name: 'checkAdmin',
      condition: {
        if: "${user.role} === 'admin'",
        then: {
          name: 'sendNotification',
          request: {
            method: 'notification.send',
            params: {
              message: 'Admin action performed'
            }
          }
        }
      }
    };

    executeStep.mockResolvedValue({ result: { success: true }, type: 'request' });
    const result = await executor.execute(step, context);

    expect(result.type).toBe('condition');
    expect(result.result.branchTaken).toBe('then');
    expect(result.result.conditionValue).toBe(true);
    expect(executeStep).toHaveBeenCalledTimes(1);
  });

  it('executes else branch when condition is false', async () => {
    context.stepResults.set('user', { role: 'user' });

    const step: ConditionStep = {
      name: 'checkAdmin',
      condition: {
        if: "${user.role} === 'admin'",
        then: {
          name: 'sendAdminNotification',
          request: {
            method: 'notification.send',
            params: {
              message: 'Admin action performed'
            }
          }
        },
        else: {
          name: 'sendUserNotification',
          request: {
            method: 'notification.send',
            params: {
              message: 'User action performed'
            }
          }
        }
      }
    };

    executeStep.mockResolvedValue({ result: { success: true }, type: 'request' });
    const result = await executor.execute(step, context);

    expect(result.type).toBe('condition');
    expect(result.result.branchTaken).toBe('else');
    expect(result.result.conditionValue).toBe(false);
    expect(executeStep).toHaveBeenCalledTimes(1);
  });

  it('handles missing else branch when condition is false', async () => {
    context.stepResults.set('user', { role: 'user' });

    const step: ConditionStep = {
      name: 'checkAdmin',
      condition: {
        if: "${user.role} === 'admin'",
        then: {
          name: 'sendNotification',
          request: {
            method: 'notification.send',
            params: {
              message: 'Admin action performed'
            }
          }
        }
      }
    };

    const result = await executor.execute(step, context);

    expect(result.type).toBe('condition');
    expect(result.result.branchTaken).toBe('else');
    expect(result.result.conditionValue).toBe(false);
    expect(result.result.value).toBeUndefined();
    expect(executeStep).not.toHaveBeenCalled();
  });

  it('handles nested conditions', async () => {
    context.stepResults.set('user', { role: 'admin', active: true });

    const step: ConditionStep = {
      name: 'checkAdmin',
      condition: {
        if: "${user.role} === 'admin'",
        then: {
          name: 'checkActive',
          condition: {
            if: '${user.active}',
            then: {
              name: 'sendNotification',
              request: {
                method: 'notification.send',
                params: {
                  message: 'Active admin action'
                }
              }
            }
          }
        }
      }
    };

    executeStep.mockResolvedValue({ 
      result: { success: true }, 
      type: 'request',
      metadata: { method: 'notification.send' }
    });

    const result = await executor.execute(step, context);

    expect(result.type).toBe('condition');
    expect(result.result.branchTaken).toBe('then');
    expect(result.result.conditionValue).toBe(true);
    expect(executeStep).toHaveBeenCalledTimes(1);
  });

  it('evaluates complex conditions', async () => {
    context.stepResults.set('user', { role: 'admin', active: true, loginCount: 5 });
    context.context.minLoginCount = 3;

    const step: ConditionStep = {
      name: 'complexCheck',
      condition: {
        if: "${user.role} === 'admin' && ${user.active} && ${user.loginCount} > ${context.minLoginCount}",
        then: {
          name: 'sendNotification',
          request: {
            method: 'notification.send',
            params: {
              message: 'Complex condition met'
            }
          }
        }
      }
    };

    executeStep.mockResolvedValue({ result: { success: true }, type: 'request' });
    const result = await executor.execute(step, context);

    expect(result.type).toBe('condition');
    expect(result.result.branchTaken).toBe('then');
    expect(result.result.conditionValue).toBe(true);
    expect(executeStep).toHaveBeenCalledTimes(1);
  });
}); 