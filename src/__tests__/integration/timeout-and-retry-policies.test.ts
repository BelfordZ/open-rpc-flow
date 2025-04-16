import { FlowExecutor } from '../../flow-executor';
import { Flow, Step } from '../../types';
import { ErrorCode } from '../../errors/codes';
import { TimeoutError, FlowError } from '../../errors/base';
import { TestLogger } from '../../util/logger';
import { RequestStepExecutor } from '../../step-executors/request-executor';
import { StepExecutionContext } from '../../types';

const MOCK_DELAY = 100; // Use a small delay for faster tests

// At the top of the file where interfaces are defined
interface MockHandlerOptions {
  delay?: number | ((request: any) => number);
  shouldFail?: boolean;
  errorType?: string;
  failUntilAttempt?: number;
  currentAttempt?: { count: number };
  onAbort?: () => void;
  delayedExecution?: boolean;
}

// Helper function to create a mock JSON-RPC handler
function createMockHandler(options: MockHandlerOptions) {
  const {
    delay = 0,
    shouldFail = false,
    errorType = 'NETWORK_ERROR',
    failUntilAttempt = 1,
    currentAttempt = { count: 0 },
    onAbort = () => {},
    delayedExecution = false,
  } = options;

  return async (request: any, opts?: { signal?: AbortSignal }) => {
    currentAttempt.count++;

    // Setup abort handling if signal provided
    let aborted = false;
    const abortHandler = () => {
      aborted = true;
      onAbort();
    };

    if (opts?.signal) {
      // If already aborted, throw immediately
      if (opts.signal.aborted) {
        onAbort();
        throw new Error('Operation was aborted');
      }
      opts.signal.addEventListener('abort', abortHandler);
    }

    try {
      // Simulate network delay
      const delayTime = typeof delay === 'function' ? delay(request) : delay;
      
      if (delayTime > 0) {
        // Instead of a simple setTimeout, we need to check for abortion during the delay
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, delayTime);
          
          // Setup abort listener for the delay
          if (opts?.signal) {
            const checkAbort = () => {
              if (aborted || opts?.signal?.aborted) {
                clearTimeout(timeout);
                onAbort();
                reject(new Error('Operation aborted during delay'));
              }
            };
            // Poll for abort state
            const intervalId = setInterval(checkAbort, 10);
            // Clean up on completion
            setTimeout(() => {
              clearInterval(intervalId);
            }, delayTime + 10);
          }
        });
      }

      // If aborted after delay but before returning, throw
      const isAborted = aborted || (opts?.signal?.aborted ?? false);
      if (isAborted) {
        onAbort();
        throw new Error('Operation was aborted');
      }

      // Simulate failure based on configuration
      if (shouldFail && currentAttempt.count <= failUntilAttempt) {
        if (errorType === 'TIMEOUT') {
          throw new TimeoutError('Operation timed out', { step: request.method });
        } else if (errorType === 'NETWORK') {
          throw new FlowError('Network error', ErrorCode.NETWORK_ERROR, {});
        } else {
          throw new Error('Generic error');
        }
      }

      // Return successful response
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: `Result for ${request.method}`,
      };
    } finally {
      // Clean up abort listener
      if (opts?.signal) {
        opts.signal.removeEventListener('abort', abortHandler);
      }
    }
  };
}

