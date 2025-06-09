import vm from 'node:vm';
import { Logger } from '../util/logger';

/**
 * Minimal expression evaluator using Node's vm module. This is a placeholder
 * for a full SES based implementation.
 */
export class SesExpressionEvaluator {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger.createNested('SesExpressionEvaluator');
  }

  evaluate(expression: string, context: Record<string, any>): any {
    this.logger.debug('Evaluating expression via SES', { expression });
    const script = new vm.Script(expression);
    return script.runInNewContext({ ...context });
  }

  extractReferences(expression: string): string[] {
    const identifiers = new Set<string>();
    const regex = /[a-zA-Z_$][\w$]*/g;
    let match;
    while ((match = regex.exec(expression))) {
      const id = match[0];
      if (!['true', 'false', 'null', 'undefined'].includes(id)) {
        identifiers.add(id);
      }
    }
    return Array.from(identifiers);
  }
}
