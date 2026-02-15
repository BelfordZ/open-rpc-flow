import type { Flow, Step, PolicyOverrides } from '../types';
import type { StepType } from '../step-executors/types';
import { Logger, defaultLogger } from '../util/logger';
import { DEFAULT_TIMEOUTS } from '../constants/timeouts';
import { DEFAULT_RETRY_POLICY } from '../flow-executor';
import { RetryPolicy } from '../errors/recovery';

/**
 * Resolves policies (timeout, retryPolicy, etc.) for steps and flows according to metaschema precedence.
 *
 * Precedence order:
 * 1. step.policies?.[policyName]
 * 2. step.[deprecated field] (if applicable)
 * 3. flow.policies?.step?.[stepType]?.[policyName]
 * 4. flow.policies?.step?.[policyName] (default for all steps)
 * 5. flow.policies?.global?.[policyName]
 * 6. fallback/default
 */
export class PolicyResolver {
  private flow: Flow;
  private logger: Logger;
  private overrides: PolicyOverrides;

  constructor(flow: Flow, logger: Logger = defaultLogger, overrides: PolicyOverrides = {}) {
    this.flow = flow;
    this.logger = logger.createNested('PolicyResolver');
    this.overrides = overrides;
  }

  /**
   * Resolve a policy value for a given step, stepType, and policy name.
   * @param step The step to resolve for
   * @param stepType The type of the step (request, transform, etc)
   * @param policyName The policy name (e.g., 'timeout', 'retryPolicy')
   * @param defaultValue (optional) Fallback value if nothing is found
   */
  resolvePolicy<T = unknown>(
    step: Step,
    stepType: StepType,
    policyName: string,
    defaultValue?: T,
  ): T | undefined {
    // 0. Highest precedence: overrides
    if (this.overrides && this.overrides[policyName] !== undefined) {
      this.logger.debug('Using override policy', { policyName });
      return this.overrides[policyName] as T;
    }
    // 1. Step-level policy
    if (step.policies && (step.policies as Record<string, unknown>)[policyName] !== undefined) {
      this.logger.debug('Using step-level policy', { step: step.name, policyName });
      return (step.policies as Record<string, unknown>)[policyName] as T;
    }
    // 2. Per-stepType policy (flow.policies.step[stepType][policyName])
    if (
      this.flow.policies?.step &&
      (this.flow.policies.step as Record<string, Record<string, unknown>>)[stepType]?.[
        policyName
      ] !== undefined
    ) {
      this.logger.debug('Using flow.policies.step[stepType][policyName]', { stepType, policyName });
      return (this.flow.policies.step as Record<string, Record<string, unknown>>)[stepType][
        policyName
      ] as T;
    }
    // 3. Step-type default policy (flow.policies.step[policyName])
    if (
      this.flow.policies?.step &&
      (this.flow.policies.step as Record<string, unknown>)[policyName] !== undefined
    ) {
      this.logger.debug('Using flow.policies.step[policyName]', { policyName });
      return (this.flow.policies.step as Record<string, unknown>)[policyName] as T;
    }
    // 4. Global policy (flow.policies.global[policyName])
    if (
      this.flow.policies?.global &&
      (this.flow.policies.global as Record<string, unknown>)[policyName] !== undefined
    ) {
      this.logger.debug('Using flow.policies.global[policyName]', { policyName });
      return (this.flow.policies.global as Record<string, unknown>)[policyName] as T;
    }
    // 5. Fallback/default
    this.logger.debug('Using fallback/default for policy', { policyName });
    return defaultValue;
  }

  /**
   * Helper to resolve timeout policy (returns the timeout number or a sensible default)
   */
  resolveTimeout(step: Step, stepType: StepType): number {
    // Resolve step timeouts without using flow-level global timeout.
    if (this.overrides && this.overrides.timeout !== undefined) {
      return (this.overrides.timeout as { timeout?: number })?.timeout ?? DEFAULT_TIMEOUTS.global;
    }
    if (step.policies?.timeout?.timeout !== undefined) {
      return step.policies.timeout.timeout;
    }
    if (this.flow.policies?.step?.[stepType]?.timeout?.timeout !== undefined) {
      return this.flow.policies.step[stepType]!.timeout!.timeout!;
    }
    if (this.flow.policies?.step?.timeout?.timeout !== undefined) {
      return this.flow.policies.step.timeout.timeout;
    }
    return (DEFAULT_TIMEOUTS as Record<string, number>)[stepType] ?? DEFAULT_TIMEOUTS.global;
  }

  /**
   * Helper to resolve retryPolicy (returns the retryPolicy object or undefined)
   */
  resolveRetryPolicy(step: Step, stepType: StepType, fallback?: unknown): RetryPolicy | undefined {
    const userPolicy = this.resolvePolicy<RetryPolicy>(
      step,
      stepType,
      'retryPolicy',
      fallback as RetryPolicy | undefined,
    );
    if (!userPolicy) return undefined;
    // Merge with defaults, including nested backoff
    return {
      ...DEFAULT_RETRY_POLICY,
      ...userPolicy,
      backoff: {
        ...DEFAULT_RETRY_POLICY.backoff,
        ...(userPolicy.backoff || {}),
      },
      retryableErrors: userPolicy.retryableErrors ?? DEFAULT_RETRY_POLICY.retryableErrors,
    };
  }

  /**
   * Helper to resolve expression evaluation timeout (returns the timeout number or a sensible default)
   */
  resolveExpressionTimeout(step: Step, stepType: StepType): number {
    if (this.overrides && this.overrides.timeout !== undefined) {
      return (
        (this.overrides.timeout as { expressionEval?: number })?.expressionEval ??
        DEFAULT_TIMEOUTS.expression!
      );
    }
    if (step.policies?.timeout?.expressionEval !== undefined) {
      return step.policies.timeout.expressionEval;
    }
    if (this.flow.policies?.step?.[stepType]?.timeout?.expressionEval !== undefined) {
      return this.flow.policies.step[stepType]!.timeout!.expressionEval!;
    }
    if (this.flow.policies?.step?.timeout?.expressionEval !== undefined) {
      return this.flow.policies.step.timeout.expressionEval;
    }
    return DEFAULT_TIMEOUTS.expression!;
  }

  // Future: add helpers for other policy types (circuitBreaker, rateLimit, etc)
}
