# TKT-TIMEOUT-018: Implement Comprehensive Timeout Tests

## Description

Add a comprehensive test suite for the timeout functionality to ensure that timeouts are properly enforced, configured, and handled throughout the flow execution process.

## Acceptance Criteria

- Create unit tests for timeout configuration validation
- Add tests for timeout resolution at different levels (step, flow, global)
- Implement tests for timeout enforcement in each step executor
- Add integration tests with simulated slow operations
- Test timeout error handling and retry mechanisms
- Test timeout monitoring and metrics collection
- Ensure test coverage for edge cases (zero timeouts, null timeouts, etc.)

## Proposed Test Implementation

### Unit Tests for Timeout Configuration

```typescript
// src/__tests__/timeout/timeout-configuration.test.ts
import { Flow, Step, StepType, TimeoutValidator } from '../../index';

describe('Timeout Configuration', () => {
  describe('validation', () => {
    it('should accept valid timeout values', () => {
      expect(() => TimeoutValidator.validate(1000)).not.toThrow();
      expect(() => TimeoutValidator.validate(0)).not.toThrow();
      expect(() => TimeoutValidator.validate(null)).not.toThrow();
    });

    it('should reject invalid timeout values', () => {
      expect(() => TimeoutValidator.validate(-1)).toThrow();
      expect(() => TimeoutValidator.validate('1000' as any)).toThrow();
      expect(() => TimeoutValidator.validate(1.5)).toThrow();
    });
  });

  describe('Flow API', () => {
    it('should set global timeout', () => {
      const flow = new Flow().setTimeout(5000);
      expect(flow.toJSON().timeouts.global).toBe(5000);
    });

    it('should set step-type timeouts', () => {
      const flow = new Flow().setTimeouts({
        [StepType.Request]: 10000,
        [StepType.Transform]: 5000,
      });

      expect(flow.toJSON().timeouts[StepType.Request]).toBe(10000);
      expect(flow.toJSON().timeouts[StepType.Transform]).toBe(5000);
    });

    it('should set timeout for specific step by name', () => {
      const flow = new Flow()
        .addStep(
          new Step()
            .name('testStep')
            .type(StepType.Request)
            .request({ method: 'test', params: [] }),
        )
        .setStepTimeout('testStep', 3000);

      const stepWithTimeout = flow.steps[0];
      expect(stepWithTimeout.timeout).toBe(3000);
    });

    it('should throw when setting timeout for non-existent step', () => {
      const flow = new Flow();
      expect(() => flow.setStepTimeout('nonExistentStep', 1000)).toThrow();
    });
  });
});
```

### Tests for Timeout Resolution

```typescript
// src/__tests__/timeout/timeout-resolver.test.ts
import { TimeoutResolver, Flow, Step, StepType, FlowExecutorOptions } from '../../index';

describe('TimeoutResolver', () => {
  const defaultTimeouts = {
    global: 60000,
    request: 30000,
    transform: 5000,
    branch: 10000,
    loop: 60000,
    sequence: 30000,
    parallel: 30000,
  };

  let resolver: TimeoutResolver;

  beforeEach(() => {
    resolver = new TimeoutResolver(defaultTimeouts);
  });

  it('should use step timeout as highest priority', () => {
    const step = { type: StepType.Request, timeout: 2000 } as Step;
    const flow = { timeouts: { [StepType.Request]: 5000, global: 10000 } } as Flow;

    const timeout = resolver.resolveTimeout(step, flow);
    expect(timeout).toBe(2000);
  });

  it('should use flow step-type timeout when no step timeout', () => {
    const step = { type: StepType.Request } as Step;
    const flow = { timeouts: { [StepType.Request]: 5000, global: 10000 } } as Flow;

    const timeout = resolver.resolveTimeout(step, flow);
    expect(timeout).toBe(5000);
  });

  it('should use flow global timeout when no step-type timeout', () => {
    const step = { type: StepType.Request } as Step;
    const flow = { timeouts: { global: 10000 } } as Flow;

    const timeout = resolver.resolveTimeout(step, flow);
    expect(timeout).toBe(10000);
  });

  it('should use default step-type timeout when no flow timeouts', () => {
    const step = { type: StepType.Request } as Step;
    const flow = {} as Flow;

    const timeout = resolver.resolveTimeout(step, flow);
    expect(timeout).toBe(30000); // Default for Request type
  });

  it('should use default global timeout as last resort', () => {
    const step = { type: StepType.Branch } as Step;
    const flow = {} as Flow;

    // Simulate case where there's no default for this step type
    resolver = new TimeoutResolver({ global: 60000 });

    const timeout = resolver.resolveTimeout(step, flow);
    expect(timeout).toBe(60000);
  });

  it('should return null if all timeouts are disabled', () => {
    const step = { type: StepType.Request } as Step;
    const flow = { timeouts: { [StepType.Request]: null, global: null } } as Flow;

    resolver = new TimeoutResolver({ global: null, request: null });

    const timeout = resolver.resolveTimeout(step, flow);
    expect(timeout).toBeNull();
  });
});
```

