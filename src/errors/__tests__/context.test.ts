import { ContextCollector } from '../context';
import { ErrorCode } from '../codes';
import { Logger } from '../../util/logger';

describe('ContextCollector', () => {
  let collector: ContextCollector;
  let mockLogger: jest.Mocked<Logger>;

  beforeEach(() => {
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any;

    collector = new ContextCollector(mockLogger);
  });

  describe('constructor', () => {
    it('should initialize with correct default values', () => {
      expect(collector['startTime']).toBeInstanceOf(Date);
      expect(collector['attempts']).toBe(0);
      expect(collector.getContext()).toEqual({});
    });
  });

  describe('collect', () => {
    it('should collect system metrics', async () => {
      const context = await collector.collect();
      
      expect(context.system).toBeDefined();
      expect(typeof context.system.memory).toBe('number');
      expect(typeof context.system.cpu).toBe('number');
      expect(typeof context.system.env).toBe('string');
    });

    it('should handle missing NODE_ENV', async () => {
      const originalEnv = process.env.NODE_ENV;
      delete process.env.NODE_ENV;
      
      const context = await collector.collect();
      expect(context.system.env).toBe('unknown');
      
      process.env.NODE_ENV = originalEnv;
    });

    it('should include execution timing', async () => {
      const context = await collector.collect();
      
      expect(context.execution).toBeDefined();
      expect(context.execution.startTime).toBeInstanceOf(Date);
      expect(typeof context.execution.duration).toBe('number');
      expect(context.execution.attempts).toBe(0);
    });

    it('should include step context', async () => {
      const context = await collector.collect();
      
      expect(context.step).toBeDefined();
      expect(context.step.name).toBe('unknown');
      expect(context.step.type).toBe('unknown');
      expect(context.step.params).toEqual({});
    });
  });

  describe('recordAttempt', () => {
    it('should increment attempts counter', () => {
      collector.recordAttempt();
      expect(collector['attempts']).toBe(1);
      
      collector.recordAttempt();
      expect(collector['attempts']).toBe(2);
    });
  });

  describe('context management', () => {
    it('should add context entries', () => {
      collector.addContext('testKey', 'testValue');
      expect(collector.getContext()).toEqual({ testKey: 'testValue' });
      expect(mockLogger.debug).toHaveBeenCalledWith('Added context', { key: 'testKey', value: 'testValue' });
    });

    it('should get context as a copy', () => {
      collector.addContext('testKey', 'testValue');
      const context = collector.getContext();
      context.testKey = 'modified';
      expect(collector.getContext()).toEqual({ testKey: 'testValue' });
    });

    it('should clear context', () => {
      collector.addContext('testKey', 'testValue');
      collector.clearContext();
      expect(collector.getContext()).toEqual({});
      expect(mockLogger.debug).toHaveBeenCalledWith('Cleared context');
    });

    it('should handle multiple context entries', () => {
      collector.addContext('key1', 'value1');
      collector.addContext('key2', 'value2');
      expect(collector.getContext()).toEqual({
        key1: 'value1',
        key2: 'value2'
      });
    });
  });

  describe('createError', () => {
    it('should create error with context', () => {
      collector.addContext('testKey', 'testValue');
      const error = collector.createError('test error', ErrorCode.INTERNAL_ERROR);
      
      expect(error.message).toBe('test error');
      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.context).toEqual({ testKey: 'testValue' });
    });

    it('should create error with empty context', () => {
      const error = collector.createError('test error', ErrorCode.INTERNAL_ERROR);
      expect(error.context).toEqual({});
    });
  });
}); 