describe('Timeout and Retry Policies', () => {
  let testLogger: TestLogger;

  beforeEach(() => {
    testLogger = new TestLogger('TestFlow');
    jest.useFakeTimers({ advanceTimers: true });
    // Print logs before each test for debugging
  });

  afterEach(() => {
    jest.useRealTimers();
    //testLogger.print(); // Print logs after each test for debugging
    testLogger.clear();
  });

  describe('Step-level timeout policies', () => {
    it('should respect step-level timeout configuration', async () => {
      // Create a short timeout for the step
      const shortTimeout = 50;
      
      // Create a flow with JSON-RPC compliant interface
      const flow: Flow = {
        name: 'step-timeout-test',
        description: 'Test step-level timeout',
        steps: [{
          name: 'slowOperation',
          timeout: shortTimeout,
          request: {
            method: 'slow',
            params: []
          }
        }]
      };

      // Create mock handler that takes longer than the timeout
      const mockHandler = createMockHandler({ delay: shortTimeout * 2 });
      
      // Create executor with the flow and handler
      const executor = new FlowExecutor(flow, mockHandler, testLogger);

      // Execute and expect timeout error
      try {
        // Fast-forward time to trigger timeout
        jest.advanceTimersByTime(shortTimeout);
        await executor.execute();
        throw new Error('Should have thrown TimeoutError');
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
        if (error instanceof Error) {
          expect(error.message).toContain('timed out');
        } else {
          expect(String(error)).toContain('timed out');
        }
      }
    });

    it('should allow a step to complete within its timeout', async () => {
      // Create a timeout longer than the operation needs
      const timeout = 500;
      
      // Create a flow with JSON-RPC compliant interface
      const flow: Flow = {
        name: 'step-timeout-success-test',
        description: 'Test successful completion within timeout',
        steps: [{
          name: 'quickOperation',
          timeout: timeout,
          request: {
            method: 'quick',
            params: []
          }
        }]
      };

      // Create mock handler that completes quickly
      const mockHandler = createMockHandler({ delay: MOCK_DELAY });
      
      // Create executor
      const executor = new FlowExecutor(flow, mockHandler, testLogger);

      // Execute and expect success
      const results = await executor.execute();
      expect(results).toBeDefined();
      expect(results.get('quickOperation').result.result).toBe('Result for quick');
    });
  });

  describe('Global timeout policies', () => {
    it('should respect global timeout configuration', async () => {
      // Set a global timeout
      const globalTimeout = 100;
      
      // Create flow with global timeout
      const flow: Flow = {
        name: 'global-timeout-test',
        description: 'Test global timeout',
        policies: {
          global: {
            timeout: {
              timeout: globalTimeout,
            },
          },
        },
        steps: [
          {
            name: 'step1',
            request: { method: 'step1', params: [] }
          },
          {
            name: 'step2',
            request: { method: 'step2', params: [] }
          }
        ]
      };

      // Create a mock handler that takes longer than the global timeout
      const mockHandler = createMockHandler({ delay: globalTimeout * 2 });
      
      // Create executor
      const executor = new FlowExecutor(flow, mockHandler, testLogger);

      // Execute and expect timeout error
      try {
        // Fast-forward time to trigger timeout
        jest.advanceTimersByTime(globalTimeout);
        await executor.execute();
        throw new Error('Should have thrown TimeoutError');
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
        if (error instanceof Error) {
          expect(error.message).toContain('timed out');
        } else {
          expect(String(error)).toContain('timed out');
        }
      }
    });

    it('should allow a flow with multiple steps to complete within global timeout', async () => {
      // Set a global timeout longer than needed
      const globalTimeout = 1000;
      const flow: Flow = {
        name: 'global-timeout-success-test',
        description: 'Test successful completion within global timeout',
        policies: {
          global: {
            timeout: {
              timeout: globalTimeout,
            },
          },
        },
        steps: [
          {
            name: 'step1',
            request: { method: 'step1', params: [] }
          },
          {
            name: 'step2',
            request: { method: 'step2', params: [] }
          }
        ]
      };

      // Create a mock handler that completes quickly
      const mockHandler = createMockHandler({ delay: MOCK_DELAY });
      const executor = new FlowExecutor(flow, mockHandler, testLogger);

      // Execute and expect success
      const results = await executor.execute();
      expect(results).toBeDefined();
      // We can't directly access executionTime, but we can check that all steps completed
      expect(results.get('step1')).toBeDefined();
      expect(results.get('step2')).toBeDefined();
    });
  });

  describe('Step-level retry policies', () => {
    it('should retry a step based on its retry policy', async () => {
      // Track retry attempts
      const attempts = { count: 0 };

      // Create a flow with retry policy
      const flow: Flow = {
        name: 'step-retry-test',
        description: 'Test step-level retry policy',
        steps: [{
          name: 'retryableStep',
          request: { 
            method: 'flaky', 
            params: [] 
          },
          timeout: 1000, // Longer timeout to allow for retries
        }]
      };

      // Create a handler that fails for the first 2 attempts
      const mockHandler = createMockHandler({
        shouldFail: true,
        errorType: 'NETWORK',
        failUntilAttempt: 2,
        currentAttempt: attempts,
      });

      const executor = new FlowExecutor(flow, mockHandler, {
        logger: testLogger,
        enableRetries: true,
        retryPolicy: {
          maxAttempts: 3,
          backoff: {
            initial: MOCK_DELAY,
            multiplier: 2,
            maxDelay: 1000,
          },
          retryableErrors: [ErrorCode.NETWORK_ERROR],
        }
      });

      // Execute and expect success after retries
      const results = await executor.execute();
      expect(results).toBeDefined();
      expect(attempts.count).toBe(3); // Initial + 2 retries
    });

    it('should fail after max attempts are reached', async () => {
      // Track retry attempts
      const attempts = { count: 0 };

      // Create a step with retry policy
      const flow: Flow = {
        name: 'step-retry-failure-test',
        description: 'Test step-level retry failure',
        steps: [
          {
            name: 'retryableStep',
            request: { 
              method: 'alwaysFails', 
              params: [] 
            }
          }
        ]
      };

      // Create a handler that always fails
      const mockHandler = createMockHandler({
        shouldFail: true,
        errorType: 'NETWORK',
        failUntilAttempt: 999, // Always fail
        currentAttempt: attempts,
      });

      const executor = new FlowExecutor(flow, mockHandler, {
        logger: testLogger,
        enableRetries: true,
        retryPolicy: {
          maxAttempts: 3,
          backoff: {
            initial: MOCK_DELAY,
            multiplier: 2,
            maxDelay: 1000,
          },
          retryableErrors: [ErrorCode.NETWORK_ERROR],
        }
      });

      // Execute and expect failure after max retries
      try {
        await executor.execute();
        throw new Error('Should have thrown an error');
      } catch (error) {
        expect(error).toBeDefined();
        expect(attempts.count).toBe(3); // Initial + 2 retries
      }
    });
  });

  describe('Global retry policies', () => {
    it('should apply global retry policy to all steps', async () => {
      // Track retry attempts per step
      const attempts: Record<string, number> = {};

      // Create a flow with global retry policy
      const flow: Flow = {
        name: 'global-retry-test',
        description: 'Test global retry policy',
        timeouts: {
          global: 1000, // Long global timeout
        },
        steps: [
          {
            name: 'step1',
            request: { method: 'flaky1', params: [] }
          },
          {
            name: 'step2',
            request: { method: 'flaky2', params: [] }
          }
        ]
      };

      // Create a handler that fails for the first attempt of each step
      const mockHandler = async (request: any) => {
        const stepName = request.method;
        attempts[stepName] = (attempts[stepName] || 0) + 1;
        if (attempts[stepName] === 1) {
          throw new (require('../../errors/base').FlowError)('Network error', require('../../errors/codes').ErrorCode.NETWORK_ERROR, {});
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: `Result for ${request.method}`,
        };
      };

      const executor = new FlowExecutor(flow, mockHandler, {
        logger: testLogger,
        enableRetries: true,
        retryPolicy: {
          maxAttempts: 3,
          backoff: {
            initial: MOCK_DELAY,
            multiplier: 2,
            maxDelay: 1000,
          },
          retryableErrors: [ErrorCode.NETWORK_ERROR],
        }
      });

      // Execute and expect success after retries
      const results = await executor.execute();
      expect(results).toBeDefined();
      expect(attempts['flaky1']).toBe(2);
      expect(attempts['flaky2']).toBe(2);
      // Total attempts should be 4
      expect(attempts['flaky1'] + attempts['flaky2']).toBe(4);
    });
  });

  describe('Backoff strategies', () => {
    it('should use exponential backoff strategy correctly', async () => {
      // Track retry attempts and timing
      const attempts = { count: 0 };
      const retryTimes: number[] = [];
      const startTime = Date.now();

      // Function to record retry times
      const recordRetryTime = () => {
        retryTimes.push(Date.now() - startTime);
      };

      // Create a step with exponential backoff
      const flow: Flow = {
        name: 'exponential-backoff-test',
        description: 'Test exponential backoff',
        steps: [
          {
            name: 'exponentialRetry',
            request: { 
              method: 'flaky', 
              params: [] 
            }
          }
        ]
      };

      // Create a handler that fails for 2 attempts and records timing
      const mockHandler = async (request: any) => {
        attempts.count++;
        recordRetryTime();
        
        if (attempts.count <= 2) {
          throw new FlowError('Network error', ErrorCode.NETWORK_ERROR, {});
        }
        
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: `Result for ${request.method}`,
        };
      };

      const executor = new FlowExecutor(flow, mockHandler, {
        logger: testLogger,
        enableRetries: true,
        retryPolicy: {
          maxAttempts: 3,
          backoff: {
            initial: MOCK_DELAY,
            multiplier: 2,
            maxDelay: 1000,
          },
          retryableErrors: [ErrorCode.NETWORK_ERROR],
        }
      });

      // Execute and verify exponential backoff timing
      await executor.execute();
      
      // First retry should be around initial delay (MOCK_DELAY)
      // Second retry should be around initial * multiplier^1 (MOCK_DELAY * 2)
      expect(attempts.count).toBe(3);
      expect(retryTimes[1] - retryTimes[0]).toBeGreaterThanOrEqual(MOCK_DELAY);
      expect(retryTimes[2] - retryTimes[1]).toBeGreaterThanOrEqual(MOCK_DELAY * 2);
    });

    it('should use linear backoff strategy correctly', async () => {
      // Track retry attempts and timing
      const attempts = { count: 0 };
      const retryTimes: number[] = [];
      const startTime = Date.now();

      // Function to record retry times
      const recordRetryTime = () => {
        retryTimes.push(Date.now() - startTime);
      };

      // Create a step with linear backoff
      const flow: Flow = {
        name: 'linear-backoff-test',
        description: 'Test linear backoff',
        steps: [
          {
            name: 'linearRetry',
            request: { 
              method: 'flaky', 
              params: [] 
            }
          }
        ]
      };

      // Create a handler that fails for 2 attempts and records timing
      const mockHandler = async (request: any) => {
        attempts.count++;
        recordRetryTime();
        
        if (attempts.count <= 2) {
          throw new FlowError('Network error', ErrorCode.NETWORK_ERROR, {});
        }
        
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: `Result for ${request.method}`,
        };
      };

      const executor = new FlowExecutor(flow, mockHandler, {
        logger: testLogger,
        enableRetries: true,
        retryPolicy: {
          maxAttempts: 3,
          backoff: {
            initial: MOCK_DELAY,
            multiplier: 1,
            maxDelay: 1000,
          },
          retryableErrors: [ErrorCode.NETWORK_ERROR],
        }
      });

      // Execute and verify linear backoff timing
      await executor.execute();
      
      // With linear backoff, retries should be at consistent intervals
      expect(attempts.count).toBe(3);
      const firstInterval = retryTimes[1] - retryTimes[0];
      const secondInterval = retryTimes[2] - retryTimes[1];
      
      // The intervals should be approximately the same with linear backoff
      expect(Math.abs(secondInterval - firstInterval)).toBeLessThan(MOCK_DELAY / 2);
    });
  });

  describe('Retry with timeout errors', () => {
    it('should retry when timeout errors are specified as retryable', async () => {
      // Track retry attempts
      const attempts = { count: 0 };

      // Create a step with retry policy for timeout errors
      const flow: Flow = {
        name: 'timeout-retry-test',
        description: 'Test timeout retry policy',
        steps: [
          {
            name: 'timeoutRetry',
            request: { 
              method: 'slow', 
              params: [] 
            },
            timeout: 50 // Very short timeout
          }
        ]
      };

      // Create a handler that times out for the first attempt, then speeds up
      const mockHandler = async (request: any, opts?: { signal?: AbortSignal }) => {
        attempts.count++;
        testLogger.debug(`[mockHandler] Attempt: ${attempts.count}`);
        if (attempts.count === 1) {
          // Throw a TimeoutError with the correct error code
          throw new TimeoutError('Operation timed out', { code: ErrorCode.TIMEOUT_ERROR, step: request.method });
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: `Result for ${request.method}`,
        };
      };

      const executor = new FlowExecutor(flow, mockHandler, {
        logger: testLogger,
        enableRetries: true,
        retryPolicy: {
          maxAttempts: 3,
          backoff: {
            initial: MOCK_DELAY,
            multiplier: 2,
            maxDelay: 1000,
          },
          retryableErrors: [ErrorCode.TIMEOUT_ERROR],
        }
      });

      // Execute and expect success after timeout retry
      const results = await executor.execute();
      expect(results).toBeDefined();
      expect(attempts.count).toBeGreaterThan(1);
    });
  });

  describe('Combined policies', () => {
    it('should handle step timeout and retry together', async () => {
      // Track retry attempts
      const attempts = { count: 0 };

      // Create a step with both timeout and retry policies
      const flow: Flow = {
        name: 'combined-policies-test',
        description: 'Test combined step timeout and retry',
        steps: [
          {
            name: 'combinedPolicies',
            request: { 
              method: 'flakyAndSlow', 
              params: [] 
            },
            timeout: 50 // Short timeout
          }
        ]
      };

      // Create a handler that fails with different errors
      const mockHandler = async (request: any) => {
        attempts.count++;
        
        if (attempts.count === 1) {
          // First attempt: timeout
          await new Promise(resolve => setTimeout(resolve, 100)); // Longer than timeout
          return { jsonrpc: '2.0', id: request.id, result: 'Should not reach here' };
        } else if (attempts.count === 2) {
          // Second attempt: network error
          throw new FlowError('Network error', ErrorCode.NETWORK_ERROR, {});
        } else {
          // Third attempt: success
          return { jsonrpc: '2.0', id: request.id, result: 'Success after retries' };
        }
      };

      const executor = new FlowExecutor(flow, mockHandler, {
        logger: testLogger,
        enableRetries: true,
        retryPolicy: {
          maxAttempts: 3,
          backoff: {
            initial: MOCK_DELAY,
            multiplier: 2,
            maxDelay: 1000,
          },
          retryableErrors: [ErrorCode.TIMEOUT_ERROR, ErrorCode.NETWORK_ERROR],
        }
      });

      // Execute and check handling of different errors
      const results = await executor.execute();
      expect(results).toBeDefined();
      expect(attempts.count).toBe(3);
    });

    it('should prioritize step-level policies over global ones', async () => {
      // Track retry attempts
      const attempts = { count: 0 };

      // Create a flow with conflicting global and step-level policies
      const flow: Flow = {
        name: 'policy-priority-test',
        description: 'Test policy priority',
        timeouts: {
          global: 1000, // Long global timeout
        },
        steps: [
          {
            name: 'priorityStep',
            request: { 
              method: 'slow', 
              params: [] 
            },
            timeout: 50 // Short step timeout that should override global
          }
        ]
      };

      // Create a handler that times out
      const mockHandler = createMockHandler({
        delay: 100, // Longer than step timeout
        currentAttempt: attempts,
      });

      const executor = new FlowExecutor(flow, mockHandler, {
        logger: testLogger,
        enableRetries: true,
        retryPolicy: {
          maxAttempts: 3,
          backoff: {
            initial: MOCK_DELAY,
            multiplier: 2,
            maxDelay: 1000,
          },
          retryableErrors: [ErrorCode.TIMEOUT_ERROR],
        }
      });

      // Execute and check that step-level policies are used
      try {
        await executor.execute();
        throw new Error('Should have thrown TimeoutError');
      } catch (error) {
        expect(error).toBeDefined();
        expect(attempts.count).toBe(3); // Should use retry policy (3 attempts)
      }
    });
  });

  describe('AbortController integration', () => {
    it('should abort in-progress operations when timeout occurs', async () => {
      // Track if the abort handler was called
      let abortHandlerCalled = false;
      const abortHandler = () => {
        abortHandlerCalled = true;
      };

      // Create a flow with a step that has a short timeout
      const shortTimeout = 50;
      const flow: Flow = {
        name: 'abort-timeout-test',
        description: 'Test operation abortion on timeout',
        steps: [
          {
            name: 'abortableOperation',
            request: { 
              method: 'slow', 
              params: [] 
            },
            timeout: shortTimeout
          }
        ]
      };

      // Create a mock handler that takes longer than the timeout but also monitors for aborts
      const mockHandler = createMockHandler({ 
        delay: 500,  // Much longer than timeout
        onAbort: abortHandler
      });

      const executor = new FlowExecutor(flow, mockHandler, testLogger);

      // Execute and expect timeout error
      try {
        // Fast-forward time to trigger timeout
        jest.advanceTimersByTime(shortTimeout);
        await executor.execute();
        throw new Error('Should have thrown TimeoutError');
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError);
        // Verify abort handler was called
        expect(abortHandlerCalled).toBe(true);
      }
    });

    it('should allow cancellation of a flow execution from outside', async () => {
      // Create an external AbortController to cancel the flow
      const externalController = new AbortController();
      
      // Create a flow with a long-running operation
      const flow: Flow = {
        name: 'external-abort-test',
        description: 'Test external abortion of flow',
        steps: [
          {
            name: 'longOperation',
            request: { 
              method: 'long', 
              params: [] 
            }
          }
        ]
      };

      // Track if the operation was aborted
      let operationAborted = false;
      
      // Create handler that responds to external abort
      const mockHandler = async (request: any, opts?: { signal?: AbortSignal }) => {
        if (opts?.signal) {
          opts.signal.addEventListener('abort', () => {
            operationAborted = true;
            testLogger.debug('Operation aborted by external controller');
          });
        }

        // Simulate long operation with abort checking
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, 1000);
          
          // Check for abort
          if (opts?.signal) {
            const checkInterval = setInterval(() => {
              if (opts?.signal?.aborted) {
                clearTimeout(timeout);
                clearInterval(checkInterval);
                reject(new Error('Operation aborted by external controller'));
              }
            }, 10);

            // Ensure interval is cleared if promise resolves
            setTimeout(() => clearInterval(checkInterval), 1000);
          }
        });
        
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: 'Long operation completed',
        };
      };

      // The FlowExecutor constructor takes flow, handler, and options
      // We need to pass the external signal to the executor
      const executor = new FlowExecutor(flow, mockHandler, testLogger);

      // Start execution, then abort it externally
      const promise = executor.execute({ signal: externalController.signal });
      
      // Trigger external abort
      setTimeout(() => {
        externalController.abort();
      }, 50);
      
      // Advance timer to trigger the external abort
      jest.advanceTimersByTime(60);

      // Execution should be aborted
      try {
        await promise;
        throw new Error('Should have been aborted');
      } catch (error) {
        expect(String(error)).toContain('aborted');
        expect(operationAborted).toBe(true);
      }
    });

    it('should abort a request if the promise is aborted', async () => {
      const flow: Flow = {
        name: 'abort-test',
        description: 'Test abort behavior',
        steps: [{
          name: 'abortableStep',
          request: { method: 'test.method', params: {} }
        }]
      };

      // Create a promise and controller that we can use to test abort
      const abortController = new AbortController();
      
      // Abort after a short delay to simulate a timeout
      setTimeout(() => {
        abortController.abort();
        testLogger.debug('[test] AbortController aborted');
      }, 10);

      // Create a mock handler with debug logging and a delay
      const mockHandler = createMockHandler({
        onAbort: () => testLogger.debug('[mockHandler] onAbort called'),
        delay: 100
      });
      
      // Create a request executor and use it directly
      const executor = new RequestStepExecutor(mockHandler, testLogger);
      const context = {
        referenceResolver: {
          resolveReferences: (value: any) => value
        },
        signal: abortController.signal,
        flow,
        stepResults: new Map()
      } as unknown as StepExecutionContext;
      
      try {
        await executor.execute(flow.steps[0], context);
        throw new Error('Should have thrown an error');
      } catch (error) {
        testLogger.debug(`[test] Caught error: ${String(error)}`);
        expect(String(error)).toContain('aborted');
      }
    });
  });

  describe('Step-level timeout with abort', () => {
    it('should abort the promise when a step timeout is reached', async () => {
      const flow: Flow = {
        name: 'abort-test',
        description: 'Test step-level timeout with abort',
        steps: [{
          name: 'abortStep',
          policies: {
            timeout: {
              timeout: 50
            }
          },
          request: { 
            method: 'test.delay', 
            params: { delayMs: 1000 } 
          }
        }]
      };

      // Create a mock handler that will create a long-running promise
      // that should be aborted by the timeout
      const mockHandler = createMockHandler({ delay: 100 });
      const executor = new FlowExecutor(flow, mockHandler, { logger: testLogger });

      try {
        await executor.execute();
        throw new Error('Should have thrown an error');
      } catch (error) {
        expect(String(error)).toContain('timed out');
      }
    });
  });

  describe('Global timeout cancellation', () => {
    it('should timeout on a global timeout and cancel remaining steps', async () => {
      const flow: Flow = {
        name: 'global-timeout-test',
        description: 'Test global timeout cancellation',
        policies: {
          global: {
            timeout: {
              timeout: 100 // Short timeout
            }
          }
        },
        steps: [
          {
            name: 'step1',
            request: { method: 'test.delay', params: { delayMs: 50 } }
          },
          {
            name: 'step2',
            request: { method: 'test.delay', params: { delayMs: 200 } }
          }
        ]
      };

      const mockHandler = createMockHandler({ delay: 150 });
      const executor = new FlowExecutor(flow, mockHandler, { logger: testLogger });
      const controller = new AbortController();

      // Pass the signal to executor.execute
      try {
        await executor.execute({ signal: controller.signal });
        throw new Error('Should have thrown an error');
      } catch (error) {
        expect(String(error)).toContain('timed out');
      }
    });
  });
}); 