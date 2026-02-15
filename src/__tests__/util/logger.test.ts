import { ConsoleLogger, noLogger } from '../../util/logger';

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
