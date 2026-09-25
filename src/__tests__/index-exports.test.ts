import * as stepExecutors from '../step-executors';
import * as pathAccessor from '../path-accessor';
import * as dependencyResolver from '../dependency-resolver';
import * as packageIndex from '../index';
import { NoLogger, noLogger } from '../util/logger';
import type { OnErrorConfig, StepErrorInfo, StepRecoveredEvent } from '../index';

describe('index module re-exports', () => {
  it('exposes step executor exports', () => {
    expect(stepExecutors.StepType).toBeDefined();
    expect(stepExecutors.RequestStepExecutor).toBeDefined();
    expect(stepExecutors.DelayStepExecutor).toBeDefined();
  });

  it('exposes path accessor exports', () => {
    expect(pathAccessor.PathAccessor).toBeDefined();
    expect(pathAccessor.PathSyntaxError).toBeDefined();
    expect(pathAccessor.PropertyAccessError).toBeDefined();
  });

  it('exposes dependency resolver exports', () => {
    expect(dependencyResolver.DependencyResolver).toBeDefined();
    expect(dependencyResolver.StepNotFoundError).toBeDefined();
    expect(dependencyResolver.UnknownDependencyError).toBeDefined();
  });

  it('exposes logger re-exports', () => {
    expect(NoLogger.getInstance()).toBe(noLogger);
  });

  it('exposes NoLogger and noLogger on the package index', () => {
    // Regression test for #187: noLogger was undefined when imported
    // from the package index, silently falling back to the noisy
    // default logger.
    expect(packageIndex.NoLogger).toBe(NoLogger);
    expect(packageIndex.noLogger).toBe(noLogger);
  });

  it('exposes onError recovery types and the step:recovered event (issue #193)', () => {
    // Types are compile-time only; assert the value exports exist and the
    // event enum carries the new member.
    expect(packageIndex.FlowEventType.STEP_RECOVERED).toBe('step:recovered');
    // Compile-time check that the types are re-exported from the index.
    const config: OnErrorConfig = { fallback: 0 };
    const info: StepErrorInfo = { name: 'Error', message: 'x' };
    const event: StepRecoveredEvent | undefined = undefined;
    expect([config, info, event]).toBeDefined();
  });

  it('noLogger from the package index is a functional silent Logger', () => {
    const logger = packageIndex.noLogger;
    const consoleMethods = [
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
      jest.spyOn(console, 'debug').mockImplementation(() => undefined),
    ];
    try {
      expect(() => {
        logger.info('info', { a: 1 });
        logger.warn('warn');
        logger.error('error', new Error('boom'));
        logger.debug('debug');
        logger.createNested('child').info('nested');
      }).not.toThrow();
    } finally {
      consoleMethods.forEach((spy) => spy.mockRestore());
    }
    consoleMethods.forEach((spy) => expect(spy).not.toHaveBeenCalled());
  });
});
