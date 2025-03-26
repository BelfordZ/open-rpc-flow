import { FlowExecutor, FlowEventType, Flow, JsonRpcRequest } from '../index';

/**
 * This example demonstrates how to use the event emitter functionality
 * of the FlowExecutor to get streamed results during flow execution.
 */

// Define a simple flow
const flow: Flow = {
  name: 'ExampleFlow',
  description: 'A flow that demonstrates event emitter functionality',
  steps: [
    {
      name: 'step1',
      request: {
        method: 'echo',
        params: { message: 'Hello!' },
      },
    },
    {
      name: 'step2',
      request: {
        method: 'echo',
        params: { message: 'World!' },
      },
    },
    {
      name: 'step3',
      transform: {
        input: '${step1.result}',
        operations: [
          {
            type: 'map',
            using: 'item => ({ ...item, data: item.data + " " + ${step2.result.data} })',
          },
        ],
      },
    },
  ],
};

// Setup a mock JSON-RPC handler
const jsonRpcHandler = async (request: JsonRpcRequest) => {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 500));

  if (request.method === 'echo') {
    // Safely access the message property with type checking
    const params = request.params as Record<string, any>;
    return { data: params.message };
  }
  throw new Error(`Unknown method: ${request.method}`);
};

// Create the flow executor with custom event options
const executor = new FlowExecutor(flow, jsonRpcHandler, {
  eventOptions: {
    emitFlowEvents: true,
    emitStepEvents: true,
    emitDependencyEvents: true,
    includeResults: true,
    includeContext: false,
  },
});

// Setup event listeners for all events
executor.events.on(FlowEventType.FLOW_START, (event) => {
  console.log(`🚀 Flow started: ${event.flowName}`);
  console.log(`Steps to execute: ${event.orderedSteps.join(', ')}`);
  console.log('---');
});

executor.events.on(FlowEventType.FLOW_COMPLETE, (event) => {
  console.log(`✅ Flow completed: ${event.flowName}`);
  console.log(`Duration: ${event.duration}ms`);
  console.log('Results:', event.results);
  console.log('---');
});

executor.events.on(FlowEventType.FLOW_ERROR, (event) => {
  console.error(`❌ Flow error: ${event.flowName}`);
  console.error(`Error: ${event.error.message}`);
  console.error(`Duration: ${event.duration}ms`);
  console.log('---');
});

executor.events.on(FlowEventType.STEP_START, (event) => {
  console.log(`▶️ Step started: ${event.stepName} (${event.stepType})`);
  console.log('---');
});

executor.events.on(FlowEventType.STEP_COMPLETE, (event) => {
  console.log(`✓ Step completed: ${event.stepName} (${event.stepType})`);
  console.log(`Duration: ${event.duration}ms`);
  console.log('Result:', event.result);
  console.log('---');
});

executor.events.on(FlowEventType.STEP_ERROR, (event) => {
  console.error(`⚠️ Step error: ${event.stepName} (${event.stepType})`);
  console.error(`Error: ${event.error.message}`);
  console.error(`Duration: ${event.duration}ms`);
  console.log('---');
});

executor.events.on(FlowEventType.DEPENDENCY_RESOLVED, (event) => {
  console.log('📊 Dependencies resolved');
  console.log(`Order: ${event.orderedSteps.join(' -> ')}`);
  console.log('---');
});

// Execute the flow
async function runFlow() {
  try {
    console.log('Starting flow execution...');
    console.log('---');

    const results = await executor.execute();

    console.log('Flow execution complete!');
    console.log('---');

    return results;
  } catch (error) {
    console.error('Flow execution failed:', error);
    return null;
  }
}

// Alternative: Run with minimal event configuration
async function runWithMinimalEvents() {
  // Update event options to only emit essential events
  executor.updateEventOptions({
    emitFlowEvents: true,
    emitStepEvents: false,
    emitDependencyEvents: false,
    includeResults: false,
  });

  console.log('Running with minimal events...');
  console.log('---');

  return await executor.execute();
}

// Run the example when this file is executed directly
if (require.main === module) {
  runFlow().then(() => {
    console.log('Example completed.');
  });
}

// Export for use in other examples
export { flow, executor, runFlow, runWithMinimalEvents };
