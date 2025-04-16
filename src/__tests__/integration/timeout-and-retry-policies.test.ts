import { FlowExecutor } from '../../flow-executor';
import { Flow } from '../../types';
import { ErrorCode as ImportedErrorCode } from '../../errors/codes';
import { TimeoutError } from '../../errors/timeout-error';
import { FlowError, ExecutionError } from '../../errors/base';
import { TestLogger } from '../../util/logger';
import { StepType } from '../../step-executors/types';

const MOCK_DELAY = 100; // Use a small delay for faster tests

// At the top of the file where interfaces are defined
interface MockHandlerOptions {
  delay?: number | ((request: any) => number);
  shouldFail?: boolean;
  errorType?: string;
  failUntilAttempt?: number;
  currentAttempt?: { count: number };
  onAbort?: () => void;
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
          throw TimeoutError.forStep({ name: request.method } as any, StepType.Request, 50, 100);
        } else if (errorType === 'NETWORK') {
          throw new FlowError('Network error', ImportedErrorCode.NETWORK_ERROR, {});
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

// Enhanced helper to DRY up error assertions for various error types
interface ExpectErrorOptions {
  errorClass?: any; // e.g., TimeoutError, ExecutionError, Error
  messageIncludes?: string | RegExp;
}

async function expectError(promise: Promise<any>, options: ExpectErrorOptions = {}) {
  const { errorClass = TimeoutError, messageIncludes = 'timed out' } = options;
  try {
    await promise;
    throw new Error(`Should have thrown ${errorClass?.name || 'an error'}`);
  } catch (error) {
    if (errorClass) {
      console.log(error);
      expect(error).toBeInstanceOf(errorClass);
    }
    if (messageIncludes) {
      if (typeof messageIncludes === 'string') {
        expect(String(error)).toContain(messageIncludes);
      } else {
        expect(String(error)).toMatch(messageIncludes);
      }
    }
  }
}

describe('Timeout and Retry Policies', () => {
  let testLogger: TestLogger;

  beforeEach(() => {
    testLogger = new TestLogger('TimeoutAndRetryPolicies');
    jest.useFakeTimers({ advanceTimers: true });
  });

  afterEach(() => {
    jest.useRealTimers();
    //testLogger.print(); // Print logs after each test for debugging
    testLogger.clear();
  });

  describe('timeout policies', () => {
    describe('Step-level timeout policies', () => {
      it('should respect step-level timeout configuration', async () => {
        // Create a short timeout for the step
        const shortTimeout = 50;

        // Create a flow with JSON-RPC compliant interface
        const flow: Flow = {
          name: 'step-timeout-test',
          description: 'Test step-level timeout',
          steps: [
            {
              name: 'slowOperation',
              policies: { timeout: { timeout: shortTimeout } },
              request: {
                method: 'slow',
                params: [],
              },
            },
          ],
        };

        // Create mock handler that takes longer than the timeout
        const mockHandler = createMockHandler({ delay: shortTimeout * 2 });

        // Create executor with the flow and handler
        const executor = new FlowExecutor(flow, mockHandler, testLogger);

        // Execute and expect timeout error
        jest.advanceTimersByTime(shortTimeout);
        await expectError(executor.execute(), {
          errorClass: ExecutionError,
          messageIncludes: 'timed out',
        });
      });

      it('should allow a step to complete within its timeout', async () => {
        // Create a timeout longer than the operation needs
        const timeout = 500;

        // Create a flow with JSON-RPC compliant interface
        const flow: Flow = {
          name: 'step-timeout-success-test',
          description: 'Test successful completion within timeout',
          steps: [
            {
              name: 'quickOperation',
              policies: { timeout: { timeout } },
              request: {
                method: 'quick',
                params: [],
              },
            },
          ],
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
              request: { method: 'step1', params: [] },
            },
            {
              name: 'step2',
              request: { method: 'step2', params: [] },
            },
          ],
        };

        // Create a mock handler that takes longer than the global timeout
        const mockHandler = createMockHandler({ delay: globalTimeout * 2 });

        // Create executor
        const executor = new FlowExecutor(flow, mockHandler, testLogger);

        // Execute and expect timeout error
        jest.advanceTimersByTime(globalTimeout);
        await expectError(executor.execute(), {
          errorClass: ExecutionError,
          messageIncludes: 'timed out',
        });
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
              request: { method: 'step1', params: [] },
            },
            {
              name: 'step2',
              request: { method: 'step2', params: [] },
            },
          ],
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
  });

  describe('retry policies', () => {
    describe('Step-level retry policies', () => {
      it('should retry a step based on its retry policy', async () => {
        // Track retry attempts
        const attempts = { count: 0 };

        // Create a flow with retry policy
        const flow: Flow = {
          name: 'step-retry-test',
          description: 'Test step-level retry policy',
          steps: [
            {
              name: 'retryableStep',
              request: {
                method: 'flaky',
                params: [],
              },
              policies: { retryPolicy: { maxAttempts: 3 } }, // Longer timeout to allow for retries
            },
          ],
        };

        // Create a handler that fails for the first 2 attempts
        const mockHandler = createMockHandler({
          shouldFail: true,
          errorType: 'NETWORK',
          failUntilAttempt: 2,
          currentAttempt: attempts,
        });

        const executor = new FlowExecutor(flow, mockHandler, testLogger);

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
                params: [],
              },
              policies: { retryPolicy: { maxAttempts: 3 } },
            },
          ],
        };

        // Create a handler that always fails
        const mockHandler = createMockHandler({
          shouldFail: true,
          errorType: 'NETWORK',
          failUntilAttempt: 999, // Always fail
          currentAttempt: attempts,
        });

        const executor = new FlowExecutor(flow, mockHandler, testLogger);

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
          policies: {
            global: {
              timeout: {
                timeout: 1000, // Long global timeout
              },
              retryPolicy: {
                maxAttempts: 3,
              },
            },
          },
          steps: [
            {
              name: 'step1',
              request: { method: 'flaky1', params: [] },
            },
            {
              name: 'step2',
              request: { method: 'flaky2', params: [] },
            },
          ],
        };

        // Create a handler that fails for the first attempt of each step
        const mockHandler = async (request: any) => {
          const stepName = request.method;
          attempts[stepName] = (attempts[stepName] || 0) + 1;
          if (attempts[stepName] === 1) {
            throw new FlowError('Network error', ImportedErrorCode.NETWORK_ERROR, {});
          }
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: `Result for ${request.method}`,
          };
        };

        const executor = new FlowExecutor(flow, mockHandler, testLogger);

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

        const INITIAL_BACKOFF = 200;
        const MULTIPLIER = 2;
        // Create a step with exponential backoff
        const flow: Flow = {
          name: 'exponential-backoff-test',
          description: 'Test exponential backoff',
          policies: {
            global: {
              retryPolicy: {
                maxAttempts: 4,
                backoff: {
                  initial: INITIAL_BACKOFF,
                  strategy: 'exponential',
                },
              },
            },
          },
          steps: [
            {
              name: 'exponentialRetry',
              request: {
                method: 'flaky',
                params: [],
              },
            },
          ],
        };

        // Create a handler that fails for 2 attempts and records timing
        const mockHandler = async (request: any) => {
          attempts.count++;
          recordRetryTime();

          if (attempts.count <= 3) {
            throw new FlowError('Network error', ImportedErrorCode.NETWORK_ERROR, {});
          }

          return {
            jsonrpc: '2.0',
            id: request.id,
            result: `Result for ${request.method}`,
          };
        };

        const executor = new FlowExecutor(flow, mockHandler, testLogger);

        // Execute and verify exponential backoff timing
        await executor.execute();

        // First retry should be around initial delay (INITIAL_BACKOFF)
        // Second retry should be around initial * multiplier^1 (INITIAL_BACKOFF * 2)
        // Third retry should be around initial * multiplier^2 (INITIAL_BACKOFF * 4)
        expect(attempts.count).toBe(4);
        const firstInterval = retryTimes[1] - retryTimes[0];
        const secondInterval = retryTimes[2] - retryTimes[1];
        const thirdInterval = retryTimes[3] - retryTimes[2];
        // The first retry is attempt=2, so exponent is 1, etc.
        const expectedFirst = INITIAL_BACKOFF * Math.pow(MULTIPLIER, 1); // 400
        const expectedSecond = INITIAL_BACKOFF * Math.pow(MULTIPLIER, 2); // 800
        const expectedThird = INITIAL_BACKOFF * Math.pow(MULTIPLIER, 3); // 1600
        // Allow ±50% jitter
        expect(firstInterval).toBeGreaterThanOrEqual(expectedFirst * 0.5);
        expect(firstInterval).toBeLessThanOrEqual(expectedFirst * 1.5);
        expect(secondInterval).toBeGreaterThanOrEqual(expectedSecond * 0.5);
        expect(secondInterval).toBeLessThanOrEqual(expectedSecond * 1.5);
        expect(thirdInterval).toBeGreaterThanOrEqual(expectedThird * 0.5);
        expect(thirdInterval).toBeLessThanOrEqual(expectedThird * 1.5);
        // Optionally, check that each interval is roughly double the previous
        expect(secondInterval).toBeGreaterThanOrEqual(firstInterval * 1.5);
        expect(secondInterval).toBeLessThanOrEqual(firstInterval * 2.5);
        expect(thirdInterval).toBeGreaterThanOrEqual(secondInterval * 1.5);
        expect(thirdInterval).toBeLessThanOrEqual(secondInterval * 2.5);
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
          policies: {
            global: {
              retryPolicy: {
                maxAttempts: 3,
                backoff: {
                  initial: 2,
                  strategy: 'linear',
                },
              },
            },
          },
          steps: [
            {
              name: 'linearRetry',
              request: {
                method: 'flaky',
                params: [],
              },
            },
          ],
        };

        // Create a handler that fails for 2 attempts and records timing
        const mockHandler = async (request: any) => {
          attempts.count++;
          recordRetryTime();

          if (attempts.count <= 2) {
            throw new FlowError('Network error', ImportedErrorCode.NETWORK_ERROR, {});
          }

          return {
            jsonrpc: '2.0',
            id: request.id,
            result: `Result for ${request.method}`,
          };
        };

        const executor = new FlowExecutor(flow, mockHandler, testLogger);

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
              params: [],
            },
            policies: {
              timeout: { timeout: 50 },
              retryPolicy: {
                maxAttempts: 3,
                retryableErrors: [ImportedErrorCode.TIMEOUT_ERROR],
              },
            }, // Very short timeout
          },
        ],
      };

      // Create a handler that times out for the first attempt, then speeds up
      const mockHandler = async (request: any) => {
        attempts.count++;
        testLogger.debug(`[mockHandler] Attempt: ${attempts.count}`);
        if (attempts.count === 1) {
          // Throw a TimeoutError with the correct error code
          throw TimeoutError.forStep({ name: request.method } as any, StepType.Request, 50, 100);
        }
        return {
          jsonrpc: '2.0',
          id: request.id,
          result: `Result for ${request.method}`,
        };
      };

      const executor = new FlowExecutor(flow, mockHandler, testLogger);

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
        policies: {
          global: {
            retryPolicy: {
              maxAttempts: 3,
            },
          },
        },
        steps: [
          {
            name: 'combinedPolicies',
            request: {
              method: 'flakyAndSlow',
              params: [],
            },
            policies: { timeout: { timeout: 50 } }, // Short timeout
          },
        ],
      };

      // Create a handler that fails with different errors
      const mockHandler = async (request: any) => {
        attempts.count++;

        if (attempts.count === 1) {
          // First attempt: timeout
          await new Promise((resolve) => setTimeout(resolve, 100)); // Longer than timeout
          return { jsonrpc: '2.0', id: request.id, result: 'Should not reach here' };
        } else if (attempts.count === 2) {
          // Second attempt: network error
          throw new FlowError('Network error', ImportedErrorCode.NETWORK_ERROR, {});
        } else {
          // Third attempt: success
          return { jsonrpc: '2.0', id: request.id, result: 'Success after retries' };
        }
      };

      const executor = new FlowExecutor(flow, mockHandler, testLogger);

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
        policies: {
          global: {
            timeout: {
              timeout: 1000, // Long global timeout
            },
            retryPolicy: {
              maxAttempts: 1,
            },
          },
        },
        steps: [
          {
            name: 'priorityStep',
            request: {
              method: 'slow',
              params: [],
            },
            policies: {
              timeout: { timeout: 50 },
              retryPolicy: {
                maxAttempts: 3,
              },
            },
          },
        ],
      };

      // Create a handler that times out
      const mockHandler = createMockHandler({
        delay: 100, // Longer than step timeout
        currentAttempt: attempts,
      });

      const executor = new FlowExecutor(flow, mockHandler, testLogger);

      // Execute and check that step-level policies are used
      await expectError(executor.execute(), {
        errorClass: ExecutionError,
        messageIncludes: 'timed out',
      });
      expect(attempts.count).toBe(3); // Should use retry policy (3 attempts)
    });
  });

  describe('AbortController integration', () => {
    it('should abort in-progress operations when timeout occurs', async () => {
      // Track if the abort handler was called
      let abortHandlerCalled = false;
      const abortHandler = () => {
        abortHandlerCalled = true;
      };

      const flow: Flow = {
        name: 'abort-timeout-test',
        description: 'Test operation abortion on timeout',
        steps: [
          {
            name: 'abortableOperation',
            policies: { timeout: { timeout: 50 } }, // Restore policies property for step-level timeout
            request: {
              method: 'long',
              params: {},
            },
          },
        ],
      };

      // Handler that only resolves after a long delay, but listens for abort
      const handler = createMockHandler({
        delay: 1000,
        onAbort: abortHandler,
      });

      const executor = new FlowExecutor(flow, handler, testLogger);
      await expectError(executor.execute(), {
        errorClass: ExecutionError,
        messageIncludes: 'timed out',
      });
      expect(abortHandlerCalled).toBe(true);
    });

    it('should allow cancellation of a flow execution from outside', async () => {
      jest.useRealTimers();
      const externalController = new AbortController();
      const flow: Flow = {
        name: 'external-abort-test',
        description: 'Test external abortion of flow',
        steps: [
          {
            name: 'longOperation',
            request: {
              method: 'long',
              params: [],
            },
          },
        ],
      };

      // Minimal handler: throws on abort
      const mockHandler = async (request: any, opts?: { signal?: AbortSignal }) => {
        testLogger.debug('[mockHandler] handler called');
        if (opts?.signal) {
          if (opts.signal && opts.signal.aborted) {
            testLogger.debug('[mockHandler] signal already aborted');
            throw new Error('Operation aborted by external controller');
          }
          testLogger.debug('[mockHandler] signal received, attaching abort event');
          await new Promise((_, reject) => {
            let timeoutId: NodeJS.Timeout | null = null;
            const abortListener = () => {
              testLogger.debug('[mockHandler] abort event fired');
              if (timeoutId) clearTimeout(timeoutId);
              reject(new Error('Operation aborted by external controller'));
            };
            if (opts.signal) {
              opts.signal.addEventListener('abort', abortListener);
              // Safety timeout to avoid hanging forever
              timeoutId = setTimeout(() => {
                testLogger.debug('[mockHandler] handler timeout reached');
                opts.signal?.removeEventListener('abort', abortListener);
                reject(new Error('Handler timed out'));
              }, 2000);
            }
          });
        }
        return { jsonrpc: '2.0', id: request.id, result: 'Should not complete' };
      };

      const executor = new FlowExecutor(flow, mockHandler, testLogger);
      const promise = executor.execute({ signal: externalController.signal });

      setTimeout(() => {
        testLogger.debug('[test] About to call externalController.abort()');
        externalController.abort();
        testLogger.debug('[test] Called externalController.abort()');
      }, 10);

      await expectError(promise, {
        errorClass: ExecutionError,
        messageIncludes: /timed out|TimeoutError/,
      });
    });

    it('should abort a request if the promise is aborted', async () => {
      let abortCalled = false;
      const mockHandler = jest.fn((request, opts) => {
        return new Promise((_, reject) => {
          if (opts?.signal) {
            opts.signal.addEventListener('abort', () => {
              abortCalled = true;
              reject(new Error('Aborted by signal'));
            });
          }
          // Never resolve, only reject on abort
        });
      });

      const flow: Flow = {
        name: 'timeout-abort-signal-test',
        description: 'Should abort handler on timeout',
        steps: [
          {
            name: 'timeoutStep',
            policies: { timeout: { timeout: 50 } },
            request: { method: 'slow', params: [] },
          },
        ],
      };

      const executor = new FlowExecutor(flow, mockHandler, testLogger);

      await expect(executor.execute()).rejects.toThrow(/timed out|TimeoutError/);
      expect(abortCalled).toBe(true);
    });
  });

  describe('Step-level timeout with abort', () => {
    it('should abort the promise when a step timeout is reached', async () => {
      const flow: Flow = {
        name: 'abort-test',
        description: 'Test step-level timeout with abort',
        steps: [
          {
            name: 'abortStep',
            policies: {
              timeout: {
                timeout: 50,
              },
            },
            request: {
              method: 'test.delay',
              params: { delayMs: 1000 },
            },
          },
        ],
      };

      // Create a mock handler that will create a long-running promise
      // that should be aborted by the timeout
      const mockHandler = createMockHandler({ delay: 100 });
      const executor = new FlowExecutor(flow, mockHandler, { logger: testLogger });

      await expectError(executor.execute(), {
        errorClass: ExecutionError,
        messageIncludes: 'timed out',
      });
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
              timeout: 100, // Short timeout
            },
          },
        },
        steps: [
          {
            name: 'step1',
            request: { method: 'test.delay', params: { delayMs: 50 } },
          },
          {
            name: 'step2',
            request: { method: 'test.delay', params: { delayMs: 200 } },
          },
        ],
      };

      const mockHandler = createMockHandler({ delay: 150 });
      const executor = new FlowExecutor(flow, mockHandler, { logger: testLogger });
      const controller = new AbortController();

      // Pass the signal to executor.execute
      await expectError(executor.execute({ signal: controller.signal }), {
        errorClass: ExecutionError,
        messageIncludes: 'timed out',
      });
    });
  });
});
