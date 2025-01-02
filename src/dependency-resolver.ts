import { Flow, Step } from './types';
import { Logger } from './util/logger';
import { isLoopStep, isRequestStep, isConditionStep, isTransformStep } from './step-executors/types';

export class DependencyResolver {
  constructor(private flow: Flow, private logger: Logger) {}

  /**
   * Get the execution order for all steps in the flow
   */
  getExecutionOrder(): Step[] {
    const graph = this.buildDependencyGraph();
    return this.topologicalSort(graph);
  }

  /**
   * Build a dependency graph for all steps in the flow
   */
  private buildDependencyGraph(): Map<string, Set<string>> {
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
    }

    return graph;
  }

  /**
   * Find all dependencies for a step
   */
  private findStepDependencies(step: Step, localContextVars: string[] = []): string[] {
    const deps = new Set<string>();

    // Extract references from loop steps
    if (isLoopStep(step)) {
      const loopVars = [...localContextVars, step.loop.as];
      const mergeDeps = (subStep: Step | undefined, vars: string[]) => {
        if (subStep) {
          this.findStepDependencies(subStep, vars).forEach((dep) => deps.add(dep));
        }
      };

      // Extract references from the collection expression
      this.extractReferences(step.loop.over, localContextVars).forEach((dep) => deps.add(dep));

      // Extract references from the condition expression
      if (step.loop.condition) {
        this.extractReferences(step.loop.condition, loopVars).forEach((dep) => deps.add(dep));
      }

      // Extract references from the loop step(s)
      mergeDeps(step.loop.step, loopVars);
      if (step.loop.steps) {
        step.loop.steps.forEach((s) => mergeDeps(s, loopVars));
      }
    }

    // Extract references from request steps
    if (isRequestStep(step)) {
      this.extractReferences(JSON.stringify(step.request.params)).forEach((dep) => deps.add(dep));
    }

    // Extract references from condition steps
    if (isConditionStep(step)) {
      this.extractReferences(step.condition.if).forEach((dep) => deps.add(dep));
      if (step.condition.then) {
        this.findStepDependencies(step.condition.then, localContextVars).forEach((dep) => deps.add(dep));
      }
      if (step.condition.else) {
        this.findStepDependencies(step.condition.else, localContextVars).forEach((dep) => deps.add(dep));
      }
    }

    // Extract references from transform steps
    if (isTransformStep(step)) {
      this.extractReferences(step.transform.input).forEach((dep) => deps.add(dep));
      for (const op of step.transform.operations) {
        if ('using' in op) {
          this.extractReferences(op.using).forEach((dep) => deps.add(dep));
        }
      }
    }

    return Array.from(deps);
  }

  /**
   * Extract step references from an expression
   */
  private extractReferences(expr: string, localContextVars: string[] = []): string[] {
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
      if (first === 'context' || first === 'metadata' || first === 'item' || first === 'acc') {
        continue;
      }

      refs.add(first);
    }

    return Array.from(refs);
  }

  /**
   * Perform a topological sort on the dependency graph
   */
  private topologicalSort(graph: Map<string, Set<string>>): Step[] {
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

    // Convert step names back to step objects
    return order.map((name) => this.flow.steps.find((s) => s.name === name)!);
  }
}
