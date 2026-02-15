import { getStepType } from '../types';

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
    expect(getStepType({ name: 'stop', stop: { endWorkflow: true } } as any)).toBe('stop');
    expect(getStepType({ name: 'unknown' } as any)).toBe('unknown');
  });
});
