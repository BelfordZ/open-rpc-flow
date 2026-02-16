import * as stepExecutors from '../step-executors';
import * as pathAccessor from '../path-accessor';
import * as dependencyResolver from '../dependency-resolver';
import { NoLogger, noLogger } from '../util/logger';

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
});
