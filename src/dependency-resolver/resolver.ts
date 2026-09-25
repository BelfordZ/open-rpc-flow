import { Flow, Step, DependencyGraph, DependencyNode } from '../types';
import { StepType, isSwitchCondition } from '../step-executors/types';
import { Logger } from '../util/logger';
import {
  isLoopStep,
  isRequestStep,
  isConditionStep,
  isTransformStep,
  isDelayStep,
} from '../step-executors/types';
import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';
import { StepNotFoundError, UnknownDependencyError, CircularDependencyError } from './errors';

export class DependencyResolver {
  private logger: Logger;
  private internalVars = new Set(['context', 'metadata', 'input']);
  private loopVars = new Set<string>();
  /**
   * Cached dependency graph. Built lazily on first use and reused by every
   * graph consumer. Null means "not built yet" (or invalidated). The resolver
   * assumes the flow is immutable; if the flow's steps are mutated after
   * construction, call {@link invalidateCache} to force a rebuild.
   */
  private dependencyGraph: Map<string, Set<string>> | null = null;

  constructor(
    private flow: Flow,
    private expressionEvaluator: SafeExpressionEvaluator,
    logger: Logger,
  ) {
    this.logger = logger.createNested('DependencyResolver');
    this.dependencyGraph = null;
  }

  /**
   * Discards the cached dependency graph so it is rebuilt on next use.
   * Only needed when the flow's steps were mutated after this resolver was
   * constructed; the resolver otherwise assumes an immutable flow.
   */
  public invalidateCache(): void {
    this.dependencyGraph = null;
  }

  /**
   * Returns the dependency graph, building it once and caching the result.
   * A failed build is not cached: the error propagates and the next call
   * retries the build.
   */
  private getOrBuildGraph(parentLogger: Logger): Map<string, Set<string>> {
    if (this.dependencyGraph === null) {
      this.dependencyGraph = this.buildDependencyGraph(parentLogger);
    }
    return this.dependencyGraph;
  }

  /**
   * Get the execution order for all steps in the flow
   */
  getExecutionOrder(): Step[] {
    const logger = this.logger.createNested('getExecutionOrder');
    logger.debug('Getting execution order');
    const graph = this.getOrBuildGraph(logger);
    return this.topologicalSort(graph);
  }

  /**
   * Get all dependencies for a given step
   */
  getDependencies(stepName: string): string[] {
    const logger = this.logger.createNested(`getDependencies: ${stepName}`);
    logger.debug(`Getting dependencies for step: ${stepName}`);
    const graph = this.getOrBuildGraph(logger);
    const deps = graph.get(stepName);
    if (!deps) {
      const availableSteps = Array.from(graph.keys());
      throw new StepNotFoundError(
        `Step '${stepName}' not found in dependency graph`,
        stepName,
        availableSteps,
      );
    }
    return Array.from(deps);
  }

  /**
   * Get all steps that depend on a given step
   */
  getDependents(stepName: string): string[] {
    const logger = this.logger.createNested(`getDependents: ${stepName}`);
    logger.debug(`Getting dependents for step: ${stepName}`);
    const graph = this.getOrBuildGraph(logger);
    const dependents: string[] = [];

    for (const [step, deps] of graph.entries()) {
      if (deps.has(stepName)) {
        dependents.push(step);
      }
    }

    return dependents;
  }

