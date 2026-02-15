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

  test('logs error with prefix', () => {
    const logger = new ConsoleLogger('TestPrefix', mockConsole as any);
    logger.error('error message', new Error('test error'));
    expect(mockConsole.error).toHaveBeenCalledWith(
      '[TestPrefix] error message',
      new Error('test error'),
    );
  });

  test('forwards metadata for warning logs', () => {
    const logger = new ConsoleLogger('TestPrefix', mockConsole as any);
    logger.warn('warning message', { warning: true });
    expect(mockConsole.warn).toHaveBeenCalledWith('[TestPrefix] warning message', {
      warning: true,
    });
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
  test('creates nested NoLogger', () => {
    const nested = noLogger.createNested('test');
    expect(nested).toBe(noLogger);
  });
});
