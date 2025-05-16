import { PolicyResolver } from '../policy-resolver';
import { Step, Flow } from '../../types';
import { Logger } from '../logger';
import { DEFAULT_TIMEOUTS } from '../../constants/timeouts';
import { ErrorCode } from '../../errors/codes';

describe('PolicyResolver', () => {
  const baseStep: Step = { name: 'myStep' };
  const baseFlow: Flow = { name: 'myFlow', description: '', steps: [] };
  let logger: Logger;

  beforeEach(() => {
    logger = {
      debug: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
      createNested: () => logger,
    } as any;
  });

  it('resolves step-level policy', () => {
    const step: Step = { ...baseStep, policies: { timeout: { timeout: 111 } } };
    const resolver = new PolicyResolver(baseFlow, logger);
    expect(resolver.resolveTimeout(step, 'transform')).toBe(111);
  });

  it('resolves per-stepType policy', () => {
    const flow: Flow = {
      ...baseFlow,
      policies: { step: { transform: { timeout: { timeout: 333 } } } as any },
    };
    const resolver = new PolicyResolver(flow, logger);
    expect(resolver.resolveTimeout(baseStep, 'transform')).toBe(333);
  });

  it('resolves step-type default policy', () => {
    const flow: Flow = {
      ...baseFlow,
      policies: { step: { timeout: { timeout: 444 } } },
    };
    const resolver = new PolicyResolver(flow, logger);
    expect(resolver.resolveTimeout(baseStep, 'transform')).toBe(444);
  });

  it('resolves global policy', () => {
    const flow: Flow = {
      ...baseFlow,
      policies: { global: { timeout: { timeout: 555 } } },
    };
    const resolver = new PolicyResolver(flow, logger);
    expect(resolver.resolveTimeout(baseStep, 'transform')).toBe(555);
  });

  it('returns fallback/default if nothing found', () => {
    const resolver = new PolicyResolver(baseFlow, logger);
    expect(resolver.resolveTimeout(baseStep, 'transform')).toBe(
      (DEFAULT_TIMEOUTS as any)['transform'] ?? DEFAULT_TIMEOUTS.global,
    );
  });

  it('resolvePolicy respects precedence order', () => {
    const step: Step = { ...baseStep, policies: { timeout: { timeout: 1 } } };
    const flow: Flow = {
      ...baseFlow,
      policies: {
        global: { timeout: { timeout: 5 } },
        step: {
          transform: { timeout: { timeout: 3 } },
          timeout: { timeout: 4 },
        } as any,
      },
    };
    const resolver = new PolicyResolver(flow, logger);
    // Step-level wins
    expect(resolver.resolveTimeout(step, 'transform')).toBe(1);
    // Remove step-level, per-stepType wins
    expect(resolver.resolveTimeout(baseStep, 'transform')).toBe(3);
    // Remove per-stepType, step-type default wins
    const flow2: Flow = {
      ...baseFlow,
      policies: { step: { timeout: { timeout: 4 } } },
    };
    const resolver2 = new PolicyResolver(flow2, logger);
    expect(resolver2.resolveTimeout(baseStep, 'transform')).toBe(4);
    // Remove step-type default, global wins
    const flow3: Flow = {
      ...baseFlow,
      policies: { global: { timeout: { timeout: 5 } } },
    };
    const resolver3 = new PolicyResolver(flow3, logger);
    expect(resolver3.resolveTimeout(baseStep, 'transform')).toBe(5);
    // Remove all, fallback
    const resolver4 = new PolicyResolver(baseFlow, logger);
    expect(resolver4.resolveTimeout(baseStep, 'transform')).toBe(
      (DEFAULT_TIMEOUTS as any)['transform'] ?? DEFAULT_TIMEOUTS.global,
    );
  });

  it('resolveRetryPolicy works for all levels', () => {
    const retryObj = { maxAttempts: 7 };
    const expectedMerged = {
      maxAttempts: 7,
      backoff: {
        initial: 100,
        multiplier: 2,
        maxDelay: 5000,
        strategy: 'exponential',
      },
      retryableErrors: [
        ErrorCode.NETWORK_ERROR,
        ErrorCode.TIMEOUT_ERROR,
        ErrorCode.OPERATION_TIMEOUT,
      ],
    };
    // Step-level
    const step: Step = { ...baseStep, policies: { retryPolicy: retryObj } };
    let resolver = new PolicyResolver(baseFlow, logger);
    expect(resolver.resolveRetryPolicy(step, 'transform')).toEqual(expectedMerged);
    // Per-stepType
    let flow: Flow = {
      ...baseFlow,
      policies: { step: { transform: { retryPolicy: retryObj } } as any },
    };
    resolver = new PolicyResolver(flow, logger);
    expect(resolver.resolveRetryPolicy(baseStep, 'transform')).toEqual(expectedMerged);
    // Step-type default
    flow = {
      ...baseFlow,
      policies: { step: { retryPolicy: retryObj } },
    };
    resolver = new PolicyResolver(flow, logger);
    expect(resolver.resolveRetryPolicy(baseStep, 'transform')).toEqual(expectedMerged);
    // Global
    flow = {
      ...baseFlow,
      policies: { global: { retryPolicy: retryObj } },
    };
    resolver = new PolicyResolver(flow, logger);
    expect(resolver.resolveRetryPolicy(baseStep, 'transform')).toEqual(expectedMerged);
    // Fallback
    resolver = new PolicyResolver(baseFlow, logger);
    expect(resolver.resolveRetryPolicy(baseStep, 'transform', retryObj)).toEqual(expectedMerged);
  });

  it('returns undefined if nothing found and no fallback', () => {
    const resolver = new PolicyResolver(baseFlow, logger);
    expect(resolver.resolveTimeout(baseStep, 'transform')).toBe(
      (DEFAULT_TIMEOUTS as any)['transform'] ?? DEFAULT_TIMEOUTS.global,
    );
    expect(resolver.resolveRetryPolicy(baseStep, 'transform')).toBeUndefined();
  });

  it('uses override policies when provided', () => {
    const overrides = { timeout: { timeout: 999 } };
    const resolver = new PolicyResolver(baseFlow, logger, overrides);
    expect(resolver.resolveTimeout(baseStep, 'transform')).toBe(999);
  });

  it('resolves expression evaluation timeout', () => {
    const step: Step = { ...baseStep, policies: { timeout: { expressionEval: 321 } } };
    const resolver = new PolicyResolver(baseFlow, logger);
    expect(resolver.resolveExpressionTimeout(step, 'transform')).toBe(321);
  });
});
