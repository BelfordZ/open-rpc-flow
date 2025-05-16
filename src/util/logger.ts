export { NoLogger, noLogger } from './no-logger';

export interface Logger {
  /**
   * General informational messages.
   */
  info(message: string, ...args: any[]): void;
  /**
   * @deprecated Use `info` instead.
   */
  log(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
  createNested(prefix: string): Logger;
}

export class ConsoleLogger implements Logger {
  constructor(
    private prefix?: string,
    private _console: Console = console,
  ) {}

  info(message: string, data?: any) {
    if (this.prefix) {
      message = `[${this.prefix}] ${message}`;
    }
    if (data !== undefined) {
      this._console.info(message, data);
    } else {
      this._console.info(message);
    }
  }

  log(message: string, data?: any) {
    this.info(message, data);
  }
  error(message: string, data?: any) {
    if (this.prefix) {
      message = `[${this.prefix}] ${message}`;
    }
    if (data !== undefined) {
      this._console.error(message, data);
    } else {
      this._console.error(message);
    }
  }
  warn(message: string, data?: any) {
    if (this.prefix) {
      message = `[${this.prefix}] ${message}`;
    }
    if (data !== undefined) {
      this._console.warn(message, data);
    } else {
      this._console.warn(message);
    }
  }
  info(message: string, data?: any) {
    if (this.prefix) {
      message = `[${this.prefix}] ${message}`;
    }
    if (data !== undefined) {
      this._console.info(message, data);
    } else {
      this._console.info(message);
    }
  }
  debug(message: string, data?: any) {
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
  private logs: { level: string; message: string; data?: any }[] = [];
  constructor(private name: string = 'TestLogger') {}

  info(message: string, data?: any) {
    this.logs.push({ level: 'info', message, data });
  }

  log(message: string, data?: any) {
    this.info(message, data);
  }
  warn(message: string, data?: any) {
    this.logs.push({ level: 'warn', message, data });
  }
  debug(message: string, data?: any) {
    this.logs.push({ level: 'debug', message, data });
  }
  error(message: string, data?: any) {
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