  /**
   * Build a dependency graph for all steps in the flow
   */
  private buildDependencyGraph(parentLogger: Logger): Map<string, Set<string>> {
    const logger = parentLogger.createNested('buildDependencyGraph');
    logger.debug('Building dependency graph');
    const graph = new Map<string, Set<string>>();

    // Initialize graph with all steps
    for (const step of this.flow.steps) {
      graph.set(step.name, new Set());
    }

    logger.debug(`Initialized graph with ${graph.size} steps`);

    // Map nested onError recovery step names (issue #193) to their parent
    // step: a downstream step referencing `${recoveryStep.result}` must run
    // after the parent, since the recovery step only executes as part of
    // the parent's recovery. A name that is also a top-level step keeps its
    // existing meaning (checked via graph.has below).
    const recoveryStepParents = new Map<string, string>();
    for (const step of this.flow.steps) {
      const onError = step.onError;
      const recoveryStep =
        onError && typeof onError === 'object' ? (onError as { step?: unknown }).step : undefined;
      if (
        recoveryStep &&
        typeof recoveryStep === 'object' &&
        typeof (recoveryStep as { name?: unknown }).name === 'string'
      ) {
        recoveryStepParents.set((recoveryStep as { name: string }).name, step.name);
      }
    }

    // Add dependencies for each step
    for (const step of this.flow.steps) {
      const deps = this.findStepDependencies(step, logger);
      for (const dep of deps) {
        const resolvedDep = graph.has(dep) ? dep : recoveryStepParents.get(dep);
        if (resolvedDep === undefined || !graph.has(resolvedDep)) {
          const availableSteps = Array.from(graph.keys());
          throw new UnknownDependencyError(
            `Step '${step.name}' depends on unknown step '${dep}'`,
            step.name,
            dep,
            availableSteps,
          );
        }
        graph.get(step.name)?.add(resolvedDep);
      }
      this.logger.debug(`Added dependency: ${step.name} -> ${deps.join(', ')}`);
    }

    return graph;
  }

