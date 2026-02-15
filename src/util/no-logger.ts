import { Logger } from './logger';

/**
 * A logger implementation that silently discards all logs.
 * Useful for:
 * - Performance-sensitive code where logging overhead matters
 * - Testing components where logs are not relevant
 * - Explicitly suppressing all logging output
 */
export class NoLogger implements Logger {
  private static instance: NoLogger;

  private constructor(private prefix: string = '') {}

  static getInstance(prefix: string = ''): NoLogger {
    if (!NoLogger.instance) {
      NoLogger.instance = new NoLogger(prefix);
    }
    return NoLogger.instance;
  }

  info(_message: string, ..._args: unknown[]): void {}
  error(_message: string, ..._args: unknown[]): void {}
  warn(_message: string, ..._args: unknown[]): void {}
  debug(_message: string, ..._args: unknown[]): void {}

  createNested(_prefix: string): Logger {
    return NoLogger.instance;
  }
}

/**
 * A singleton instance of NoLogger that can be reused.
 * The prefix is ignored as all instances share the same state.
 */
export const noLogger = NoLogger.getInstance();
