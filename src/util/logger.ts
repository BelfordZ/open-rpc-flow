export { NoLogger, noLogger } from './no-logger';

export interface Logger {
  /**
   * General informational messages.
   */
  info(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  createNested(prefix: string): Logger;
}

/**
 * Log severity levels, ordered from most to least verbose.
 * A `ConsoleLogger` emits a message only when the message's level is at or
 * above its configured level.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export class ConsoleLogger implements Logger {
  constructor(
    private prefix?: string,
    private _console: Console = console,
    private level: LogLevel = 'warn',
  ) {}

  info(message: string, data?: unknown) {
    this.log('info', message, data);
  }

  error(message: string, data?: unknown) {
    this.log('error', message, data);
  }

  warn(message: string, data?: unknown) {
    this.log('warn', message, data);
  }

  debug(message: string, data?: unknown) {
    this.log('debug', message, data);
  }

  /**
   * The minimum level this logger emits. Messages below it are dropped.
   */
  getLevel(): LogLevel {
    return this.level;
  }

  /**
   * Raise or lower the level at runtime, e.g. to opt back into debug output.
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private log(level: LogLevel, message: string, data?: unknown) {
    if (LOG_LEVEL_SEVERITY[level] < LOG_LEVEL_SEVERITY[this.level]) {
      return;
    }
    const formattedMessage = this.prefix ? `[${this.prefix}] ${message}` : message;
    if (data !== undefined) {
      this._console[level](formattedMessage, data);
      return;
    }
    this._console[level](formattedMessage);
  }

  createNested(prefix: string): ConsoleLogger {
    const combinedPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new ConsoleLogger(combinedPrefix, this._console, this.level);
  }
}

export class TestLogger implements Logger {
  private logs: { level: string; message: string; data?: unknown }[] = [];
  constructor(private name: string = 'TestLogger') {}

  info(message: string, data?: unknown) {
    this.addLog('info', message, data);
  }

  warn(message: string, data?: unknown) {
    this.addLog('warn', message, data);
  }

  debug(message: string, data?: unknown) {
    this.addLog('debug', message, data);
  }

  error(message: string, data?: unknown) {
    this.addLog('error', message, data);
  }

  private addLog(level: string, message: string, data?: unknown) {
    this.logs.push({ level, message, data });
  }

  getLogs() {
    return this.logs;
  }
  getLogsAs<T = unknown>() {
    return this.logs as Array<{ level: string; message: string; data?: T }>;
  }
  clear() {
    this.logs = [];
  }
  print() {
    const logs = this.logs.map(
      (log) =>
        `[${log.level.toUpperCase()}] [${this.name}] ${log.message}${log.data ? ' ' + JSON.stringify(log.data) : ''}`,
    );
    console.log(logs.join('\n'));
  }
  createNested(prefix: string): TestLogger {
    const nestedPrefix = this.name ? `${this.name}:${prefix}` : prefix;
    const nestedLogger = new TestLogger(nestedPrefix);
    // Share the logs array with the parent
    (nestedLogger as any).logs = this.logs;
    return nestedLogger;
  }
}

export const defaultLogger = new ConsoleLogger('FlowExecutor');
