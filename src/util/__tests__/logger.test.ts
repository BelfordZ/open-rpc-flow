import { ConsoleLogger, TestLogger } from '../logger';
import { NoLogger, noLogger } from '../no-logger';

describe('ConsoleLogger', () => {
  let originalConsole: typeof console;
  let mockConsole: Pick<Console, 'log' | 'error' | 'warn' | 'debug'>;

  beforeEach(() => {
    // Save original console
    originalConsole = global.console;
    // Create mock console with just the methods we need
    mockConsole = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
    // Replace console with mock
    global.console = mockConsole as typeof console;
  });

  afterEach(() => {
    // Restore original console
    global.console = originalConsole;
  });

  it('logs messages without prefix', () => {
    const logger = new ConsoleLogger();
    logger.log('test message');
    expect(mockConsole.log).toHaveBeenCalledWith('test message');
  });

  it('logs messages with prefix', () => {
    const logger = new ConsoleLogger('TestPrefix');
    logger.log('test message');
    expect(mockConsole.log).toHaveBeenCalledWith('[TestPrefix] test message');
  });

  it('logs messages with arguments', () => {
    const logger = new ConsoleLogger('Test');
    const arg1 = { key: 'value' };
    const arg2 = [1, 2, 3];
    logger.log('test message', arg1, arg2);
    expect(mockConsole.log).toHaveBeenCalledWith('[Test] test message', arg1, arg2);
  });

  it('handles all log levels', () => {
    const logger = new ConsoleLogger('Test');
    logger.log('log message');
    logger.error('error message');
    logger.warn('warn message');
    logger.debug('debug message');

    expect(mockConsole.log).toHaveBeenCalledWith('[Test] log message');
    expect(mockConsole.error).toHaveBeenCalledWith('[Test] error message');
    expect(mockConsole.warn).toHaveBeenCalledWith('[Test] warn message');
    expect(mockConsole.debug).toHaveBeenCalledWith('[Test] debug message');
  });

  it('creates nested loggers with combined prefix', () => {
    const logger = new ConsoleLogger('Parent');
    const nested = logger.createNested('Child');
    nested.log('test message');
    expect(mockConsole.log).toHaveBeenCalledWith('[Parent:Child] test message');
  });

  it('creates nested loggers from unprefixed logger', () => {
    const logger = new ConsoleLogger();
    const nested = logger.createNested('Child');
    nested.log('test message');
    expect(mockConsole.log).toHaveBeenCalledWith('[Child] test message');
  });
});

describe('TestLogger', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger('Test');
  });

  it('stores log messages with correct format', () => {
    logger.log('test message');
    expect(logger.getLogs()).toEqual(['[LOG] [Test] test message']);
  });

  it('handles all log levels', () => {
    logger.log('log message');
    logger.error('error message');
    logger.warn('warn message');
    logger.debug('debug message');

    const logs = logger.getLogs();
    expect(logs).toEqual([
      '[LOG] [Test] log message',
      '[ERROR] [Test] error message',
      '[WARN] [Test] warn message',
      '[DEBUG] [Test] debug message',
    ]);
  });

  it('formats single argument correctly', () => {
    const arg = { key: 'value' };
    logger.log('test message', arg);
    expect(logger.getLogs()[0]).toBe('[LOG] [Test] test message {"key":"value"}');
  });

  it('formats multiple arguments correctly', () => {
    logger.log('test message', 1, 'two', { three: 3 });
    expect(logger.getLogs()[0]).toBe('[LOG] [Test] test message [1,"two",{"three":3}]');
  });

  it('clears logs', () => {
    logger.log('test message');
    expect(logger.getLogs()).toHaveLength(1);
    logger.clear();
    expect(logger.getLogs()).toHaveLength(0);
  });

  it('returns logs as string', () => {
    logger.log('message 1');
    logger.log('message 2');
    expect(logger.getLogsAsString()).toBe('[LOG] [Test] message 1\n[LOG] [Test] message 2');
  });

  it('prints logs to console', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    logger.log('test message');
    logger.print();
    expect(spy).toHaveBeenCalledWith('\n=== Test Logs ===\n');
    expect(spy).toHaveBeenCalledWith('[LOG] [Test] test message');
    spy.mockRestore();
  });

  it('prints appropriate message when no logs', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation();
    logger.print();
    expect(spy).toHaveBeenCalledWith('No logs recorded');
    spy.mockRestore();
  });

  it('shares logs between parent and nested loggers', () => {
    const nested = logger.createNested('Child');
    logger.log('parent message');
    nested.log('child message');

    const logs = logger.getLogs();
    expect(logs).toEqual(['[LOG] [Test] parent message', '[LOG] [Test:Child] child message']);

    // Nested logger should see all logs too
    expect(nested.getLogs()).toEqual(logs);
  });
});

describe('NoLogger', () => {
  it('returns singleton instance', () => {
    const logger1 = NoLogger.getInstance();
    const logger2 = NoLogger.getInstance('different prefix');
    expect(logger1).toBe(logger2);
  });

  it('exports singleton instance', () => {
    expect(noLogger).toBe(NoLogger.getInstance());
  });

  it('silently handles all log methods', () => {
    const logger = NoLogger.getInstance();
    // These should not throw
    logger.log('test');
    logger.error('test');
    logger.warn('test');
    logger.debug('test');
  });

  it('returns self for nested loggers', () => {
    const logger = NoLogger.getInstance();
    const nested = logger.createNested('Child');
    expect(nested).toBe(logger);
  });

  it('ignores prefix in singleton instance', () => {
    const logger1 = NoLogger.getInstance('prefix1');
    const logger2 = NoLogger.getInstance('prefix2');
    expect(logger1).toBe(logger2);
  });
});