  /**
   * Find all dependencies for a step
   */
  private findStepDependencies(step: Step, parentLogger: Logger): string[] {
    const logger = parentLogger.createNested(`findStepDependencies: ${step.name}`);
    const deps = new Set<string>();

    // Extract references from loop steps
    if (isLoopStep(step)) {
      logger.debug('handling loop step');
      // Add dependencies from the loop's "over" expression
      this.extractReferences(step.loop.over).forEach((dep) => deps.add(dep));

      // Names of steps nested anywhere inside this loop's subtree. References
      // to them resolve against the loop-local results at runtime, so they
      // must not become top-level dependencies of the enclosing step.
      const nestedStepNames = this.collectNestedStepNames(step);

      const collectLoopStepDependencies = () => {
        if (step.loop.step) {
          this.findStepDependencies(step.loop.step, logger)
            .filter((dep) => !nestedStepNames.has(dep))
            .forEach((dep) => deps.add(dep));
        }
      };

      // Add dependencies from the loop's condition if present
      if (step.loop.condition) {
        this.withLoopVars(step.loop.as, () => {
          this.extractReferences(step.loop.condition!).forEach((dep) => deps.add(dep));
          collectLoopStepDependencies();
        });
      } else {
        // If no condition, just process the loop's step
        this.withLoopVars(step.loop.as, collectLoopStepDependencies);
      }

      // Process the loop's steps if present
      if (step.loop.steps) {
        logger.debug('handling loop steps');
        this.withLoopVars(step.loop.as, () => {
          for (const subStep of step.loop.steps!) {
            this.findStepDependencies(subStep, logger)
              .filter((dep) => !nestedStepNames.has(dep))
              .forEach((dep) => deps.add(dep));
          }
        });
      }
    }

    // Extract references from condition steps
    if (isConditionStep(step)) {
      logger.debug('handling condition step');
      // Names of steps nested anywhere inside this condition's branches. Like
      // loop sub-steps, they resolve against branch-local results at runtime.
      const nestedStepNames = this.collectNestedStepNames(step);
      const addBranchDependencies = (branchStep: Step): void => {
        this.findStepDependencies(branchStep, logger)
          .filter((dep) => !nestedStepNames.has(dep))
          .forEach((dep) => deps.add(dep));
      };
      const condition = step.condition;
      if (isSwitchCondition(condition)) {
        this.extractReferences(condition.switch).forEach((dep) => deps.add(dep));
        const caseSteps: Step[] = [];
        for (const caseValue of Object.values(condition.cases ?? {})) {
          caseSteps.push(...(Array.isArray(caseValue) ? caseValue : [caseValue]));
        }
        if (condition.default !== undefined) {
          caseSteps.push(
            ...(Array.isArray(condition.default) ? condition.default : [condition.default]),
          );
        }
        for (const caseStep of caseSteps) {
          addBranchDependencies(caseStep);
        }
      } else {
        this.extractReferences(condition.if).forEach((dep) => deps.add(dep));
        if (condition.then) {
          addBranchDependencies(condition.then);
        }
        if (condition.else) {
          addBranchDependencies(condition.else);
        }
      }
    }

    // Extract references from delay steps
    if (isDelayStep(step)) {
      logger.debug('handling delay step');
      const nestedStepNames = this.collectNestedStepNames(step);
      this.findStepDependencies(step.delay.step, logger)
        .filter((dep) => !nestedStepNames.has(dep))
        .forEach((dep) => deps.add(dep));
    }

    // Extract references from request steps
    if (isRequestStep(step)) {
      logger.debug('handling request step');
      const params = step.request.params;
      for (const value of Object.values(params)) {
        if (typeof value === 'string') {
          this.extractReferences(value).forEach((dep) => deps.add(dep));
        }
      }
    }

    // Extract references from transform steps
    if (isTransformStep(step)) {
      logger.debug('handling transform step');
      if (typeof step.transform.input === 'string') {
        this.extractReferences(step.transform.input).forEach((dep) => deps.add(dep));
      }
      if (step.transform.operations) {
        const transformLoopVars = ['item'];
        if (step.transform.operations.some((op) => op.type === 'reduce')) {
          transformLoopVars.push('acc');
        }
        if (step.transform.operations.some((op) => op.type === 'sort')) {
          transformLoopVars.push('a', 'b');
        }

        this.withLoopVars(transformLoopVars, () => {
          for (const op of step.transform.operations!) {
            if (op.using && typeof op.using === 'string') {
              this.extractReferences(op.using).forEach((dep) => deps.add(dep));
            }
          }
        });
      }
    }

    // Extract references from onError recovery config (issue #193). The
    // fallback and the nested recovery step resolve at recovery time, after
    // the parent step ran, so any steps they reference must already be
    // complete: those references are dependencies of the parent step.
    if (step.onError && typeof step.onError === 'object') {
      const fallback = step.onError.fallback;
      if (fallback !== undefined) {
        // Stringify to catch `${...}` nested inside object/array fallbacks.
        // `${error}` is recovery-scoped (the caught failure summary), not a
        // step reference — same treatment as the nested step below.
        this.withLoopVars('error', () => {
          this.extractReferences(JSON.stringify(fallback)).forEach((dep) => deps.add(dep));
        });
      }
      const recoveryStep = step.onError.step;
      if (recoveryStep && typeof recoveryStep === 'object') {
        // The recovery-scoped `error` variable and the recovery step's own
        // name are not top-level dependencies.
        this.withLoopVars('error', () => {
          this.findStepDependencies(recoveryStep, logger)
            .filter((dep) => dep !== recoveryStep.name)
            .forEach((dep) => deps.add(dep));
        });
      }
    }

    logger.debug(`Found dependencies: ${Array.from(deps).join(', ')}`);
    return Array.from(deps);
  }

