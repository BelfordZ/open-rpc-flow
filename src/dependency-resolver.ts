import { Flow, Step } from './types';
import { Logger } from './util/logger';
import {
  isLoopStep,
  isRequestStep,
  isConditionStep,
  isTransformStep,
} from './step-executors/types';

export class DependencyResolver {
  private logger: Logger;

  constructor(
    private flow: Flow,
    logger: Logger,
  ) {
    this.logger = logger.createNested('DependencyResolver');
  }

  /**
   * Get the execution order for all steps in the flow
   */
  getExecutionOrder(): Step[] {
    this.logger.debug('Getting execution order');
    const graph = this.buildDependencyGraph();
    return this.topologicalSort(graph);
  }

  /**
   * Get all dependencies for a given step
   */
  getDependencies(stepName: string): string[] {
    this.logger.debug(`Getting dependencies for step: ${stepName}`);
    const graph = this.buildDependencyGraph();
    const deps = graph.get(stepName);
    if (!deps) {
      throw new Error(`Step '${stepName}' not found in dependency graph`);
    }
    return Array.from(deps);
  }

  /**
   * Get all steps that depend on a given step
   */
  getDependents(stepName: string): string[] {
    this.logger.debug(`Getting dependents for step: ${stepName}`);
    const graph = this.buildDependencyGraph();
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
  private buildDependencyGraph(): Map<string, Set<string>> {
    this.logger.debug('Building dependency graph');
    const graph = new Map<string, Set<string>>();

    // Initialize graph with all steps
    for (const step of this.flow.steps) {
      graph.set(step.name, new Set());
    }

    // Add dependencies for each step
    for (const step of this.flow.steps) {
      const deps = this.findStepDependencies(step);
      for (const dep of deps) {
        if (!graph.has(dep)) {
          throw new Error(`Step '${step.name}' depends on unknown step '${dep}'`);
        }
        graph.get(step.name)?.add(dep);
      }
      this.logger.debug(`Added dependency: ${step.name} -> ${deps.join(', ')}`);
    }

    return graph;
  }

  /**
   * Find all dependencies for a step
   */
  private findStepDependencies(step: Step, localContextVars: string[] = []): string[] {
    this.logger.debug(`Finding dependencies for step: ${step.name}`);
    const deps = new Set<string>();

    // Extract references from loop steps
    if (isLoopStep(step)) {
      // Add dependencies from the loop's "over" expression
      this.extractReferences(step.loop.over, localContextVars).forEach((dep) => deps.add(dep));

      // Add the loop variable to localContextVars for nested steps
      const loopVars = [...localContextVars, step.loop.as];

      // Process the loop's step with updated context variables
      if (step.loop.step) {
        this.findStepDependencies(step.loop.step, loopVars).forEach((dep) => deps.add(dep));
      }
    }

    // Extract references from condition steps
    if (isConditionStep(step)) {
      this.extractReferences(step.condition.if, localContextVars).forEach((dep) => deps.add(dep));
      if (step.condition.then) {
        this.findStepDependencies(step.condition.then, localContextVars).forEach((dep) =>
          deps.add(dep),
        );
      }
      if (step.condition.else) {
        this.findStepDependencies(step.condition.else, localContextVars).forEach((dep) =>
          deps.add(dep),
        );
      }
    }

    // Extract references from request steps
    if (isRequestStep(step)) {
      const params = step.request.params;
      for (const value of Object.values(params)) {
        if (typeof value === 'string') {
          this.extractReferences(value, localContextVars).forEach((dep) => deps.add(dep));
        }
      }
    }

    // Extract references from transform steps
    if (isTransformStep(step)) {
      if (typeof step.transform.input === 'string') {
        this.extractReferences(step.transform.input, localContextVars).forEach((dep) =>
          deps.add(dep),
        );
      }
      if (step.transform.operations) {
        for (const op of step.transform.operations) {
          if (op.using && typeof op.using === 'string') {
            this.extractReferences(op.using, localContextVars).forEach((dep) => deps.add(dep));
          }
        }
      }
    }

    this.logger.debug(`Found dependencies: ${Array.from(deps).join(', ')}`);
    return Array.from(deps);
  }

  /**
   * Extract step references from an expression
   */
  private extractReferences(expr: string, localContextVars: string[]): string[] {
    this.logger.debug(`Extracting references from expression: ${expr}`);
    const refs = new Set<string>();
    const matches = expr.match(/\${([^}]+)}/g) || [];

    for (const match of matches) {
      const path = match.slice(2, -1);
      const parts = path.split('.');
      const first = parts[0];

      // Skip if it's a local context variable
      if (localContextVars.includes(first)) {
        continue;
      }

      // Skip if it's a global context variable or special variable
      if (
        first === 'context' ||
        first === 'metadata' ||
        first === 'item' ||
        first === 'acc' ||
        first === 'a' ||
        first === 'b'
      ) {
        continue;
      }

      refs.add(first);
    }

    this.logger.debug(`Extracted references: ${Array.from(refs).join(', ')}`);
    return Array.from(refs);
  }

  /**
   * Perform a topological sort on the dependency graph
   */
  private topologicalSort(graph: Map<string, Set<string>>): Step[] {
    this.logger.debug('Performing topological sort');
    const visited = new Set<string>();
    const temp = new Set<string>();
    const order: string[] = [];

    const visit = (node: string) => {
      if (temp.has(node)) {
        throw new Error(`Circular dependency detected: ${node}`);
      }
      if (visited.has(node)) {
        return;
      }
      temp.add(node);
      const deps = graph.get(node) || new Set();
      for (const dep of deps) {
        visit(dep);
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
}
