import { FlowError } from './base';
import { ErrorCode } from './codes';
import { Logger } from '../util/logger';

/**
 * Structure for execution context information
 */
export interface ExecutionContext {
  step: {
    name: string;
    type: string;
    params: Record<string, any>;
  };
  execution: {
    startTime: Date;
    duration?: number;
    attempts: number;
  };
  system: {
    memory: number;
    cpu: number;
    env: string;
  };
}

/**
 * Collects context information for error reporting and monitoring
 */
export class ContextCollector {
  private startTime: Date;
  private attempts: number;
  private context: Record<string, any> = {};

  constructor(private logger: Logger) {
    this.startTime = new Date();
    this.attempts = 0;
  }

  /**
   * Collect current execution context
   */
  async collect(): Promise<ExecutionContext> {
    const memory = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      step: await this.getStepContext(),
      execution: this.getExecutionContext(),
      system: {
        memory: memory.heapUsed,
        cpu: cpuUsage.user,
        env: process.env.NODE_ENV || 'unknown',
      },
    };
  }

  /**
   * Record an attempt
   */
  recordAttempt(): void {
    this.attempts++;
  }

  /**
   * Get step-specific context
   */
  private async getStepContext(): Promise<ExecutionContext['step']> {
    // This would be populated with actual step information
    // from the current execution context
    return {
      name: 'unknown',
      type: 'unknown',
      params: {},
    };
  }

  /**
   * Get execution timing context
   */
  private getExecutionContext(): ExecutionContext['execution'] {
    const now = new Date();
    return {
      startTime: this.startTime,
      duration: now.getTime() - this.startTime.getTime(),
      attempts: this.attempts,
    };
  }

  /**
   * Add context information
   */
  addContext(key: string, value: any): void {
    this.context[key] = value;
    this.logger.debug('Added context', { key, value });
  }

  /**
   * Get all context information
   */
  getContext(): Record<string, any> {
    return { ...this.context };
  }

  /**
   * Clear all context information
   */
  clearContext(): void {
    this.context = {};
    this.logger.debug('Cleared context');
  }

  /**
   * Create an error with context
   */
  createError(message: string, code: ErrorCode): FlowError {
    return new FlowError(message, code, this.getContext());
  }
}
