import { ConsoleLogger, TestLogger, noLogger } from '../../util/logger';

describe('ConsoleLogger', () => {
  let originalConsole: typeof console;
  let mockConsole: { [key: string]: jest.Mock };

  beforeEach(() => {
    // Save original console
    originalConsole = { ...console };
    // Create mock console methods
    mockConsole = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
    // Replace console methods with mocks
    Object.assign(console, mockConsole);
  });

  afterEach(() => {
    // Restore original console
    Object.assign(console, originalConsole);
  });

  test('logs without prefix', () => {
    const logger = new ConsoleLogger();
    logger.log('test message', { data: 123 });
    expect(mockConsole.log).toHaveBeenCalledWith('test message', { data: 123 });
  });

  test('logs with prefix', () => {
    const logger = new ConsoleLogger('TestPrefix');
    logger.log('test message', { data: 123 });
    expect(mockConsole.log).toHaveBeenCalledWith('[TestPrefix] test message', { data: 123 });
  });

  test('logs error with prefix', () => {
    const logger = new ConsoleLogger('TestPrefix');
    logger.error('error message', new Error('test error'));
    expect(mockConsole.error).toHaveBeenCalledWith(
      '[TestPrefix] error message',
      new Error('test error'),
    );
  });

  test('logs warning with prefix', () => {
    const logger = new ConsoleLogger('TestPrefix');
    logger.warn('warning message', { warning: true });
    expect(mockConsole.warn).toHaveBeenCalledWith('[TestPrefix] warning message', {
      warning: true,
    });
  });

  test('logs debug with prefix', () => {
    const logger = new ConsoleLogger('TestPrefix');
    logger.debug('debug message', { debug: true });
    expect(mockConsole.debug).toHaveBeenCalledWith('[TestPrefix] debug message', { debug: true });
  });

  test('creates nested logger with combined prefix', () => {
    const logger = new ConsoleLogger('Parent');
    const nested = logger.createNested('Child');
    nested.log('test message');
    expect(mockConsole.log).toHaveBeenCalledWith('[Parent:Child] test message');
  });

  test('creates deeply nested logger', () => {
    const logger = new ConsoleLogger('Root');
    const level1 = logger.createNested('Level1');
    const level2 = level1.createNested('Level2');
    level2.log('test message');
    expect(mockConsole.log).toHaveBeenCalledWith('[Root:Level1:Level2] test message');
  });
});

describe('TestLogger', () => {
  test('captures logs without prefix', () => {
    const logger = new TestLogger();
    logger.log('test message', { data: 123 });
    expect(logger.getLogs()).toEqual(['[LOG] test message {"data":123}']);
  });

  test('captures logs with prefix', () => {
    const logger = new TestLogger('TestPrefix');
    logger.log('test message', { data: 123 });
    expect(logger.getLogs()).toEqual(['[LOG] [TestPrefix] test message {"data":123}']);
  });

  test('captures error logs', () => {
    const logger = new TestLogger('TestPrefix');
    const error = new Error('test error');
    logger.error('error message', error);
    expect(logger.getLogs()[0]).toContain('[ERROR] [TestPrefix] error message');
  });

  test('captures warning logs', () => {
    const logger = new TestLogger('TestPrefix');
    logger.warn('warning message', { warning: true });
    expect(logger.getLogs()).toEqual(['[WARN] [TestPrefix] warning message {"warning":true}']);
  });

  test('captures debug logs', () => {
    const logger = new TestLogger('TestPrefix');
    logger.debug('debug message', { debug: true });
    expect(logger.getLogs()).toEqual(['[DEBUG] [TestPrefix] debug message {"debug":true}']);
  });

  test('clears logs', () => {
    const logger = new TestLogger();
    logger.log('test message');
    logger.clear();
    expect(logger.getLogs()).toEqual([]);
  });

  test('gets logs as string', () => {
    const logger = new TestLogger('Test');
    logger.log('message 1');
    logger.log('message 2');
    expect(logger.getLogsAsString()).toBe('[LOG] [Test] message 1\n[LOG] [Test] message 2');
  });

  test('prints logs to console', () => {
    const originalConsole = { ...console };
    const mockLog = jest.fn();
    console.log = mockLog;

    const logger = new TestLogger('Test');
    logger.log('test message');
    logger.print();

    expect(mockLog).toHaveBeenCalledWith('\n=== Test Logs ===\n');
    expect(mockLog).toHaveBeenCalledWith('[LOG] [Test] test message');
    expect(mockLog).toHaveBeenCalledWith('\n================\n');

    Object.assign(console, originalConsole);
  });

  test('prints message when no logs', () => {
    const originalConsole = { ...console };
    const mockLog = jest.fn();
    console.log = mockLog;

    const logger = new TestLogger();
    logger.print();

    expect(mockLog).toHaveBeenCalledWith('No logs recorded');

    Object.assign(console, originalConsole);
  });

  test('shares logs between nested loggers', () => {
    const parent = new TestLogger('Parent');
    const child = parent.createNested('Child');

    parent.log('parent message');
    child.log('child message');

    expect(parent.getLogs()).toEqual([
      '[LOG] [Parent] parent message',
      '[LOG] [Parent:Child] child message',
    ]);
    expect(child.getLogs()).toBe(parent.getLogs());
  });

  test('handles multiple arguments', () => {
    const logger = new TestLogger('Test');
    logger.log('message', 1, 'two', { three: 3 });
    expect(logger.getLogs()[0]).toBe('[LOG] [Test] message [1,"two",{"three":3}]');
  });
});

describe('NoLogger', () => {
  test('silently ignores all log calls', () => {
    const originalConsole = { ...console };
    const mockLog = jest.fn();
    const mockError = jest.fn();
    const mockWarn = jest.fn();
    const mockDebug = jest.fn();
    Object.assign(console, { log: mockLog, error: mockError, warn: mockWarn, debug: mockDebug });

    noLogger.log('test');
    noLogger.error('test');
    noLogger.warn('test');
    noLogger.debug('test');

    expect(mockLog).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();
    expect(mockWarn).not.toHaveBeenCalled();
    expect(mockDebug).not.toHaveBeenCalled();

    Object.assign(console, originalConsole);
  });

  test('creates nested NoLogger', () => {
    const nested = noLogger.createNested('test');
    expect(nested).toBe(noLogger);
  });
});
