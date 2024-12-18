import { Flow, Step } from './types';
import { 
  RequestStep, 
  LoopStep, 
  ConditionStep, 
  TransformStep,
  isRequestStep,
  isLoopStep,
  isConditionStep,
  isTransformStep
} from './step-executors';

interface DependencyNode {
  step: Step;
  dependencies: Set<string>;
  dependents: Set<string>;
}

/**
 * Resolves dependencies between steps and determines execution order
 */
export class DependencyResolver {
  private dependencyGraph: Map<string, DependencyNode> = new Map();

  constructor(private flow: Flow) {
    this.buildDependencyGraph();
  }

  /**
   * Get steps in order of execution based on dependencies
   */
  getExecutionOrder(): Step[] {
    const visited = new Set<string>();
    const order: Step[] = [];
    const visiting = new Set<string>();

    const visit = (stepName: string) => {
      if (visiting.has(stepName)) {
        throw new Error(`Circular dependency detected involving step: ${stepName}`);
      }
      if (visited.has(stepName)) return;

      visiting.add(stepName);
      const node = this.dependencyGraph.get(stepName);
      if (!node) return;

      for (const dep of node.dependencies) {
        visit(dep);
      }

      visiting.delete(stepName);
      visited.add(stepName);
      order.push(node.step);
    };

    for (const step of this.flow.steps) {
      visit(step.name);
    }

    return order;
  }

  private buildDependencyGraph() {
    // First pass: create nodes
    for (const step of this.flow.steps) {
      this.dependencyGraph.set(step.name, {
        step,
        dependencies: new Set(),
        dependents: new Set()
      });
    }

    // Second pass: analyze dependencies
    for (const step of this.flow.steps) {
      const deps = this.findStepDependencies(step);
      const node = this.dependencyGraph.get(step.name)!;
      
      for (const dep of deps) {
        if (!this.dependencyGraph.has(dep)) {
          throw new Error(`Step "${step.name}" depends on unknown step "${dep}"`);
        }
        node.dependencies.add(dep);
        this.dependencyGraph.get(dep)!.dependents.add(step.name);
      }
    }
  }

  private findStepDependencies(step: Step, contextVars: Set<string> = new Set()): Set<string> {
    const deps = new Set<string>();
    
    // Helper to extract references from a string
    const extractRefs = (expr: string, localContextVars: Set<string> = contextVars) => {
      const matches = expr.match(/\${([^}]+)}/g) || [];
      for (const match of matches) {
        const ref = match.slice(2, -1).split('.')[0];
        if (ref !== 'context' && !localContextVars.has(ref)) {
          deps.add(ref);
        }
      }
    };

    // Helper to process an object for references
    const processObject = (obj: any, localContextVars: Set<string> = contextVars) => {
      for (const value of Object.values(obj)) {
        if (typeof value === 'string') {
          extractRefs(value, localContextVars);
        } else if (typeof value === 'object' && value !== null) {
          processObject(value, localContextVars);
        }
      }
    };

    // Helper to merge dependencies from a nested step
    const mergeDeps = (nestedStep: Step, localContextVars: Set<string> = contextVars) => {
      const nestedDeps = this.findStepDependencies(nestedStep, localContextVars);
      for (const dep of nestedDeps) {
        deps.add(dep);
      }
    };

    if (isLoopStep(step)) {
      // Process loop configuration
      extractRefs(step.loop.over);
      if (step.loop.condition) {
        const loopVars = new Set(contextVars);
        loopVars.add(step.loop.as);
        extractRefs(step.loop.condition, loopVars);
      }
      
      // Process inner step with loop variable in context
      const loopVars = new Set(contextVars);
      loopVars.add(step.loop.as);
      mergeDeps(step.loop.step, loopVars);
    }

    if (isRequestStep(step)) {
      processObject(step.request.params);
    }

    if (isConditionStep(step)) {
      extractRefs(step.condition.if);
      if (step.condition.then) {
        mergeDeps(step.condition.then, contextVars);
      }
      if (step.condition.else) {
        mergeDeps(step.condition.else, contextVars);
      }
    }

    if (isTransformStep(step)) {
      if (step.transform.input) {
        extractRefs(step.transform.input);
      }
      const transformVars = new Set(contextVars);
      transformVars.add('item');
      for (const op of step.transform.operations) {
        extractRefs(op.using, transformVars);
      }
    }

    return deps;
  }

  /**
   * Get all steps that depend on a given step
   */
  getDependents(stepName: string): string[] {
    const node = this.dependencyGraph.get(stepName);
    return node ? Array.from(node.dependents) : [];
  }

  /**
   * Get all steps that a given step depends on
   */
  getDependencies(stepName: string): string[] {
    const node = this.dependencyGraph.get(stepName);
    return node ? Array.from(node.dependencies) : [];
  }

  /**
   * Check if a step has any dependencies
   */
  hasDependencies(stepName: string): boolean {
    const node = this.dependencyGraph.get(stepName);
    return node ? node.dependencies.size > 0 : false;
  }
} 