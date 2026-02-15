import { ConsoleLogger, TestLogger, noLogger } from '../../util/logger';

describe('ConsoleLogger', () => {
  let mockConsole: { [key: string]: jest.Mock };

  beforeEach(() => {
    mockConsole = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    };
  });

  test('logs without prefix', () => {
    const logger = new ConsoleLogger(undefined, mockConsole as any);
    logger.info('test message', { data: 123 });
    expect(mockConsole.info).toHaveBeenCalledWith('test message', { data: 123 });
  });

  test('logs with prefix', () => {
    const logger = new ConsoleLogger('TestPrefix', mockConsole as any);
    logger.info('test message', { data: 123 });
    expect(mockConsole.info).toHaveBeenCalledWith('[TestPrefix] test message', { data: 123 });
  });

  test('logs error with prefix', () => {
    const logger = new ConsoleLogger('TestPrefix', mockConsole as any);
    logger.error('error message', new Error('test error'));
    expect(mockConsole.error).toHaveBeenCalledWith(
      '[TestPrefix] error message',
      new Error('test error'),
    );
  });

  test('logs warning with prefix', () => {
    const logger = new ConsoleLogger('TestPrefix', mockConsole as any);
    logger.warn('warning message', { warning: true });
    expect(mockConsole.warn).toHaveBeenCalledWith('[TestPrefix] warning message', {
      warning: true,
    });
  });

  test('logs debug with prefix', () => {
    const logger = new ConsoleLogger('TestPrefix', mockConsole as any);
    logger.debug('debug message', { debug: true });
    expect(mockConsole.debug).toHaveBeenCalledWith('[TestPrefix] debug message', { debug: true });
  });

  test('creates nested logger with combined prefix', () => {
    const logger = new ConsoleLogger('Parent', mockConsole as any);
    const nested = logger.createNested('Child');
    nested.info('test message');
    expect(mockConsole.info).toHaveBeenCalledWith('[Parent:Child] test message');
  });

  test('creates deeply nested logger', () => {
    const logger = new ConsoleLogger('Root', mockConsole as any);
    const level1 = logger.createNested('Level1');
    const level2 = level1.createNested('Level2');
    level2.info('test message');
    expect(mockConsole.info).toHaveBeenCalledWith('[Root:Level1:Level2] test message');
  });
});

describe('TestLogger', () => {
  test('captures logs without prefix', () => {
    const logger = new TestLogger();
    logger.info('test message', { data: 123 });
    expect(logger.getLogs()).toEqual([
      { level: 'info', message: 'test message', data: { data: 123 } },
    ]);
  });

  test('captures logs with prefix', () => {
    const logger = new TestLogger('TestPrefix');
    logger.info('test message', { data: 123 });
    expect(logger.getLogs()).toEqual([
      { level: 'info', message: 'test message', data: { data: 123 } },
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
    logger.info('test message');
    logger.clear();
    expect(logger.getLogs()).toEqual([]);
  });

  test('prints logs to console', () => {
    const originalConsole = { ...console };
    const mockLog = jest.fn();
    console.log = mockLog;

    const logger = new TestLogger('Test');
    logger.info('test message');
    logger.print();

    expect(mockLog).toHaveBeenCalledTimes(1);
    const output = mockLog.mock.calls[0][0];
    expect(output).toContain('[INFO] [Test] test message');

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

    parent.info('parent message');
    child.info('child message');

    expect(parent.getLogs()).toBe(child.getLogs());
    expect(parent.getLogs()).toEqual([
      { level: 'info', message: 'parent message', data: undefined },
      { level: 'info', message: 'child message', data: undefined },
    ]);
  });

  test('handles single message and data', () => {
    const logger = new TestLogger('Test');
    logger.info('message', { three: 3 });
    expect(logger.getLogs()[0]).toEqual({
      level: 'info',
      message: 'message',
      data: { three: 3 },
    });
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

    noLogger.info('test');
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
