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
  test('captures logs without prefix', () => {
    const logger = new TestLogger();
    logger.log('test message', { data: 123 });
    expect(logger.getLogs()).toEqual([
      { level: 'log', message: 'test message', data: { data: 123 } },
    ]);
  });

  test('captures logs with prefix', () => {
    const logger = new TestLogger('TestPrefix');
    logger.log('test message', { data: 123 });
    expect(logger.getLogs()).toEqual([
      { level: 'log', message: 'test message', data: { data: 123 } },
    ]);
  });

  test('captures error logs', () => {
    const logger = new TestLogger('TestPrefix');
    const error = new Error('test error');
    logger.error('error message', error);
    expect(logger.getLogs()[0]).toMatchObject({
      level: 'error',
      message: 'error message',
      data: error,
    });
  });

  test('captures warning logs', () => {
    const logger = new TestLogger('TestPrefix');
    logger.warn('warning message', { warning: true });
    expect(logger.getLogs()).toEqual([
      { level: 'warn', message: 'warning message', data: { warning: true } },
    ]);
  });

  test('captures debug logs', () => {
    const logger = new TestLogger('TestPrefix');
    logger.debug('debug message', { debug: true });
    expect(logger.getLogs()).toEqual([
      { level: 'debug', message: 'debug message', data: { debug: true } },
    ]);
  });

  test('clears logs', () => {
    const logger = new TestLogger();
    logger.log('test message');
    logger.clear();
    expect(logger.getLogs()).toEqual([]);
  });

  test('prints logs to console', () => {
    const originalConsole = { ...console };
    const mockLog = jest.fn();
    console.log = mockLog;

    const logger = new TestLogger('Test');
    logger.log('test message');
    logger.print();

    expect(mockLog).toHaveBeenCalledTimes(1);
    const output = mockLog.mock.calls[0][0];
    expect(output).toContain('[LOG] [Test] test message');

    Object.assign(console, originalConsole);
  });

  test('prints message when no logs', () => {
    const originalConsole = { ...console };
    const mockLog = jest.fn();
    console.log = mockLog;

    const logger = new TestLogger();
    logger.clear();
    logger.print();

    // If there are no logs, print() will print an empty string
    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockLog.mock.calls[0][0]).toBe('');

    Object.assign(console, originalConsole);
  });

  test('shares logs between nested loggers', () => {
    const parent = new TestLogger('Parent');
    const child = parent.createNested('Child');

    parent.log('parent message');
    child.log('child message');

    expect(parent.getLogs()).toBe(child.getLogs());
    expect(parent.getLogs()).toEqual([
      { level: 'log', message: 'parent message', data: undefined },
      { level: 'log', message: 'child message', data: undefined },
    ]);
  });

  test('handles single message and data', () => {
    const logger = new TestLogger('Test');
    logger.log('message', { three: 3 });
    expect(logger.getLogs()[0]).toEqual({
      level: 'log',
      message: 'message',
      data: { three: 3 },
    });
  });

  test('captures info logs', () => {
    const logger = new TestLogger('InfoTest');
    logger.info('hello', { a: 1 });
    expect(logger.getLogs()).toEqual([
      { level: 'info', message: 'hello', data: { a: 1 } },
    ]);
  });
});

describe('NoLogger', () => {
  beforeEach(() => {
    // Reset the singleton instance before each test
    // @ts-expect-error - accessing private static field for testing
    NoLogger.instance = undefined;
  });

  it('returns singleton instance', () => {
    const logger1 = NoLogger.getInstance();
    const logger2 = NoLogger.getInstance('different prefix');
    expect(logger1).toBe(logger2);
  });

  it('exports singleton instance', () => {
    expect(noLogger).toEqual(NoLogger.getInstance());
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

  it('creates new instance when none exists', () => {
    // @ts-expect-error - accessing private static field for testing
    expect(NoLogger.instance).toBeUndefined();
    const logger = NoLogger.getInstance();
    // @ts-expect-error - accessing private static field for testing
    expect(NoLogger.instance).toBe(logger);
  });

  it('creates instance with empty prefix', () => {
    const logger = NoLogger.getInstance();
    expect(logger['prefix']).toBe('');
  });

  it('creates instance with non-empty prefix', () => {
    const logger = NoLogger.getInstance('test');
    expect(logger['prefix']).toBe('test');
  });

  it('creates instance with default prefix', () => {
    // @ts-expect-error - accessing private constructor for testing
    const logger = new NoLogger();
    expect(logger['prefix']).toBe('');
  });
});
