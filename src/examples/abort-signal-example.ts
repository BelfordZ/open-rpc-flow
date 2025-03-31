import { JsonRpcHandler, JsonRpcRequest, JsonRpcHandlerOptions } from '../types';
import { Flow } from '../index';
import { ErrorCode } from '../errors/codes';

/**
 * Example implementation of a JsonRpcHandler with AbortSignal support
 */
export const exampleJsonRpcHandler: JsonRpcHandler = async function(
  request: JsonRpcRequest,
  options?: JsonRpcHandlerOptions
): Promise<any> {
  console.log(`Executing JSON-RPC request: ${request.method}`, {
    id: request.id,
    hasSignal: options?.signal ? 'yes' : 'no',
  });

  // If a signal is provided and already aborted, reject immediately
  if (options?.signal?.aborted) {
    console.log('Request aborted before execution');
    throw new DOMException('Request aborted', 'AbortError');
  }

  // Create a fetch-based request with timeout support
  const apiUrl = 'https://api.example.com/jsonrpc';
  
  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: options?.signal, // Pass the abort signal to fetch
    });

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    return result;
  } catch (error: any) {
    // Check for AbortError
    if (error.name === 'AbortError') {
      console.log('Request was aborted during execution');
      throw error; // Preserve the AbortError
    }

    // Handle other errors
    console.error('JSON-RPC request failed:', error);
    throw error;
  }
};

/**
 * Example flow with global and step-level timeouts
 */
export const exampleFlow: Flow = {
  name: 'example-flow-with-timeouts',
  description: 'Flow with timeout configuration',
  timeouts: {
    // Global timeout applies to the entire flow
    global: 30000, // 30 seconds
    // Step type-specific timeouts apply to all steps of that type
    request: 5000, // 5 seconds for all request steps by default
  },
  steps: [
    {
      name: 'fast-step',
      request: {
        method: 'example.fastMethod',
        params: { operation: 'quick-query' },
      }
      // Uses the default request timeout (5000ms)
    },
    {
      name: 'slow-step',
      request: {
        method: 'example.slowMethod',
        params: { operation: 'complex-calculation' },
      },
      // Step-specific timeout overrides the default
      timeout: 10000, // 10 seconds
      // Fallback configuration in case of timeout
      timeoutFallback: {
        value: { status: 'timeout', result: null },
        continueExecution: true // Continue flow execution even if this step times out
      }
    }
  ]
};

/**
 * Usage notes:
 * 
 * 1. The Flow Executor will create an AbortController internally based on the timeout configuration.
 * 2. For each step execution, the AbortController's signal is passed to the JsonRpcHandler.
 * 3. The RequestStepExecutor handles AbortError exceptions automatically.
 * 4. End users only need to:
 *    - Configure timeouts at flow and/or step level
 *    - Optionally provide fallback values for timeout cases
 *    - Implement a JsonRpcHandler that respects the AbortSignal
 * 
 * The FlowExecutor takes care of the rest, including:
 * - Creating and managing AbortController lifecycle
 * - Ensuring signal propagation to handlers
 * - Proper error handling and timeouts
 */