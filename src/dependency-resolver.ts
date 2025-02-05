import { Flow, Step, DependencyGraph, DependencyNode } from './types';
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

  /**
   * Get a Mermaid flowchart representation of the dependency graph
   * @returns Mermaid flowchart syntax as a string
   */
  getMermaidDiagram(): string {
    this.logger.debug('Generating Mermaid diagram');
    const graph = this.getDependencyGraph();
    
    const lines: string[] = [
      'flowchart LR',
      '    %% Styles',
      '    classDef request fill:#e1f5fe,stroke:#01579b,stroke-width:2px',
      '    classDef transform fill:#f3e5f5,stroke:#4a148c,stroke-width:2px',
      '    classDef condition fill:#fff3e0,stroke:#e65100,stroke-width:2px',
      '    classDef loop fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px',
      '',
    ];
    
    // Track nested nodes we'll add
    const nestedNodes = new Map<string, Step>();
    
    // Add nodes with styling based on type
    for (const node of graph.nodes) {
      const step = this.flow.steps.find(s => s.name === node.name);
      if (!step) continue;

      const style = this.getMermaidNodeStyle(node);
      const tooltip = this.getNodeTooltip(node);
      lines.push(`    ${node.name}_node${style}`);
      if (tooltip) {
        lines.push(`    click ${node.name}_node "${tooltip}"`);
      }
      lines.push(`    class ${node.name}_node ${node.type}`);

      // Add nested steps from conditions
      if (isConditionStep(step) && step.condition.then) {
        const thenStep = step.condition.then;
        nestedNodes.set(`${node.name}_then`, thenStep);
        lines.push(`    ${node.name}_then_node["${this.getStepLabel(thenStep)}"]`);
        lines.push(`    class ${node.name}_then_node request`);
      }

      // Add nested steps from loops
      if (isLoopStep(step) && step.loop.step) {
        const loopStep = step.loop.step;
        nestedNodes.set(`${node.name}_inner`, loopStep);
        lines.push(`    ${node.name}_inner_node["${this.getStepLabel(loopStep)}"]`);
        lines.push(`    class ${node.name}_inner_node request`);
      }
    }
    
    lines.push('');

    // Add edges with labels showing the referenced fields
    for (const edge of graph.edges) {
      const refs = this.findStepReferences(edge.from, edge.to);
      const label = refs.length > 0 ? `|${refs.join(', ')}|` : '';
      lines.push(`    ${edge.from}_node -->${label} ${edge.to}_node`);
    }

    // Add edges for nested nodes
    for (const node of graph.nodes) {
      const step = this.flow.steps.find(s => s.name === node.name);
      if (!step) continue;

      if (isConditionStep(step)) {
        const condition = step.condition.if.replace(/\${([^}]+)}/g, '$1');
        lines.push(`    ${node.name}_node -->|${condition}| ${node.name}_then_node`);
      }
      if (isLoopStep(step)) {
        const itemVar = step.loop.as;
        lines.push(`    ${node.name}_node -->|${itemVar}| ${node.name}_inner_node`);
      }
    }
    
    return lines.join('\n');
  }

  /**
   * Get Mermaid node style based on step type
   */
  private getMermaidNodeStyle(node: DependencyNode): string {
    const step = this.flow.steps.find(s => s.name === node.name);
    if (!step) return '';

    const label = this.getStepLabel(step);
    switch (node.type) {
      case 'request':
        return `["${label}"]`;
      case 'transform':
        return `{{"${label}"}}`;
      case 'condition':
        return `{${label}}`;
      case 'loop':
        return `(("${label}"))`;
      default:
        return '';
    }
  }

  /**
   * Get a descriptive label for a step
   */
  private getStepLabel(step: Step): string {
    if (step.request) {
      return `${step.name}<br/>${step.request.method}`;
    }
    if (step.transform) {
      const ops = step.transform.operations.map(op => op.type).join(', ');
      return `${step.name}<br/>${ops}`;
    }
    if (step.condition) {
      return step.name;
    }
    if (step.loop) {
      const over = step.loop.over.replace(/\${([^}]+)}/g, '$1');
      return `${step.name}<br/>over ${over}`;
    }
    return step.name;
  }

  /**
   * Get tooltip text for a node
   */
  private getNodeTooltip(node: DependencyNode): string {
    const step = this.flow.steps.find(s => s.name === node.name);
    if (!step) return '';

    let details = '';
    if (step.request) {
      details = `Method: ${step.request.method}`;
      if (Object.keys(step.request.params).length > 0) {
        details += `\nParams: ${JSON.stringify(step.request.params)}`;
      }
    } else if (step.transform) {
      details = `Input: ${step.transform.input}\nOperations: ${step.transform.operations.map(op => op.type).join(', ')}`;
    } else if (step.condition) {
      details = `Condition: ${step.condition.if}`;
    } else if (step.loop) {
      details = `Loop over: ${step.loop.over} as ${step.loop.as}`;
    }

    return details;
  }

  /**
   * Find specific references between two steps
   */
  private findStepReferences(fromStep: string, toStep: string): string[] {
    const step = this.flow.steps.find(s => s.name === toStep);
    if (!step) return [];

    const refs = new Set<string>();
    const addRef = (expr: string) => {
      const matches = expr.match(/\${([^}]+)}/g) || [];
      for (const match of matches) {
        const path = match.slice(2, -1);
        if (path.startsWith(fromStep + '.')) {
          refs.add(path.split('.')[1]);
        }
      }
    };

    if (step.request) {
      Object.values(step.request.params).forEach(v => {
        if (typeof v === 'string') addRef(v);
      });
    }
    if (step.transform?.input) {
      addRef(step.transform.input);
    }
    if (step.condition?.if) {
      addRef(step.condition.if);
    }
    if (step.loop?.over) {
      addRef(step.loop.over);
    }

    return Array.from(refs);
  }
}
