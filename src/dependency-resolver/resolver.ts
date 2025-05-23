import { Flow, Step, DependencyGraph, DependencyNode } from '../types';
import { StepType } from '../step-executors/types';
import { Logger } from '../util/logger';
import {
  isLoopStep,
  isRequestStep,
  isConditionStep,
  isTransformStep,
} from '../step-executors/types';
import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';
import { StepNotFoundError, UnknownDependencyError, CircularDependencyError } from './errors';

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
    const logger = this.logger.createNested('getExecutionOrder');
    logger.debug('Getting execution order');
    const graph = this.buildDependencyGraph(logger);
    return this.topologicalSort(graph);
  }

  /**
   * Get all dependencies for a given step
   */
  getDependencies(stepName: string): string[] {
    const logger = this.logger.createNested(`getDependencies: ${stepName}`);
    logger.debug(`Getting dependencies for step: ${stepName}`);
    const graph = this.buildDependencyGraph(logger);
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
    const graph = this.buildDependencyGraph(logger);
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

    // Add dependencies for each step
    for (const step of this.flow.steps) {
      const deps = this.findStepDependencies(step, logger);
      for (const dep of deps) {
        if (!graph.has(dep)) {
          const availableSteps = Array.from(graph.keys());
          throw new UnknownDependencyError(
            `Step '${step.name}' depends on unknown step '${dep}'`,
            step.name,
            dep,
            availableSteps,
          );
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
  private findStepDependencies(step: Step, parentLogger: Logger): string[] {
    const logger = parentLogger.createNested(`findStepDependencies: ${step.name}`);
    const deps = new Set<string>();

    // Extract references from loop steps
    if (isLoopStep(step)) {
      logger.debug('handling loop step');
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
          this.findStepDependencies(step.loop.step, logger).forEach((dep) => deps.add(dep));
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
          this.findStepDependencies(step.loop.step, logger).forEach((dep) => deps.add(dep));

          // Remove the loop variable from loopVars
          this.loopVars.delete(loopVar);
        }
      }

      // Process the loop's steps if present
      if (step.loop.steps) {
        logger.debug('handling loop steps');
        // Add the loop variable to loopVars temporarily
        const loopVar = step.loop.as;
        this.loopVars.add(loopVar);

        // Find dependencies in each step
        for (const subStep of step.loop.steps) {
          this.findStepDependencies(subStep, logger).forEach((dep) => deps.add(dep));
        }

        // Remove the loop variable from loopVars
        this.loopVars.delete(loopVar);
      }
    }

    // Extract references from condition steps
    if (isConditionStep(step)) {
      logger.debug('handling condition step');
      this.extractReferences(step.condition.if).forEach((dep) => deps.add(dep));
      if (step.condition.then) {
        this.findStepDependencies(step.condition.then, logger).forEach((dep) => deps.add(dep));
      }
      if (step.condition.else) {
        this.findStepDependencies(step.condition.else, logger).forEach((dep) => deps.add(dep));
      }
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

    logger.debug(`Found dependencies: ${Array.from(deps).join(', ')}`);
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
    const graph = this.buildDependencyGraph(logger);

    const nodes: DependencyNode[] = [];
    const edges: Array<{ from: string; to: string }> = [];

    // Create nodes
    for (const step of this.flow.steps) {
      const deps = graph.get(step.name) as Set<string>;
      const dependencies = Array.from(deps);
      const dependents = this.getDependents(step.name);

      // Determine step type
      let type: DependencyNode['type'] = StepType.Request; // default
      if (isLoopStep(step)) type = StepType.Loop;
      if (isConditionStep(step)) type = StepType.Condition;
      if (isTransformStep(step)) type = StepType.Transform;

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
