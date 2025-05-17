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

export class ConsoleLogger implements Logger {
  constructor(
    private prefix?: string,
    private _console: Console = console,
  ) {}

  info(message: string, data?: unknown) {
    if (this.prefix) {
      message = `[${this.prefix}] ${message}`;
    }
    if (data !== undefined) {
      this._console.info(message, data);
    } else {
      this._console.info(message);
    }
  }

  error(message: string, data?: unknown) {
    if (this.prefix) {
      message = `[${this.prefix}] ${message}`;
    }
    if (data !== undefined) {
      this._console.error(message, data);
    } else {
      this._console.error(message);
    }
  }
  warn(message: string, data?: unknown) {
    if (this.prefix) {
      message = `[${this.prefix}] ${message}`;
    }
    if (data !== undefined) {
      this._console.warn(message, data);
    } else {
      this._console.warn(message);
    }
  }
  debug(message: string, data?: unknown) {
    if (this.prefix) {
      message = `[${this.prefix}] ${message}`;
    }
    if (data !== undefined) {
      this._console.debug(message, data);
    } else {
      this._console.debug(message);
    }
  }
  createNested(prefix: string): ConsoleLogger {
    const combinedPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new ConsoleLogger(combinedPrefix, this._console);
  }
}

export class TestLogger implements Logger {
  private logs: { level: string; message: string; data?: unknown }[] = [];
  constructor(private name: string = 'TestLogger') {}

  info(message: string, data?: unknown) {
    this.logs.push({ level: 'info', message, data });
  }

  warn(message: string, data?: unknown) {
    this.logs.push({ level: 'warn', message, data });
  }
  debug(message: string, data?: unknown) {
    this.logs.push({ level: 'debug', message, data });
  }
  error(message: string, data?: unknown) {
    this.logs.push({ level: 'error', message, data });
  }
  getLogs() {
    return this.logs;
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
