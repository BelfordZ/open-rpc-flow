import { getStepType } from '../types';
import { isDelayStep } from '../step-executors/types';

describe('getStepType', () => {
  it('returns the expected type for each step shape', () => {
    expect(getStepType({ name: 'req', request: { method: 'm', params: {} } } as any)).toBe(
      'request',
    );
    expect(getStepType({ name: 'loop', loop: { items: [], steps: [] } } as any)).toBe('loop');
    expect(getStepType({ name: 'cond', condition: { if: 'true', then: {} } } as any)).toBe(
      'condition',
    );
    expect(
      getStepType({
        name: 'transform',
        transform: { input: '${context.items}', operations: [] },
      } as any),
    ).toBe('transform');
    expect(
      getStepType({
        name: 'delay',
        delay: { duration: 1, step: { name: 'inner', request: { method: 'm', params: {} } } },
      } as any),
    ).toBe('delay');
    expect(getStepType({ name: 'stop', stop: { endWorkflow: true } } as any)).toBe('stop');
    expect(getStepType({ name: 'unknown' } as any)).toBe('unknown');
  });
});

describe('isDelayStep', () => {
  it('returns true for delay steps', () => {
    const step = {
      name: 'delay',
      delay: { duration: 1, step: { name: 'inner', request: { method: 'm', params: {} } } },
    } as any;
    expect(isDelayStep(step)).toBe(true);
  });

  it('returns false for non-delay steps', () => {
    const step = { name: 'req', request: { method: 'm', params: {} } } as any;
    expect(isDelayStep(step)).toBe(false);
  });
});
