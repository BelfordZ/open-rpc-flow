import { FlowExecutor, Flow, JsonRpcRequest, ErrorCode } from '../index';

/**
 * This example demonstrates how to use the error handling features
 * of the FlowExecutor including retry policies and circuit breakers.
 */

// Define a simple flow that will make HTTP requests
const flow: Flow = {
  name: 'ErrorHandlingFlow',
  description: 'A flow that demonstrates error handling features',
  steps: [
    {
      name: 'reliableRequest',
      request: {
        method: 'api.reliable',
        params: { message: 'This should succeed' },
      },
    },
    {
      name: 'flakyRequest',
      request: {
        method: 'api.flaky',
        params: { message: 'This might fail sometimes' },
      },
    },
    {
      name: 'unreliableRequest',
      request: {
        method: 'api.unreliable',
        params: { message: 'This will fail often' },
      },
    },
  ],
};

// Mock counter to simulate intermittent failures
let requestCounter = 0;

// Setup a mock JSON-RPC handler with simulated errors
const jsonRpcHandler = async (request: JsonRpcRequest) => {
  // Simulate network delay
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Increment counter for simulating intermittent failures
  requestCounter++;

  if (request.method === 'api.reliable') {
    // This endpoint is reliable and always succeeds
    return { success: true, data: request.params };
  } else if (request.method === 'api.flaky') {
    // This endpoint fails 50% of the time - perfect for retry
    if (requestCounter % 2 === 0) {
      throw new Error('Network error: Connection timeout');
    }
    return { success: true, data: request.params, attempts: requestCounter };
  } else if (request.method === 'api.unreliable') {
    // This endpoint fails 80% of the time - will trigger circuit breaker
    if (requestCounter % 5 !== 0) {
      throw new Error('Service unavailable');
    }
    return { success: true, data: request.params, attempts: requestCounter };
  }

  throw new Error(`Unknown method: ${request.method}`);
};

// Create the flow executor with error handling options
const executor = new FlowExecutor(flow, jsonRpcHandler, {
  // Enable retry policy
  enableRetries: true,
  // Configure retry policy
  retryPolicy: {
    maxAttempts: 3,
    backoff: {
      initial: 100, // 100ms initial delay
      multiplier: 2, // Exponential backoff with multiplier 2
      maxDelay: 1000, // Maximum 1 second delay
    },
    retryableErrors: [ErrorCode.NETWORK_ERROR, ErrorCode.TIMEOUT_ERROR],
  },

  // Enable circuit breaker
  enableCircuitBreaker: true,
  // Configure circuit breaker
  circuitBreakerConfig: {
    failureThreshold: 3, // Open after 3 failures
    recoveryTime: 5000, // Try again after 5 seconds
    monitorWindow: 10000, // Monitor failures in 10 second window
  },

  // Also enable event emitter for logging
  eventOptions: {
    emitFlowEvents: true,
    emitStepEvents: true,
    includeResults: true,
  },
});

// Setup error event listeners
executor.events.on('step:error', (event) => {
  console.error(`❌ Error in step ${event.stepName}: ${event.error.message}`);
  console.log(`  Execution time: ${event.duration}ms`);
});

// Execute the flow
async function runFlow() {
  try {
    console.log('Starting flow execution with error handling...');
    console.log('---');

    const results = await executor.execute();

    console.log('Flow execution complete!');
    console.log('---');

    // Print results
    console.log('Results:');
    for (const [stepName, result] of results.entries()) {
      console.log(`${stepName}:`, result.result);
    }

    return results;
  } catch (error: any) {
    console.error('Flow execution failed:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
    return null;
  }
}

// Demonstrate updating error handling options
function updateErrorOptions() {
  // Update error handling options
  executor.updateErrorHandlingOptions({
    enableRetries: true,
    retryPolicy: {
      maxAttempts: 5, // Increase max attempts
      backoff: {
        initial: 200, // Increase initial delay
        multiplier: 1.5, // Decrease multiplier
        maxDelay: 2000, // Increase max delay
      },
      retryableErrors: [
        ErrorCode.NETWORK_ERROR,
        ErrorCode.TIMEOUT_ERROR,
        ErrorCode.RESOURCE_ERROR, // Add more retryable errors
      ],
    },
    enableCircuitBreaker: false, // Disable circuit breaker
  });

  console.log('Updated error handling options');
}

// Run the example when this file is executed directly
if (require.main === module) {
  runFlow()
    .then(() => {
      console.log('Updating error handling options...');
      updateErrorOptions();

      // Reset counter for second run
      requestCounter = 0;

      // Run the flow again with new settings
      return runFlow();
    })
    .then(() => {
      console.log('Example completed.');
    });
}

// Export for use in other examples
export { flow, executor, runFlow };
