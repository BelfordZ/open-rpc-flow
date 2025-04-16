import { Flow, Step, StepType } from '../types';
import { Logger, defaultLogger } from '../util/logger';
import { DEFAULT_TIMEOUTS } from '../constants/timeouts';

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

  constructor(flow: Flow, logger: Logger = defaultLogger) {
    this.flow = flow;
    this.logger = logger.createNested('PolicyResolver');
  }

  /**
   * Resolve a policy value for a given step, stepType, and policy name.
   * @param step The step to resolve for
   * @param stepType The type of the step (request, transform, etc)
   * @param policyName The policy name (e.g., 'timeout', 'retryPolicy')
   * @param defaultValue (optional) Fallback value if nothing is found
   */
  resolvePolicy<T = any>(
    step: Step,
    stepType: StepType,
    policyName: string,
    defaultValue?: T,
  ): T | undefined {
    // 1. Step-level policy
    if (step.policies && (step.policies as any)[policyName] !== undefined) {
      this.logger.debug('Using step-level policy', { step: step.name, policyName });
      return (step.policies as any)[policyName] as T;
    }
    // 2. Per-stepType policy (flow.policies.step[stepType][policyName])
    if (
      this.flow.policies?.step &&
      (this.flow.policies.step as any)[stepType]?.[policyName] !== undefined
    ) {
      this.logger.debug('Using flow.policies.step[stepType][policyName]', { stepType, policyName });
      return (this.flow.policies.step as any)[stepType][policyName] as T;
    }
    // 3. Step-type default policy (flow.policies.step[policyName])
    if (this.flow.policies?.step && (this.flow.policies.step as any)[policyName] !== undefined) {
      this.logger.debug('Using flow.policies.step[policyName]', { policyName });
      return (this.flow.policies.step as any)[policyName] as T;
    }
    // 4. Global policy (flow.policies.global[policyName])
    if (this.flow.policies?.global && (this.flow.policies.global as any)[policyName] !== undefined) {
      this.logger.debug('Using flow.policies.global[policyName]', { policyName });
      return (this.flow.policies.global as any)[policyName] as T;
    }
    // 5. Fallback/default
    this.logger.debug('Using fallback/default for policy', { policyName });
    return defaultValue;
  }

  /**
   * Helper to resolve timeout policy (returns the timeout number or a sensible default)
   */
  resolveTimeout(step: Step, stepType: StepType): number {
    const timeoutObj = this.resolvePolicy<{ timeout?: number }>(
      step,
      stepType,
      'timeout',
    );
    // Use the resolved timeout, or the default for the stepType, or the global default
    return (
      timeoutObj?.timeout ??
      (DEFAULT_TIMEOUTS as any)[stepType] ??
      DEFAULT_TIMEOUTS.global
    );
  }

  /**
   * Helper to resolve retryPolicy (returns the retryPolicy object or undefined)
   */
  resolveRetryPolicy(step: Step, stepType: StepType, fallback?: any): any {
    return this.resolvePolicy<any>(step, stepType, 'retryPolicy', fallback);
  }

  /**
   * Helper to resolve expression evaluation timeout (returns the timeout number or a sensible default)
   */
  resolveExpressionTimeout(step: Step, stepType: StepType): number {
    const timeoutObj = this.resolvePolicy<{ expressionEval?: number }>(
      step,
      stepType,
      'timeout',
    );
    return (
      (typeof timeoutObj?.expressionEval === 'number' ? timeoutObj.expressionEval : undefined) ??
      DEFAULT_TIMEOUTS.expression!
    );
  }

  // Future: add helpers for other policy types (circuitBreaker, rateLimit, etc)
} 