### Tests for Timeout Enforcement in Executors

```typescript
// src/__tests__/timeout/executors/request-executor-timeout.test.ts
import { RequestStepExecutor, Step, StepType, TimeoutError } from '../../../index';

describe('RequestStepExecutor Timeout', () => {
  let executor: RequestStepExecutor;

  beforeEach(() => {
    // Create mocked JSON-RPC handler that can be delayed
    const mockHandler = jest.fn().mockImplementation(async (request, options) => {
      // Check if we should delay
      const delay = options?.delay || 0;

      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      // Check if aborted during delay
      if (options?.signal?.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }

      return { jsonrpc: '2.0', id: request.id, result: 'success' };
    });

    executor = new RequestStepExecutor(mockHandler);
  });

  it('should successfully execute within timeout', async () => {
    const step = {
      name: 'testRequest',
      type: StepType.Request,
      request: { method: 'test', params: [] },
    } as Step;

    const context = { timeout: 1000 };

    const result = await executor.execute(step, context);
    expect(result.result).toEqual('success');
  });

  it('should throw TimeoutError when execution exceeds timeout', async () => {
    const step = {
      name: 'slowRequest',
      type: StepType.Request,
      request: { method: 'test', params: [] },
    } as Step;

    const context = { timeout: 100 };
    const extraContext = { delay: 500 }; // Delay longer than timeout

    await expect(executor.execute(step, context, extraContext)).rejects.toThrow(TimeoutError);
  });

  it('should include correct metadata in timeout errors', async () => {
    const step = {
      name: 'metadataRequest',
      type: StepType.Request,
      request: { method: 'test', params: [] },
    } as Step;

    const context = { timeout: 50 };
    const extraContext = { delay: 200 };

    try {
      await executor.execute(step, context, extraContext);
      fail('Should have thrown TimeoutError');
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      expect(error.name).toBe('TimeoutError');
      expect(error.stepName).toBe('metadataRequest');
      expect(error.timeout).toBe(50);
      expect(error.elapsed).toBeGreaterThanOrEqual(50);
      expect(error.metadata.code).toBe('TIMEOUT_ERROR');
    }
  });

  it('should respect null timeout (no timeout enforced)', async () => {
    const step = {
      name: 'noTimeoutRequest',
      type: StepType.Request,
      request: { method: 'test', params: [] },
    } as Step;

    const context = { timeout: null };
    const extraContext = { delay: 200 };

    const result = await executor.execute(step, context, extraContext);
    expect(result.result).toEqual('success');
  });
});
```

### Integration Tests

