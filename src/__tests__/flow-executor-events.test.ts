import { FlowExecutor, FlowEventType } from '../index';
import { TestLogger } from '../util/logger';
import { Flow, JsonRpcRequest } from '../types';
import { FlowExecutorEvents } from '../util/flow-executor-events';

describe('FlowExecutor Events', () => {
  const simpleFlow: Flow = {
    name: 'SimpleFlow',
    description: 'A simple flow for testing events',
    steps: [
      {
        name: 'step1',
        request: {
          method: 'test.method',
          params: { foo: 'bar' },
        },
      },
      {
        name: 'step2',
        transform: {
          input: '${context.items}',
          operations: [
            {
              type: 'map',
              using: '{ ...${item}, transformed: true }',
            },
          ],
        },
      },
    ],
    context: {
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
    },
  };

  const mockJsonRpcHandler = async (request: JsonRpcRequest) => {
    if (request.method === 'test.method') {
      return { success: true, data: { message: 'Test response' } };
    }
    throw new Error(`Unknown method: ${request.method}`);
  };

  test('should emit flow and step events', async () => {
    const logger = new TestLogger();
    const executor = new FlowExecutor(simpleFlow, mockJsonRpcHandler, { logger });

    // Event collection
    const events: any[] = [];

    // Register event listeners
    Object.values(FlowEventType).forEach((eventType) => {
      executor.events.on(eventType, (data) => {
        events.push({ type: eventType, data });
      });
    });

    // Execute the flow
    await executor.execute();

    // Verify that events were emitted
    expect(events.length).toBeGreaterThan(0);

    // Verify flow events
    expect(events.some((e) => e.type === FlowEventType.FLOW_START)).toBe(true);
    expect(events.some((e) => e.type === FlowEventType.FLOW_COMPLETE)).toBe(true);

    // Verify step events
    expect(events.filter((e) => e.type === FlowEventType.STEP_START).length).toBe(2);
    expect(events.filter((e) => e.type === FlowEventType.STEP_COMPLETE).length).toBe(2);

    // Verify dependency events (disabled by default)
    expect(events.some((e) => e.type === FlowEventType.DEPENDENCY_RESOLVED)).toBe(false);
  });

  test('should respect event configuration options', async () => {
    const logger = new TestLogger();
    const executor = new FlowExecutor(simpleFlow, mockJsonRpcHandler, {
      logger,
      eventOptions: {
        emitFlowEvents: true,
        emitStepEvents: false,
      },
    });

    // Event collection
    const events: any[] = [];

    // Register event listeners
    Object.values(FlowEventType).forEach((eventType) => {
      executor.events.on(eventType, (data) => {
        events.push({ type: eventType, data });
      });
    });

    // Execute the flow
    await executor.execute();

    // Verify that only flow events were emitted
    expect(events.some((e) => e.type === FlowEventType.FLOW_START)).toBe(true);
    expect(events.some((e) => e.type === FlowEventType.FLOW_COMPLETE)).toBe(true);

    // Verify no step events were emitted
    expect(events.some((e) => e.type === FlowEventType.STEP_START)).toBe(false);
    expect(events.some((e) => e.type === FlowEventType.STEP_COMPLETE)).toBe(false);
  });

  test('should be able to update event options after initialization', async () => {
    const logger = new TestLogger();
    const executor = new FlowExecutor(simpleFlow, mockJsonRpcHandler, {
      logger,
      eventOptions: {
        emitFlowEvents: true,
        emitStepEvents: false,
        emitDependencyEvents: false,
      },
    });

    // Update options to enable dependency events
    executor.updateEventOptions({
      emitDependencyEvents: true,
    });

    // Event collection
    const events: any[] = [];

    // Register event listeners
    Object.values(FlowEventType).forEach((eventType) => {
      executor.events.on(eventType, (data) => {
        events.push({ type: eventType, data });
      });
    });

    // Execute the flow
    await executor.execute();

    // Verify dependency events are now emitted
    expect(events.some((e) => e.type === FlowEventType.DEPENDENCY_RESOLVED)).toBe(true);
  });

  test('should handle flow errors correctly', async () => {
    const logger = new TestLogger();
    const flowWithError: Flow = {
      name: 'ErrorFlow',
      description: 'A flow that will cause an error',
      steps: [
        {
          name: 'errorStep',
          request: {
            method: 'does.not.exist',
            params: {},
          },
        },
      ],
    };

    const executor = new FlowExecutor(flowWithError, mockJsonRpcHandler, { logger });

    // Event collection
    const errorEvents: any[] = [];

    // Register event listeners for errors
    executor.events.on(FlowEventType.FLOW_ERROR, (data) => {
      errorEvents.push({ type: FlowEventType.FLOW_ERROR, data });
    });

    executor.events.on(FlowEventType.STEP_ERROR, (data) => {
      errorEvents.push({ type: FlowEventType.STEP_ERROR, data });
    });

    // Execute the flow (expect it to throw)
    await expect(executor.execute()).rejects.toThrow();

    // Verify error events were emitted
    expect(errorEvents.some((e) => e.type === FlowEventType.FLOW_ERROR)).toBe(true);
    expect(errorEvents.some((e) => e.type === FlowEventType.STEP_ERROR)).toBe(true);
  });

  test('should support disabling all events', async () => {
    const logger = new TestLogger();
    const executor = new FlowExecutor(simpleFlow, mockJsonRpcHandler, {
      logger,
      eventOptions: {
        emitFlowEvents: false,
        emitStepEvents: false,
        emitDependencyEvents: false,
      },
    });

    // Event collection
    const events: any[] = [];

    // Register event listeners
    Object.values(FlowEventType).forEach((eventType) => {
      executor.events.on(eventType, (data) => {
        events.push({ type: eventType, data });
      });
    });

    // Execute the flow
    await executor.execute();

    // Verify no events were emitted
    expect(events.length).toBe(0);
  });

  test('should emit dependency resolved events when enabled', async () => {
    const logger = new TestLogger();
    const executor = new FlowExecutor(simpleFlow, mockJsonRpcHandler, {
      logger,
      eventOptions: {
        emitFlowEvents: false,
        emitStepEvents: false,
        emitDependencyEvents: true,
      },
    });

    // Event collection
    const events: any[] = [];

    // Register event listeners
    Object.values(FlowEventType).forEach((eventType) => {
      executor.events.on(eventType, (data) => {
        events.push({ type: eventType, data });
      });
    });

    // Execute the flow
    await executor.execute();

    // Verify only dependency events were emitted
    expect(events.length).toBe(1);
    expect(events[0].type).toBe(FlowEventType.DEPENDENCY_RESOLVED);
  });

  test('should include context details when configured', async () => {
    const logger = new TestLogger();
    const executor = new FlowExecutor(simpleFlow, mockJsonRpcHandler, {
      logger,
      eventOptions: {
        emitStepEvents: true,
        includeContext: true,
      },
    });

    // Event collection
    const stepStartEvents: any[] = [];

    // Register event listeners
    executor.events.on(FlowEventType.STEP_START, (data) => {
      stepStartEvents.push(data);
    });

    // Execute the flow
    await executor.execute();

    // Verify context was included in the events
    expect(stepStartEvents.length).toBeGreaterThan(0);
    expect(stepStartEvents[0].context).toBeDefined();
    expect(stepStartEvents[0].context.items).toBeDefined();
  });

  test('should not include result details when configured', async () => {
    const logger = new TestLogger();
    const executor = new FlowExecutor(simpleFlow, mockJsonRpcHandler, {
      logger,
      eventOptions: {
        emitStepEvents: true,
        includeResults: false,
      },
    });

    // Event collection
    const stepCompleteEvents: any[] = [];

    // Register event listeners
    executor.events.on(FlowEventType.STEP_COMPLETE, (data) => {
      stepCompleteEvents.push(data);
    });

    // Execute the flow
    await executor.execute();

    // Verify result details were omitted
    expect(stepCompleteEvents.length).toBeGreaterThan(0);

    // Should only include type, not the actual result data
    const firstResult = stepCompleteEvents[0].result;
    expect(firstResult).toBeDefined();
    expect(firstResult.type).toBeDefined();
    expect(Object.keys(firstResult).length).toBe(1);
  });

  test('should emit step skip events', async () => {
    const logger = new TestLogger();
    const flowWithStop: Flow = {
      name: 'StopFlow',
      description: 'A flow that includes a stop step',
      steps: [
        {
          name: 'step1',
          stop: {
            endWorkflow: true,
          },
        },
        {
          name: 'step2',
          request: {
            method: 'test.method',
            params: { foo: 'bar' },
          },
        },
      ],
    };

    const executor = new FlowExecutor(flowWithStop, mockJsonRpcHandler, { logger });

    // Event collection
    const skipEvents: any[] = [];

    // Register event listeners
    executor.events.on(FlowEventType.STEP_SKIP, (data) => {
      skipEvents.push(data);
    });

    // Execute the flow
    await executor.execute();

    // Verify skip events were emitted
    expect(skipEvents.length).toBe(1);
    expect(skipEvents[0].stepName).toBe('step1');
    expect(skipEvents[0].reason).toContain('previous step');
  });

  test('should emit step events for nested steps', async () => {
    const logger = new TestLogger();

    // Flow with a condition step that contains nested steps
    const nestedStepsFlow: Flow = {
      name: 'NestedStepsFlow',
      description: 'A flow with nested steps',
      steps: [
        {
          name: 'conditionStep',
          condition: {
            if: 'true',
            then: {
              name: 'thenStep',
              request: {
                method: 'test.method',
                params: { nested: true },
              },
            },
          },
        },
      ],
    };

    const executor = new FlowExecutor(nestedStepsFlow, mockJsonRpcHandler, { logger });

    // Event collection
    const nestedStepEvents: any[] = [];

    // Register event listeners
    executor.events.on(FlowEventType.STEP_START, (data) => {
      if (data.stepName === 'thenStep') {
        nestedStepEvents.push(data);
      }
    });

    // Execute the flow
    await executor.execute();

    // Verify nested step events were emitted
    expect(nestedStepEvents.length).toBe(1);
  });

  it('should handle unknown step types correctly', async () => {
    // Create a flow with a step that has no recognized type
    const unknownStepFlow = {
      name: 'UnknownStepFlow',
      steps: [
        {
          name: 'unknownStep',
          // This step has no recognized type properties
          someUnknownProperty: true,
        },
      ],
    };

    const mockJsonRpcHandler = jest.fn().mockResolvedValue({});
    const logger = new TestLogger();
    const executor = new FlowExecutor(unknownStepFlow as any, mockJsonRpcHandler, {
      logger,
      eventOptions: {
        includeContext: true,
      },
    });

    // Event collection
    const events: any[] = [];

    // Register event listeners
    executor.events.on(FlowEventType.STEP_START, (data) => {
      events.push({
        type: FlowEventType.STEP_START,
        data,
      });
    });

    // Execute flow - we expect this to fail
    await expect(executor.execute()).rejects.toThrow();

    // Verify the step type was considered "unknown"
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].data.stepType).toBe('unknown');
  });

  it('should handle nested step errors correctly', async () => {
    // Create a flow with a nested step that will throw an error
    const nestedErrorFlow = {
      name: 'NestedErrorFlow',
      steps: [
        {
          name: 'conditionStep',
          condition: {
            if: 'true',
            then: {
              name: 'errorStep',
              request: {
                // This will cause an error because there's no method
                params: {},
              },
            },
          },
        },
      ],
    };

    const mockJsonRpcHandler = jest.fn().mockResolvedValue({});
    const logger = new TestLogger();
    const executor = new FlowExecutor(nestedErrorFlow as any, mockJsonRpcHandler, { logger });

    // Event collection
    const nestedErrorEvents: any[] = [];

    // Register event listeners
    executor.events.on(FlowEventType.STEP_ERROR, (data) => {
      if (data.stepName === 'errorStep') {
        nestedErrorEvents.push(data);
      }
    });

    // Execute the flow - will fail but we'll catch the error
    await expect(executor.execute()).rejects.toThrow();

    // Verify nested step error events were emitted
    expect(nestedErrorEvents.length).toBe(1);
  });

  it('should check for nested stop results correctly', async () => {
    // Create a flow with a condition that has a stop step in the then branch
    const nestedStopFlow = {
      name: 'NestedStopFlow',
      steps: [
        {
          name: 'step1',
          request: {
            method: 'test.method',
            params: {},
          },
        },
        {
          name: 'conditionStep',
          condition: {
            if: 'true',
            then: {
              name: 'stopStep',
              stop: {
                endWorkflow: true,
              },
            },
          },
        },
        {
          name: 'shouldNotExecute',
          request: {
            method: 'test.method',
            params: {},
          },
        },
      ],
    };

    // Create a proper mock for the JSON-RPC handler
    const mockJsonRpcHandler = jest.fn().mockImplementation((request) => {
      if (request && request.method === 'test.method') {
        return Promise.resolve({ result: 'test-result' });
      }
      return Promise.reject(new Error('Unknown method'));
    });

    const logger = new TestLogger();
    const executor = new FlowExecutor(nestedStopFlow as any, mockJsonRpcHandler, { logger });

    // Event collection
    const events: any[] = [];

    // Register event listeners for both STEP_SKIP events and FLOW_COMPLETE events
    executor.events.on(FlowEventType.STEP_SKIP, (data) => {
      events.push({
        type: FlowEventType.STEP_SKIP,
        data,
      });
    });

    // Execute the flow
    await executor.execute();

    // Verify that a step was skipped due to the nested stop
    expect(events.length).toBe(1);
    // In this implementation, it looks like the condition step itself is marked as skipped
    expect(events[0].data.stepName).toBe('conditionStep');
  });

  it('should only emit certain event types when configured', async () => {
    // Create a flow with multiple steps for testing
    const testFlow = {
      name: 'SelectiveEventFlow',
      steps: [
        {
          name: 'step1',
          request: {
            method: 'test.method',
            params: {},
          },
        },
      ],
    };

    // Create a proper mock for the JSON-RPC handler
    const mockJsonRpcHandler = jest.fn().mockImplementation((request) => {
      if (request && request.method === 'test.method') {
        return Promise.resolve({ result: 'test-result' });
      }
      return Promise.reject(new Error('Unknown method'));
    });

    const logger = new TestLogger();

    // Configure event options to disable dependency events but enable other types
    const executor = new FlowExecutor(testFlow as any, mockJsonRpcHandler, {
      logger,
      eventOptions: {
        emitFlowEvents: true,
        emitStepEvents: true,
        emitDependencyEvents: false,
      },
    });

    // Event collection
    const events: any[] = [];

    // Register all event listeners
    Object.values(FlowEventType).forEach((eventType) => {
      executor.events.on(eventType, (data) => {
        events.push({
          type: eventType,
          data,
        });
      });
    });

    // Execute the flow
    await executor.execute();

    // Verify that dependency events weren't emitted but other events were
    expect(events.some((e) => e.type === FlowEventType.DEPENDENCY_RESOLVED)).toBe(false);
    expect(events.some((e) => e.type === FlowEventType.FLOW_START)).toBe(true);
    expect(events.some((e) => e.type === FlowEventType.STEP_START)).toBe(true);
  });

  it('should handle flow level errors at various points', async () => {
    // Create a flow with an invalid dependency that will cause an error
    // during dependency resolution
    const errorFlow = {
      name: 'ErrorFlow',
      steps: [
        {
          name: 'step1',
          request: {
            method: 'test.method',
            params: {
              // Invalid reference that will cause dependency resolution to fail
              data: '${nonExistentStep.result}',
            },
          },
        },
      ],
    };

    const mockJsonRpcHandler = jest.fn().mockImplementation((request) => {
      if (request && request.method === 'test.method') {
        return Promise.resolve({ result: 'test-result' });
      }
      return Promise.reject(new Error('Unknown method'));
    });

    const logger = new TestLogger();
    const executor = new FlowExecutor(errorFlow as any, mockJsonRpcHandler, {
      logger,
      eventOptions: {
        includeContext: true,
      },
    });

    // Event collection for flow error
    const errorEvents: any[] = [];

    // Register error event listener
    executor.events.on(FlowEventType.FLOW_ERROR, (data) => {
      errorEvents.push(data);
    });

    // Execute the flow - should fail during dependency resolution
    await expect(executor.execute()).rejects.toThrow();

    // Verify error event was emitted
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].flowName).toBe('ErrorFlow');
    expect(errorEvents[0].error).toBeDefined();
  });

  it('should directly emit step error events when enabled', async () => {
    // Create a simple step for testing
    const testStep = {
      name: 'errorStep',
      request: {
        method: 'test.method',
        params: {},
      },
    };

    const logger = new TestLogger();
    const executor = new FlowExecutor(simpleFlow, mockJsonRpcHandler, {
      logger,
      eventOptions: {
        emitStepEvents: true,
      },
    });

    // Event collection
    const errorEvents: any[] = [];

    // Register error event listener
    executor.events.on(FlowEventType.STEP_ERROR, (data) => {
      errorEvents.push(data);
    });

    // Directly call the emitStepError method
    const testError = new Error('Test error');
    const startTime = Date.now() - 100; // Mock a start time 100ms ago
    executor.events.emitStepError(testStep as any, testError, startTime);

    // Verify error event was emitted
    expect(errorEvents.length).toBe(1);
    expect(errorEvents[0].stepName).toBe('errorStep');
    expect(errorEvents[0].error).toBe(testError);
    expect(errorEvents[0].duration).toBeGreaterThanOrEqual(100);
    expect(errorEvents[0].stepType).toBe('request');
  });

  it('should not emit step error events when disabled', async () => {
    // Create a simple step for testing
    const testStep = {
      name: 'errorStep',
      request: {
        method: 'test.method',
        params: {},
      },
    };

    const logger = new TestLogger();
    const executor = new FlowExecutor(simpleFlow, mockJsonRpcHandler, {
      logger,
      eventOptions: {
        emitStepEvents: false, // Explicitly disable step events
      },
    });

    // Event collection
    const errorEvents: any[] = [];

    // Register error event listener
    executor.events.on(FlowEventType.STEP_ERROR, (data) => {
      errorEvents.push(data);
    });

    // Directly call the emitStepError method
    const testError = new Error('Test error');
    const startTime = Date.now();
    executor.events.emitStepError(testStep as any, testError, startTime);

    // Verify no error event was emitted (because step events are disabled)
    expect(errorEvents.length).toBe(0);
  });

  it('should test all step types for getStepType method', async () => {
    // Create steps with different types to test getStepType
    const loopStep = {
      name: 'loopStep',
      loop: {
        items: [1, 2, 3],
        steps: [
          {
            name: 'innerStep',
            request: { method: 'test.method', params: {} },
          },
        ],
      },
    };

    const requestStep = {
      name: 'requestStep',
      request: { method: 'test.method', params: {} },
    };

    const conditionStep = {
      name: 'conditionStep',
      condition: {
        if: 'true',
        then: { name: 'thenStep', request: { method: 'test.method', params: {} } },
      },
    };

    const transformStep = {
      name: 'transformStep',
      transform: {
        input: '${context.items}',
        operations: [{ type: 'map', using: '{ ...${item}, test: true }' }],
      },
    };

    const stopStep = {
      name: 'stopStep',
      stop: { endWorkflow: true },
    };

    const unknownStep = {
      name: 'unknownStep',
      someProperty: true,
    };

    const logger = new TestLogger();
    const executor = new FlowExecutor(simpleFlow, mockJsonRpcHandler, { logger });

    // Collect step start events to verify the stepType
    const events: any[] = [];

    // Register event listener
    executor.events.on(FlowEventType.STEP_START, (data) => {
      events.push(data);
    });

    // Directly emit events for each step type
    executor.events.emitStepStart(loopStep as any, { context: {} } as any);
    executor.events.emitStepStart(requestStep as any, { context: {} } as any);
    executor.events.emitStepStart(conditionStep as any, { context: {} } as any);
    executor.events.emitStepStart(transformStep as any, { context: {} } as any);
    executor.events.emitStepStart(stopStep as any, { context: {} } as any);
    executor.events.emitStepStart(unknownStep as any, { context: {} } as any);

    // Verify all step types were correctly identified
    expect(events.length).toBe(6);
    expect(events[0].stepType).toBe('loop');
    expect(events[1].stepType).toBe('request');
    expect(events[2].stepType).toBe('condition');
    expect(events[3].stepType).toBe('transform');
    expect(events[4].stepType).toBe('stop');
    expect(events[5].stepType).toBe('unknown');
  });

  it('should emit dependency resolved events with ordered steps', async () => {
    const logger = new TestLogger();
    const executor = new FlowExecutor(simpleFlow, mockJsonRpcHandler, {
      logger,
      eventOptions: {
        emitDependencyEvents: true,
      },
    });

    // Event collection
    const events: any[] = [];

    // Register event listener
    executor.events.on(FlowEventType.DEPENDENCY_RESOLVED, (data) => {
      events.push(data);
    });

    // Directly call the emitDependencyResolved method
    const orderedSteps = ['step1', 'step2', 'step3'];
    executor.events.emitDependencyResolved(orderedSteps);

    // Verify dependency resolved event was emitted with ordered steps
    expect(events.length).toBe(1);
    expect(events[0].orderedSteps).toEqual(orderedSteps);
  });

  it('should not emit dependency resolved events when disabled', async () => {
    const logger = new TestLogger();
    const executor = new FlowExecutor(simpleFlow, mockJsonRpcHandler, {
      logger,
      eventOptions: {
        emitDependencyEvents: false,
      },
    });

    // Event collection
    const events: any[] = [];

    // Register event listener
    executor.events.on(FlowEventType.DEPENDENCY_RESOLVED, (data) => {
      events.push(data);
    });

    // Directly call the emitDependencyResolved method
    const orderedSteps = ['step1', 'step2', 'step3'];
    executor.events.emitDependencyResolved(orderedSteps);

    // Verify no event was emitted because dependency events are disabled
    expect(events.length).toBe(0);
  });

  it('should handle extraContext in step start events', async () => {
    const logger = new TestLogger();
    const executor = new FlowExecutor(simpleFlow, mockJsonRpcHandler, {
      logger,
      eventOptions: {
        emitStepEvents: true,
        includeContext: true, // Enable context inclusion
      },
    });

    // Create a simple step
    const testStep = {
      name: 'testStep',
      request: {
        method: 'test.method',
        params: {},
      },
    };

    // Create execution context and extra context
    const executionContext = {
      context: { baseValue: 'base' },
      logger,
    } as any;

    const extraContext = { extraValue: 'extra' };

    // Event collection
    const events: any[] = [];

    // Register event listener
    executor.events.on(FlowEventType.STEP_START, (data) => {
      events.push(data);
    });

    // Emit a step start event with extra context
    executor.events.emitStepStart(testStep as any, executionContext, extraContext);

    // Verify context merging happened correctly
    expect(events.length).toBe(1);
    expect(events[0].context).toBeDefined();
    expect(events[0].context.baseValue).toBe('base');
    expect(events[0].context.extraValue).toBe('extra');

    // Now test with includeContext disabled
    executor.updateEventOptions({ includeContext: false });
    events.length = 0; // Clear events array

    // Emit another step start event
    executor.events.emitStepStart(testStep as any, executionContext, extraContext);

    // Verify context is not included
    expect(events.length).toBe(1);
    expect(events[0].context).toBeUndefined();
  });

  it('should test problematic lines directly using FlowExecutorEvents', () => {
    // Create a direct instance of FlowExecutorEvents
    const events = new FlowExecutorEvents({
      emitStepEvents: true,
      emitFlowEvents: true,
      emitDependencyEvents: true,
      includeContext: true,
      includeResults: true,
    });

    // Add listeners to verify events
    const receivedEvents: any[] = [];

    Object.values(FlowEventType).forEach((eventType) => {
      events.on(eventType, (data: any) => {
        receivedEvents.push({ type: eventType, data });
      });
    });

    // Create test entities
    const testStep = {
      name: 'testStep',
      request: { method: 'test.method', params: {} },
    };

    const executionContext = {
      context: { baseValue: 'base' },
    } as any;

    const extraContext = { extraValue: 'extra' };

    // Test line 188: Context ternary in emitStepStart
    events.emitStepStart(testStep as any, executionContext, extraContext);

    // Verify context was merged when includeContext is true
    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].data.context).toBeDefined();
    expect(receivedEvents[0].data.context.baseValue).toBe('base');
    expect(receivedEvents[0].data.context.extraValue).toBe('extra');

    // Test line 261: Directly call emitDependencyResolved
    receivedEvents.length = 0; // Clear events

    const orderedSteps = ['step1', 'step2'];
    events.emitDependencyResolved(orderedSteps);

    // Verify the dependency resolved event was emitted with the correct data
    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].type).toBe(FlowEventType.DEPENDENCY_RESOLVED);
    expect(receivedEvents[0].data.orderedSteps).toEqual(orderedSteps);

    // Now test both methods with options disabled
    receivedEvents.length = 0; // Clear events

    events.updateOptions({
      emitStepEvents: false,
      emitDependencyEvents: false,
      includeContext: false,
    });

    // These should not emit anything now
    events.emitStepStart(testStep as any, executionContext, extraContext);
    events.emitDependencyResolved(orderedSteps);

    expect(receivedEvents.length).toBe(0);
  });

  it('should test flow complete event with includeResults=false - handling stepCount', async () => {
    // Testing specifically the line that creates the resultsObj with stepCount instead of full results

    // Create an instance with includeResults set to false explicitly
    const events = new FlowExecutorEvents();

    // Override the options directly to ensure includeResults is false
    events.updateOptions({
      emitFlowEvents: true,
      includeResults: false,
    });

    const captureEvents: any[] = [];
    events.on(FlowEventType.FLOW_COMPLETE, (data: any) => {
      captureEvents.push(data);
    });

    // Create a results map with multiple entries
    const resultsMap = new Map<string, any>();
    resultsMap.set('step1', { value: 'test1' });
    resultsMap.set('step2', { value: 'test2' });

    // Call emitFlowComplete
    events.emitFlowComplete('TestFlow', resultsMap, Date.now() - 100);

    // Verify that the event contains stepCount property instead of actual results
    expect(captureEvents.length).toBe(1);
    expect(captureEvents[0].results).toEqual({ stepCount: 2 });
    // Make sure no actual result entries are included
    expect(Object.keys(captureEvents[0].results)).toHaveLength(1);
    expect(captureEvents[0].results.step1).toBeUndefined();
  });

  it('should emit and not emit step skip events based on options', async () => {
    // Create instances with step events enabled and disabled
    const eventsEnabled = new FlowExecutorEvents({ emitStepEvents: true });
    const eventsDisabled = new FlowExecutorEvents({ emitStepEvents: false });

    // Add listeners to verify events
    const enabledEvents: any[] = [];
    const disabledEvents: any[] = [];

    eventsEnabled.on(FlowEventType.STEP_SKIP, (data: any) => {
      enabledEvents.push(data);
    });

    eventsDisabled.on(FlowEventType.STEP_SKIP, (data: any) => {
      disabledEvents.push(data);
    });

    // Create a test step
    const testStep = {
      name: 'skippedStep',
      request: {
        method: 'test.method',
        params: {},
      },
    };

    // Call emitStepSkip on both instances
    const skipReason = 'Condition evaluated to false';
    eventsEnabled.emitStepSkip(testStep as any, skipReason);
    eventsDisabled.emitStepSkip(testStep as any, skipReason); // This should hit line 261 with the early return

    // Verify events were emitted correctly
    expect(enabledEvents.length).toBe(1);
    expect(enabledEvents[0].stepName).toBe('skippedStep');
    expect(enabledEvents[0].reason).toBe(skipReason);

    // Verify no events were emitted when disabled
    expect(disabledEvents.length).toBe(0);
  });

  it('should not emit flow complete event when emitFlowEvents is false', async () => {
    // Testing specifically the early return in emitFlowComplete when emitFlowEvents is false

    // Create an instance with emitFlowEvents set to false explicitly
    const events = new FlowExecutorEvents();

    // Override the options directly to ensure emitFlowEvents is false
    events.updateOptions({
      emitFlowEvents: false,
    });

    // Add listeners to verify events are not emitted
    const captureEvents: any[] = [];
    events.on(FlowEventType.FLOW_COMPLETE, (data: any) => {
      captureEvents.push(data);
    });

    // Create a results map
    const resultsMap = new Map<string, any>();
    resultsMap.set('step1', { value: 'test1' });

    // Call emitFlowComplete - should return early due to emitFlowEvents = false
    events.emitFlowComplete('TestFlow', resultsMap, Date.now());

    // Verify that no event was emitted
    expect(captureEvents.length).toBe(0);
  });

  it('should not emit flow error event when emitFlowEvents is disabled', async () => {
    // Create an instance with events disabled
    const events = new FlowExecutorEvents({ emitFlowEvents: false });

    // Add listener
    const receivedEvents: any[] = [];
    events.on(FlowEventType.FLOW_ERROR, (data: any) => {
      receivedEvents.push(data);
    });

    // Call emitFlowError (should early return due to emitFlowEvents being false)
    const testError = new Error('Test error');
    events.emitFlowError('TestFlow', testError, Date.now());

    // Verify no events were emitted
    expect(receivedEvents.length).toBe(0);
  });
});
