import { TimeoutResolver } from '../timeout-resolver';
import { DEFAULT_TIMEOUTS } from '../../constants/timeouts';
import { Step, Flow, TimeoutOptions } from '../../types';
import { StepType } from '../../step-executors/types';
import { defaultLogger } from '../../util/logger';

// Mock the TimeoutValidator dependency
jest.mock('../timeout-validator', () => {
  return {
    TimeoutValidator: {
      validateTimeoutOptions: jest.fn().mockImplementation((options, defaults) => {
        return { ...defaults, ...options };
      }),
      validateTimeout: jest.fn().mockImplementation((timeout, defaultTimeout) => {
        return timeout !== undefined ? timeout : defaultTimeout;
      }),
    },
  };
});

describe('TimeoutResolver', () => {
  // Create test fixtures
  const createMockStep = (name: string, timeout?: number): Step => ({
    name,
    timeout,
  });

  const createMockFlow = (timeouts?: TimeoutOptions): Flow => ({
    name: 'Test Flow',
    description: 'Test flow description',
    steps: [],
    timeouts,
  });

  let logger: any;
  let debugSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = {
      ...defaultLogger,
      createNested: jest.fn().mockReturnThis(),
      debug: jest.fn(),
    };
    debugSpy = jest.spyOn(logger, 'debug');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const flow = createMockFlow();
      const result = new TimeoutResolver(flow);
      expect(result).toBeDefined();
    });

    it('should validate flow and executor timeouts', () => {
      const flowTimeouts = { global: 5000 };
      const executorTimeouts = { request: 10000 };
      const flow = createMockFlow(flowTimeouts);

      new TimeoutResolver(flow, executorTimeouts, logger);

      expect(debugSpy).toHaveBeenCalledWith('Initialized TimeoutResolver', {
        flowTimeouts: { ...DEFAULT_TIMEOUTS, ...flowTimeouts },
        executorTimeouts: { ...DEFAULT_TIMEOUTS, ...executorTimeouts },
      });
    });
  });

  describe('getTimeoutKey', () => {
    it('should return the correct timeout key for each step type', () => {
      const flow = createMockFlow();
      const resolver = new TimeoutResolver(flow, undefined, logger);
      
      // Access the private method using type assertion and indexing
      const getTimeoutKey = (resolver as any)['getTimeoutKey'].bind(resolver);
      
      expect(getTimeoutKey(StepType.Request)).toBe('request');
      expect(getTimeoutKey(StepType.Transform)).toBe('transform');
      expect(getTimeoutKey(StepType.Condition)).toBe('condition');
      expect(getTimeoutKey(StepType.Loop)).toBe('loop');
      expect(getTimeoutKey('unknown' as StepType)).toBe('global');
    });
  });

  describe('resolveStepTimeout', () => {
    it('should use step-level timeout when available', () => {
      const flowTimeouts = { global: 5000, request: 10000 };
      const executorTimeouts = { request: 8000 };
      const flow = createMockFlow(flowTimeouts);
      const step = createMockStep('TestStep', 2000);

      const resolver = new TimeoutResolver(flow, executorTimeouts, logger);
      const timeout = resolver.resolveStepTimeout(step, StepType.Request);

      expect(timeout).toBe(2000);
      expect(debugSpy).toHaveBeenCalledWith('Using step-level timeout', {
        stepName: 'TestStep',
        timeout: 2000,
      });
    });

    it('should use flow-level type-specific timeout when step-level is not available', () => {
      const flowTimeouts = { global: 5000, request: 10000 };
      const executorTimeouts = { request: 8000 };
      const flow = createMockFlow(flowTimeouts);
      const step = createMockStep('TestStep');

      const resolver = new TimeoutResolver(flow, executorTimeouts, logger);
      const timeout = resolver.resolveStepTimeout(step, StepType.Request);

      expect(timeout).toBe(10000);
      expect(debugSpy).toHaveBeenCalledWith('Using flow-level type-specific timeout', {
        stepName: 'TestStep',
        timeout: 10000,
      });
    });

    it('should use flow-level global timeout when type-specific is not available', () => {
      const flowTimeouts = { global: 5000 };
      const executorTimeouts = { request: 8000 };
      const flow = createMockFlow(flowTimeouts);
      const step = createMockStep('TestStep');

      const resolver = new TimeoutResolver(flow, executorTimeouts, logger);
      const timeout = resolver.resolveStepTimeout(step, StepType.Transform);

      expect(timeout).toBe(5000);
      expect(debugSpy).toHaveBeenCalledWith('Using flow-level global timeout', {
        stepName: 'TestStep',
        timeout: 5000,
      });
    });

    it('should fall back to executor/default timeout when no other timeouts are available', () => {
      const flow = createMockFlow();
      const step = createMockStep('TestStep');

      const resolver = new TimeoutResolver(flow, undefined, logger);
      const timeout = resolver.resolveStepTimeout(step, StepType.Request);

      expect(timeout).toBe(DEFAULT_TIMEOUTS.request);
      expect(debugSpy).toHaveBeenCalledWith('Using default timeout', {
        stepName: 'TestStep',
        timeout: DEFAULT_TIMEOUTS.request,
      });
    });

    it('should handle unknown step types by using global timeout', () => {
      const flowTimeouts = { global: 5000 };
      const flow = createMockFlow(flowTimeouts);
      const step = createMockStep('TestStep');

      const resolver = new TimeoutResolver(flow, undefined, logger);
      // Use an unknown step type by casting
      const timeout = resolver.resolveStepTimeout(step, -1 as unknown as StepType);

      expect(timeout).toBe(5000);
    });
  });

  describe('resolveExpressionTimeout', () => {
    it('should use step-level timeout when available', () => {
      const flowTimeouts = { expression: 2000 };
      const flow = createMockFlow(flowTimeouts);
      const step = createMockStep('TestStep', 500);

      const resolver = new TimeoutResolver(flow, undefined, logger);
      const timeout = resolver.resolveExpressionTimeout(step);

      expect(timeout).toBe(500);
      expect(debugSpy).toHaveBeenCalledWith('Using step-level timeout for expression', {
        stepName: 'TestStep',
        timeout: 500,
      });
    });

    it('should use flow-level expression timeout when step-level is not available', () => {
      const flowTimeouts = { expression: 2000 };
      const flow = createMockFlow(flowTimeouts);

      const resolver = new TimeoutResolver(flow, undefined, logger);
      const timeout = resolver.resolveExpressionTimeout();

      expect(timeout).toBe(2000);
      expect(debugSpy).toHaveBeenCalledWith('Using flow-level expression timeout', {
        timeout: 2000,
      });
    });

    it('should use flow-level global timeout when expression timeout is not available', () => {
      const flowTimeouts = { global: 5000 };
      const flow = createMockFlow(flowTimeouts);

      const resolver = new TimeoutResolver(flow, undefined, logger);
      const timeout = resolver.resolveExpressionTimeout();

      expect(timeout).toBe(5000);
      expect(debugSpy).toHaveBeenCalledWith('Using flow-level global timeout for expression', {
        timeout: 5000,
      });
    });

    it('should handle special case for empty flow timeouts and executor timeouts', () => {
      // Create a completely empty flow
      const emptyFlow = createMockFlow(undefined); // No timeouts in flow
      
      // Force empty executorTimeouts by setting it to undefined and then erasing it from the instance
      const resolver = new TimeoutResolver(emptyFlow, undefined, logger);
      
      // Override the executorTimeouts property to force the special case
      Object.defineProperty(resolver, 'executorTimeouts', {
        value: undefined, // This will trigger the !this.executorTimeouts condition
        writable: true,
        configurable: true
      });
      
      // Now clear debug spy to focus only on the call we care about
      jest.clearAllMocks();
      
      const timeout = resolver.resolveExpressionTimeout();
      
      expect(timeout).toBe(DEFAULT_TIMEOUTS.expression);
      expect(logger.debug).toHaveBeenCalledWith('No executor-level expression timeout configured; Using default expression timeout', {
        timeout: DEFAULT_TIMEOUTS.expression,
      });
    });

    it('should use executor-level expression timeout when flow timeouts are not available', () => {
      const flow = createMockFlow();
      const executorTimeouts = { expression: 3000 };

      const resolver = new TimeoutResolver(flow, executorTimeouts, logger);
      const timeout = resolver.resolveExpressionTimeout();

      expect(timeout).toBe(3000);
      expect(debugSpy).toHaveBeenCalledWith('Using executor-level expression timeout', {
        timeout: 3000,
      });
    });

    it('should fall back to default expression timeout when no executor expression timeout is available', () => {
      const flow = createMockFlow();
      
      // Create a resolver with default executor timeouts
      const resolver = new TimeoutResolver(flow, undefined, logger);
      
      // Manually modify the executorTimeouts to remove the expression property completely
      // This will cause the this.executorTimeouts.expression check to be undefined
      const executorTimeoutsWithoutExpression = { ...DEFAULT_TIMEOUTS };
      delete executorTimeoutsWithoutExpression.expression;
      
      // Override the executorTimeouts property
      Object.defineProperty(resolver, 'executorTimeouts', {
        value: executorTimeoutsWithoutExpression,
        writable: true,
        configurable: true
      });
      
      // Now clear debug spy to focus only on the call we care about
      jest.clearAllMocks();
      
      const timeout = resolver.resolveExpressionTimeout();
      
      expect(timeout).toBe(DEFAULT_TIMEOUTS.expression);
      expect(logger.debug).toHaveBeenCalledWith('Using default expression timeout', {
        timeout: DEFAULT_TIMEOUTS.expression,
      });
    });
  });

  describe('getCurrentTimeouts', () => {
    it('should return combined timeouts with flow taking precedence', () => {
      const flowTimeouts = { global: 5000, request: 10000 };
      const executorTimeouts = { request: 8000, transform: 3000 };
      const flow = createMockFlow(flowTimeouts);

      const resolver = new TimeoutResolver(flow, executorTimeouts, logger);
      const timeouts = resolver.getCurrentTimeouts();

      // Flow timeouts should override executor timeouts
      expect(timeouts).toEqual({
        ...executorTimeouts,
        ...flowTimeouts,
      });
    });

    it('should handle special case for request property in flow timeouts', () => {
      const flowTimeouts = { request: 10000 };
      const flow = createMockFlow(flowTimeouts);
      
      const resolver = new TimeoutResolver(flow, undefined, logger);
      const timeouts = resolver.getCurrentTimeouts();
      
      expect(timeouts).toEqual({
        transform: 3000,
        global: 5000,
        request: 10000,
      });
    });

    it('should return the correct timeouts when flow timeouts is undefined', () => {
      // Create a flow with no timeouts
      const flow = createMockFlow();
      const executorTimeouts = { request: 8000, transform: 3000 };
      
      const resolver = new TimeoutResolver(flow, executorTimeouts, logger);
      const timeouts = resolver.getCurrentTimeouts();
      
      // We don't need to test the exact structure, just verify it includes our custom values
      expect(timeouts.request).toBe(8000);
      expect(timeouts.transform).toBe(3000);
    });

    it('should return the correct timeouts when flow timeouts does not have request property', () => {
      // Create a flow with timeouts that don't include 'request'
      const flowTimeouts = { global: 5000, transform: 4000 }; // No 'request' property
      const flow = createMockFlow(flowTimeouts);
      const executorTimeouts = { request: 8000 };
      
      const resolver = new TimeoutResolver(flow, executorTimeouts, logger);
      const timeouts = resolver.getCurrentTimeouts();
      
      // We don't need to test the exact structure, just verify it includes all values correctly
      expect(timeouts.global).toBe(5000);
      expect(timeouts.transform).toBe(4000);
      expect(timeouts.request).toBe(8000);
    });
  });
});