  /**
   * Collects the names of every step nested inside a step's subtree:
   * loop.steps / loop.step, switch cases / default, then / else branches,
   * and delay.step, recursively. References to these names resolve against
   * the branch-local results at runtime, so they must not be treated as
   * top-level dependencies of the enclosing step.
   */
  private collectNestedStepNames(step: Step): Set<string> {
    const names = new Set<string>();
    const visit = (current: Step): void => {
      if (isLoopStep(current)) {
        if (current.loop.steps) {
          for (const subStep of current.loop.steps) {
            names.add(subStep.name);
            visit(subStep);
          }
        } else if (current.loop.step) {
          names.add(current.loop.step.name);
          visit(current.loop.step);
        }
      } else if (isConditionStep(current)) {
        const condition = current.condition;
        const branches: Step[] = [];
        if (isSwitchCondition(condition)) {
          for (const caseValue of Object.values(condition.cases ?? {})) {
            branches.push(...(Array.isArray(caseValue) ? caseValue : [caseValue]));
          }
          if (condition.default !== undefined) {
            branches.push(
              ...(Array.isArray(condition.default) ? condition.default : [condition.default]),
            );
          }
        } else {
          if (condition.then) {
            branches.push(condition.then);
          }
          if (condition.else) {
            branches.push(condition.else);
          }
        }
        for (const branch of branches) {
          names.add(branch.name);
          visit(branch);
        }
      } else if (isDelayStep(current)) {
        names.add(current.delay.step.name);
        visit(current.delay.step);
      }
    };
    visit(step);
    return names;
  }

  /**
   * Extract step references from an expression
   */
  private extractReferences(expr: string): string[] {
    const refs = this.expressionEvaluator.extractReferences(expr);
    // Filter out internal variables and loop variables
    return refs.filter((ref) => !this.internalVars.has(ref) && !this.loopVars.has(ref));
  }

  private withLoopVars(loopVars: string | string[], callback: () => void): void {
    const vars = Array.isArray(loopVars) ? loopVars : [loopVars];
    vars.forEach((loopVar) => this.loopVars.add(loopVar));
    try {
      callback();
    } finally {
      vars.forEach((loopVar) => this.loopVars.delete(loopVar));
    }
  }

  /**
   * Perform a topological sort on the dependency graph
   */
  private topologicalSort(graph: Map<string, Set<string>>): Step[] {
    this.logger.debug('Performing topological sort');
    const visited = new Set<string>();
    const temp = new Set<string>();
    const order: string[] = [];

    const visit = (node: string, path: string[] = []) => {
      if (temp.has(node)) {
        const cycle = [...path.slice(path.indexOf(node)), node];
        throw new CircularDependencyError(
          `Circular dependency detected: ${cycle.join(' → ')}`,
          cycle,
        );
      }
      if (visited.has(node)) {
        return;
      }
      temp.add(node);
      path.push(node);
      const deps = graph.get(node) || new Set();
      for (const dep of deps) {
        visit(dep, [...path]);
      }
      temp.delete(node);
      visited.add(node);
      order.push(node);
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        visit(node);
      }
    }

    this.logger.debug(`Topological sort result: ${order.join(', ')}`);

    // Convert step names back to step objects
    return order.map((name) => this.flow.steps.find((s) => s.name === name)!);
  }

  /**
   * Get a UI-friendly representation of the dependency graph
   */
  getDependencyGraph(): DependencyGraph {
    const logger = this.logger.createNested('getDependencyGraph');
    const graph = this.getOrBuildGraph(logger);

    const nodes: DependencyNode[] = [];
    const edges: Array<{ from: string; to: string }> = [];

    // Create nodes
    for (const step of this.flow.steps) {
      const deps = graph.get(step.name) as Set<string>;
      const dependencies = Array.from(deps);
      // Same result as getDependents(step.name), read straight from the
      // cached graph instead of re-entering the public method per step.
      const dependents: string[] = [];
      for (const [name, stepDeps] of graph.entries()) {
        if (stepDeps.has(step.name)) {
          dependents.push(name);
        }
      }

      // Determine step type
      let type: DependencyNode['type'] = StepType.Request; // default
      if (isLoopStep(step)) type = StepType.Loop;
      if (isConditionStep(step)) type = StepType.Condition;
      if (isTransformStep(step)) type = StepType.Transform;
      if (isDelayStep(step)) type = StepType.Delay;

      nodes.push({
        name: step.name,
        type,
        dependencies,
        dependents,
      });

      // Create edges
      for (const dep of dependencies) {
        edges.push({
          from: dep,
          to: step.name,
        });
      }
    }

    return {
      nodes,
      edges,
    };
  }
}