```typescript
// src/__tests__/integration/timeout-integration.test.ts
import { Flow, Step, StepType, FlowExecutor, TimeoutError } from '../../index';

describe('Timeout Integration Tests', () => {
  it('should enforce timeouts across a complex flow', async () => {
    // Create a flow with various timeout configurations
    const flow = new Flow()
      .id('timeout-test-flow')
      .setTimeout(5000) // Global timeout for the flow
      .setTimeouts({
        [StepType.Request]: 2000,
        [StepType.Transform]: 1000,
      })
      .addStep(
        new Step().name('request1').type(StepType.Request).request({ method: 'test', params: [] }),
      )
      .addStep(
        new Step()
          .name('transform')
          .type(StepType.Transform)
          .expression('context.flowResults.request1.result'),
      )
      .addStep(
        new Step()
          .name('slowRequest')
          .type(StepType.Request)
          .request({ method: 'slow', params: [] }),
      )
      .setStepTimeout('slowRequest', 100); // Very short timeout

    // Create executor with mock handlers
    const executor = new FlowExecutor({
      transport: {
        type: 'custom',
        handler: async (request) => {
          if (request.method === 'slow') {
            // Simulate slow request
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          return { jsonrpc: '2.0', id: request.id, result: 'success' };
        },
      },
      logging: true,
    });

    // Execute flow, expect timeout error
    await expect(executor.execute(flow)).rejects.toThrow(TimeoutError);
  });

  it('should apply timeouts hierarchically in nested steps', async () => {
    // Create flow with nested steps and timeouts
    const flow = new Flow()
      .id('nested-timeout-test')
      .setTimeout(1000)
      .addStep(
        new Step()
          .name('sequence')
          .type(StepType.Sequence)
          .steps([
            new Step().name('fast').type(StepType.Transform).expression('"fast"'),
            new Step()
              .name('slow')
              .type(StepType.Transform)
              .expression(
                '() => { let x = 0; for (let i = 0; i < 10000000; i++) { x += i; } return x; }()',
              )
              .timeout(50), // Very short timeout
          ]),
      );

    const executor = new FlowExecutor();

    // Execute flow, expect timeout error
    try {
      await executor.execute(flow);
      fail('Should have thrown TimeoutError');
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      expect(error.stepName).toBe('slow');
      expect(error.timeout).toBe(50);
    }
  });

  it('should collect timeout metrics during execution', async () => {
    // Create a flow with steps that execute within timeout
    const flow = new Flow()
      .id('metrics-test-flow')
      .setTimeout(5000)
      .addStep(
        new Step().name('request1').type(StepType.Request).request({ method: 'test', params: [] }),
      )
      .addStep(
        new Step().name('request2').type(StepType.Request).request({ method: 'test2', params: [] }),
      );

    // Create executor with monitoring enabled
    const nearTimeoutCallback = jest.fn();
    const executor = new FlowExecutor({
      transport: {
        type: 'custom',
        handler: async (request) => {
          // Simulate varying response times
          await new Promise((resolve) =>
            setTimeout(resolve, request.method === 'test' ? 100 : 200),
          );
          return { jsonrpc: '2.0', id: request.id, result: 'success' };
        },
      },
      timeoutMonitorOptions: {
        nearTimeoutThreshold: 50, // 50% threshold to trigger near-timeout
        onNearTimeout: nearTimeoutCallback,
        collectMetrics: true,
      },
    });

    // Execute flow
    const result = await executor.execute(flow);

    // Check metrics
    expect(result.metadata.timeoutMetrics).toBeDefined();
    expect(result.metadata.timeoutMetrics.executionTimes[StepType.Request].length).toBe(2);
    expect(result.metadata.timeoutMetrics.totalExecutionTime).toBeGreaterThan(300);
    expect(result.metadata.timeoutMetrics.slowestExecution.stepName).toBe('request2');

    // Near-timeout callback should not have been called (steps well under timeout)
    expect(nearTimeoutCallback).not.toHaveBeenCalled();
  });

  it('should retry on timeout with appropriate policy', async () => {
    // Create a flow with a potentially slow step
    const flow = new Flow()
      .id('retry-timeout-test')
      .addStep(
        new Step()
          .name('retriableRequest')
          .type(StepType.Request)
          .request({ method: 'slow', params: [] })
          .timeout(150),
      );

    // Mock function to track retries
    const handlerMock = jest.fn().mockImplementation(async (request) => {
      // First two calls are slow (timeout), third is fast
      if (handlerMock.mock.calls.length <= 2) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return { jsonrpc: '2.0', id: request.id, result: 'success' };
    });

    // Create executor with retry policy
    const executor = new FlowExecutor({
      transport: {
        type: 'custom',
        handler: handlerMock,
      },
      retryPolicy: {
        timeoutRetry: {
          maxRetries: 3,
          resetTimeout: true,
          timeoutMultiplier: 1.5, // Increase timeout on retries
        },
      },
      logging: true,
    });

    // Execute flow, should succeed after retries
    const result = await executor.execute(flow);

    // Check that it was retried
    expect(handlerMock).toHaveBeenCalledTimes(3);
    expect(result.result).toBe('success');
  });
});
```

## Dependencies

- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces
- TKT-TIMEOUT-004: Implement Timeout Resolution Logic
- TKT-TIMEOUT-012: Implement TimeoutError Class
- TKT-TIMEOUT-013: Update Flow Executor with Timeout Resolution Support
- TKT-TIMEOUT-015: Implement Timeout Retry Policies

## Estimation

5 story points (10-15 hours)
