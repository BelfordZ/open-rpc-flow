export { NoLogger, noLogger } from './no-logger';

/**
 * Represents a value that can be logged
 */
export type LogValue = string | number | boolean | null | undefined | object | Error | LogValue[];

export interface Logger {
  log(message: string, ...args: LogValue[]): void;
  error(message: string, ...args: LogValue[]): void;
  warn(message: string, ...args: LogValue[]): void;
  debug(message: string, ...args: LogValue[]): void;
  createNested(prefix: string): Logger;
}

export class ConsoleLogger implements Logger {
  constructor(private prefix: string = '') {}

  private formatMessage(message: string): string {
    return this.prefix ? `[${this.prefix}] ${message}` : message;
  }

  log(message: string, ...args: LogValue[]): void {
    console.log(this.formatMessage(message), ...args);
  }

  error(message: string, ...args: LogValue[]): void {
    console.error(this.formatMessage(message), ...args);
  }

  warn(message: string, ...args: LogValue[]): void {
    console.warn(this.formatMessage(message), ...args);
  }

  debug(message: string, ...args: LogValue[]): void {
    console.debug(this.formatMessage(message), ...args);
  }

  createNested(prefix: string): Logger {
    const nestedPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    return new ConsoleLogger(nestedPrefix);
  }
}

export class TestLogger implements Logger {
  constructor(private prefix: string = '') {}

  private logs: string[] = [];

  log(message: string, ...args: LogValue[]): void {
    this.logs.push(this.formatLogEntry('LOG', message, args));
  }

  error(message: string, ...args: LogValue[]): void {
    this.logs.push(this.formatLogEntry('ERROR', message, args));
  }

  warn(message: string, ...args: LogValue[]): void {
    this.logs.push(this.formatLogEntry('WARN', message, args));
  }

  debug(message: string, ...args: LogValue[]): void {
    this.logs.push(this.formatLogEntry('DEBUG', message, args));
  }

  private formatLogEntry(level: string, message: string, args: LogValue[]): string {
    const prefixPart = this.prefix ? `[${this.prefix}] ` : '';
    const argsStr =
      args.length === 1 ? JSON.stringify(args[0]) : args.length > 1 ? JSON.stringify(args) : '';
    return `[${level}] ${prefixPart}${message}${argsStr ? ' ' + argsStr : ''}`.trim();
  }

  getLogs(): string[] {
    return this.logs;
  }

  clear(): void {
    this.logs = [];
  }

  getLogsAsString(): string {
    return this.logs.join('\n');
  }

  print(): void {
    if (this.logs.length === 0) {
      console.log('No logs recorded');
      return;
    }
    console.log('\n=== Test Logs ===\n');
    console.log(this.getLogsAsString());
    console.log('\n================\n');
  }

  createNested(prefix: string): TestLogger {
    const nestedPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    const nestedLogger = new TestLogger(nestedPrefix);
    // Share the logs array with the parent
    nestedLogger.logs = this.logs;
    return nestedLogger;
  }
}

export const defaultLogger = new ConsoleLogger('FlowExecutor');
