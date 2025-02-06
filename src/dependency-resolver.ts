import { Flow, Step, DependencyGraph, DependencyNode } from './types';
import { Logger } from './util/logger';
import {
  isLoopStep,
  isRequestStep,
  isConditionStep,
  isTransformStep,
} from './step-executors/types';
import { SafeExpressionEvaluator } from './expression-evaluator/safe-evaluator';

export class DependencyResolver {
  private logger: Logger;
  private internalVars = new Set(['context', 'metadata']);
  private loopVars = new Set<string>();

  constructor(
    private flow: Flow,
    private expressionEvaluator: SafeExpressionEvaluator,
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
  private findStepDependencies(step: Step): string[] {
    this.logger.debug(`Finding dependencies for step: ${step.name}`);
    const deps = new Set<string>();

    // Extract references from loop steps
    if (isLoopStep(step)) {
      // Add dependencies from the loop's "over" expression
      this.extractReferences(step.loop.over).forEach((dep) => deps.add(dep));

      // Add dependencies from the loop's condition if present
      if (step.loop.condition) {
        // Add the loop variable to loopVars temporarily
        const loopVar = step.loop.as;
        this.loopVars.add(loopVar);

        // Extract references from the condition
        this.extractReferences(step.loop.condition).forEach((dep) => deps.add(dep));

        // Process the loop's step
        if (step.loop.step) {
          this.findStepDependencies(step.loop.step).forEach((dep) => deps.add(dep));
        }

        // Remove the loop variable from loopVars
        this.loopVars.delete(loopVar);
      } else {
        // If no condition, just process the loop's step
        if (step.loop.step) {
          // Add the loop variable to loopVars temporarily
          const loopVar = step.loop.as;
          this.loopVars.add(loopVar);

          // Find dependencies in the loop step
          this.findStepDependencies(step.loop.step).forEach((dep) => deps.add(dep));

          // Remove the loop variable from loopVars
          this.loopVars.delete(loopVar);
        }
      }
    }

    // Extract references from condition steps
    if (isConditionStep(step)) {
      this.extractReferences(step.condition.if).forEach((dep) => deps.add(dep));
      if (step.condition.then) {
        this.findStepDependencies(step.condition.then).forEach((dep) => deps.add(dep));
      }
      if (step.condition.else) {
        this.findStepDependencies(step.condition.else).forEach((dep) => deps.add(dep));
      }
    }

    // Extract references from request steps
    if (isRequestStep(step)) {
      const params = step.request.params;
      for (const value of Object.values(params)) {
        if (typeof value === 'string') {
          this.extractReferences(value).forEach((dep) => deps.add(dep));
        }
      }
    }

    // Extract references from transform steps
    if (isTransformStep(step)) {
      if (typeof step.transform.input === 'string') {
        this.extractReferences(step.transform.input).forEach((dep) => deps.add(dep));
      }
      if (step.transform.operations) {
        // Add 'item' to loopVars temporarily for map/filter operations
        this.loopVars.add('item');
        // Add 'acc' to loopVars temporarily for reduce operations
        if (step.transform.operations.some((op) => op.type === 'reduce')) {
          this.loopVars.add('acc');
        }
        // Add 'a' and 'b' to loopVars temporarily for sort operations
        if (step.transform.operations.some((op) => op.type === 'sort')) {
          this.loopVars.add('a');
          this.loopVars.add('b');
        }

        for (const op of step.transform.operations) {
          if (op.using && typeof op.using === 'string') {
            this.extractReferences(op.using).forEach((dep) => deps.add(dep));
          }
        }

        // Remove temporary loop variables
        this.loopVars.delete('item');
        this.loopVars.delete('acc');
        this.loopVars.delete('a');
        this.loopVars.delete('b');
      }
    }

    this.logger.debug(`Found dependencies: ${Array.from(deps).join(', ')}`);
    return Array.from(deps);
  }

  /**
   * Extract step references from an expression
   */
  private extractReferences(expr: string): string[] {
    const refs = this.expressionEvaluator.extractReferences(expr);
    // Filter out internal variables and loop variables
    return refs.filter((ref) => !this.internalVars.has(ref) && !this.loopVars.has(ref));
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

  /**
   * Get a UI-friendly representation of the dependency graph
   */
  getDependencyGraph(): DependencyGraph {
    this.logger.debug('Getting dependency graph representation');
    const graph = this.buildDependencyGraph();
    const nodes: DependencyNode[] = [];
    const edges: Array<{ from: string; to: string }> = [];

    // Create nodes
    for (const step of this.flow.steps) {
      const dependencies = Array.from(graph.get(step.name) || []);
      const dependents = this.getDependents(step.name);

      // Determine step type
      let type: DependencyNode['type'] = 'request'; // default
      if (isLoopStep(step)) type = 'loop';
      if (isConditionStep(step)) type = 'condition';
      if (isTransformStep(step)) type = 'transform';

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
