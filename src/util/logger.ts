export { NoLogger, noLogger } from './no-logger';

export interface Logger {
  log(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  debug(message: string, ...args: any[]): void;
  createNested(prefix: string): Logger;
}

export class ConsoleLogger implements Logger {
  constructor(private prefix: string = '') {}

  private formatMessage(message: string): string {
    return this.prefix ? `[${this.prefix}] ${message}` : message;
  }

  log(message: string, ...args: any[]): void {
    console.log(this.formatMessage(message), ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(this.formatMessage(message), ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(this.formatMessage(message), ...args);
  }

  debug(message: string, ...args: any[]): void {
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

  log(message: string, ...args: any[]): void {
    this.logs.push(this.formatLogEntry('LOG', message, args));
  }

  error(message: string, ...args: any[]): void {
    this.logs.push(this.formatLogEntry('ERROR', message, args));
  }

  warn(message: string, ...args: any[]): void {
    this.logs.push(this.formatLogEntry('WARN', message, args));
  }

  debug(message: string, ...args: any[]): void {
    this.logs.push(this.formatLogEntry('DEBUG', message, args));
  }

  private formatLogEntry(level: string, message: string, args: any[]): string {
    const prefixPart = this.prefix ? `[${this.prefix}] ` : '';
    const argsStr = args.length === 1 ? JSON.stringify(args[0]) : args.length > 1 ? JSON.stringify(args) : '';
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