# Flow Execution Engine

A flexible and type-safe execution engine for JSON-RPC based workflows. This engine allows you to define complex flows of operations including requests, transformations, conditions, and loops, with full support for data dependencies, parallel execution, and error handling.

## Features

- 🔄 **JSON-RPC Request Handling**: Execute JSON-RPC 2.0 requests with automatic request ID management and error handling
- 🔀 **Flow Control**: Support for conditional execution, loops, and parallel processing with proper variable scoping
- 🔄 **Data Transformation**: Transform data between steps using map, filter, reduce, and other operations
- 📊 **Expression Evaluation**: Dynamic expression evaluation with support for template literals and object paths
- 🔗 **Dependency Resolution**: Automatic handling of data dependencies between steps
- 🎯 **Type Safety**: Written in TypeScript with comprehensive type definitions
- ⚡ **Parallel Execution**: Automatic parallel execution of independent steps
- 🔍 **Error Handling**: Detailed error reporting, validation, and graceful error recovery
- 🌍 **Context Management**: Global context available to all steps with proper scoping
- 📦 **Batch Processing**: Support for processing data in configurable batch sizes

## Examples

### 1. Team Member Processing

Process team members with nested operations and dynamic notifications:

```typescript
const teamFlow: Flow = {
  name: 'team-member-processing',
  description: 'Process team members and send notifications',
  context: {
    notificationTypes: {
      welcome: 'WELCOME',
      update: 'UPDATE',
    },
  },
  steps: [
    {
      name: 'getTeams',
      request: {
        method: 'teams.list',
        params: { active: true },
      },
    },
    {
      name: 'processTeams',
      loop: {
        over: '${getTeams.result}',
        as: 'team',
        step: {
          name: 'processMembers',
          loop: {
            over: '${team.members}',
            as: 'member',
            step: {
              name: 'processMember',
              condition: {
                if: '${member.active}',
                then: {
                  name: 'notifyMember',
                  request: {
                    method: 'notify',
                    params: {
                      teamId: '${team.id}',
                      memberId: '${member.id}',
                      type: '${context.notificationTypes.welcome}',
                      data: {
                        teamName: '${team.name}',
                        memberRole: '${member.role}',
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  ],
};
```

### 2. Data Pipeline with Error Recovery

Process data with validation, transformation, and error handling:

```typescript
const dataPipelineFlow: Flow = {
  name: 'data-pipeline',
  description: 'Process and transform data with error handling',
  context: {
    batchSize: 2,
    minValue: 10,
    retryCount: 3,
  },
  steps: [
    {
      name: 'getData',
      request: {
        method: 'data.fetch',
        params: { source: 'test' },
      },
    },
    {
      name: 'validateData',
      condition: {
        if: '${getData.error}',
        then: {
          name: 'retryData',
          loop: {
            over: 'Array.from({ length: ${context.retryCount} })',
            as: 'attempt',
            step: {
              name: 'retryFetch',
              request: {
                method: 'data.fetch',
                params: {
                  source: 'test',
                  attempt: '${metadata.current.index + 1}',
                },
              },
            },
          },
        },
        else: {
          name: 'processData',
          transform: {
            input: '${getData.result}',
            operations: [
              {
                type: 'filter',
                using: '${item.value > context.minValue}',
              },
              {
                type: 'map',
                using: '{ ...item, processed: true }',
              },
            ],
          },
        },
      },
    },
    {
      name: 'processBatches',
      loop: {
        over: '${validateData.result.result}',
        as: 'batch',
        step: {
          name: 'processBatch',
          request: {
            method: 'batch.process',
            params: {
              data: '${batch}',
              index: '${metadata.current.index}',
            },
          },
        },
      },
    },
  ],
};
```

### 3. API Data Aggregation

Aggregate data from multiple API endpoints with parallel processing:

```typescript
const apiAggregationFlow: Flow = {
  name: 'api-aggregation',
  description: 'Aggregate data from multiple APIs',
  steps: [
    {
      name: 'fetchUsers',
      request: {
        method: 'users.list',
        params: { status: 'active' },
      },
    },
    {
      name: 'fetchUserDetails',
      loop: {
        over: '${fetchUsers.result}',
        as: 'user',
        step: {
          name: 'userDetails',
          transform: {
            input: '${user}',
            operations: [
              {
                type: 'parallel',
                operations: [
                  {
                    name: 'profile',
                    request: {
                      method: 'user.profile',
                      params: { userId: '${user.id}' },
                    },
                  },
                  {
                    name: 'activity',
                    request: {
                      method: 'user.activity',
                      params: { userId: '${user.id}' },
                    },
                  },
                ],
              },
              {
                type: 'map',
                using: `{
                  ...user,
                  profile: ${profile.result},
                  recentActivity: ${activity.result}
                }`,
              },
            ],
          },
        },
      },
    },
    {
      name: 'aggregateData',
      transform: {
        input: '${fetchUserDetails.result.value}',
        operations: [
          {
            type: 'group',
            using: 'item.profile.department',
          },
          {
            type: 'map',
            using: `{
              department: key,
              userCount: items.length,
              activeUsers: items.filter(u => u.recentActivity.length > 0).length
            }`,
          },
        ],
      },
    },
  ],
};
```

## Installation

```bash
npm install @open-rpc/flow
```

## Quick Start

Here's a simple example of defining and executing a flow:

```typescript
import { FlowExecutor, Flow } from '@open-rpc/flow';

// Define your JSON-RPC handler
const jsonRpcHandler = async (request) => {
  // Implement your JSON-RPC handling logic
  return { result: 'Success' };
};

// Define a flow with data processing and error handling
const flow: Flow = {
  name: 'Data Processing Flow',
  description: 'Process and transform data with error handling',
  context: {
    minValue: 10,
  },
  steps: [
    {
      name: 'getData',
      request: {
        method: 'data.fetch',
        params: { source: 'api' },
      },
    },
    {
      name: 'validateData',
      condition: {
        if: '${getData.result.length > 0}',
        then: {
          name: 'processData',
          transform: {
            input: '${getData.result}',
            operations: [
              {
                type: 'filter',
                using: '${item.value > context.minValue}',
              },
              {
                type: 'map',
                using: '{ ...item, processed: true }',
              },
            ],
          },
        },
        else: {
          name: 'handleError',
          request: {
            method: 'error.log',
            params: { message: 'No data found' },
          },
        },
      },
    },
  ],
};

// Execute the flow
const executor = new FlowExecutor(flow, jsonRpcHandler);
const results = await executor.execute();
```

## Flow Definition

A flow consists of a series of steps that can include:

### Request Steps

Execute JSON-RPC requests with error handling:

```typescript
{
  name: 'getUser',
  request: {
    method: 'user.get',
    params: { id: 1 }
  }
}
```

### Transform Steps

Transform data using operations like map, filter, reduce:

```typescript
{
  name: 'processUsers',
  transform: {
    input: '${getUser.result}',
    operations: [
      {
        type: 'filter',
        using: '${item.active === true}',
      },
      {
        type: 'map',
        using: '{ id: item.id, name: item.name }',
      },
      {
        type: 'reduce',
        using: '[...acc, item.id]',
        initial: [],
      }
    ]
  }
}
```

### Conditional Steps

Execute steps based on conditions with error handling:

```typescript
{
  name: 'validateUser',
  condition: {
    if: '${getUser.error}',
    then: {
      name: 'handleError',
      request: {
        method: 'error.log',
        params: { message: '${getUser.error.message}' }
      }
    },
    else: {
      name: 'processUser',
      transform: {
        input: '${getUser.result}',
        operations: [
          {
            type: 'map',
            using: '{ ...item, validated: true }'
          }
        ]
      }
    }
  }
}
```

### Loop Steps

Iterate over collections with batch processing:

```typescript
{
  name: 'processItems',
  loop: {
    over: '${getItems.result}',
    as: 'item',
    maxIterations: 100,
    step: {
      name: 'processItem',
      request: {
        method: 'item.process',
        params: {
          id: '${item.id}',
          batchIndex: '${metadata.current.index}'
        }
      }
    }
  }
}
```

## Expression Evaluation

The engine supports dynamic expressions using the `${...}` syntax:

- Simple references: `${stepName}`
- Property access: `${stepName.property}`
- Array access: `${stepName[0]}`
- Nested properties: `${stepName.nested.property}`
- Template literals: `` `Value: ${stepName.value}` ``
- Comparisons: `${value > 10}`
- Object literals: `{ id: ${item.id}, name: ${item.name} }`
- Error handling: `${stepName.error.message}`

## Error Handling

The engine provides detailed error information and recovery options:

```typescript
try {
  await executor.execute();
} catch (error) {
  if (error instanceof JsonRpcRequestError) {
    // Handle JSON-RPC specific errors
    console.error('RPC Error:', error.error);
  } else {
    // Handle other execution errors
    console.error('Execution Error:', error.message);
  }
}
```

### Advanced Error Handling

The flow engine provides comprehensive error handling capabilities, including retry policies, timeouts, and circuit breakers to build resilient workflows.

#### Error Types

The engine uses a hierarchical error model for different error categories:

```typescript
import { FlowError, ExecutionError, ValidationError, TimeoutError, StateError } from '@open-rpc/flow';

// All errors inherit from FlowError
if (error instanceof FlowError) {
  console.log('Flow error code:', error.code);
  console.log('Error context:', error.context);
}

// Specific error types
if (error instanceof ExecutionError) {
  // Handle execution errors (runtime, network, etc.)
} else if (error instanceof ValidationError) {
  // Handle validation errors (schema, input validation)
} else if (error instanceof TimeoutError) {
  // Handle timeout errors
} else if (error instanceof StateError) {
  // Handle state errors (invalid state, missing dependencies)
}
```

#### Configuring Error Handling Features

The FlowExecutor can be configured with retry policies and circuit breakers to automatically handle transient errors:

```typescript
import { 
  FlowExecutor, 
  ErrorCode, 
  DEFAULT_RETRY_POLICY,
  DEFAULT_CIRCUIT_BREAKER_CONFIG 
} from '@open-rpc/flow';

// Create a flow executor with error handling options
const executor = new FlowExecutor(flow, jsonRpcHandler, {
  // Enable automatic retries for request steps
  enableRetries: true,
  // Use custom retry policy (or use DEFAULT_RETRY_POLICY)
  retryPolicy: {
    maxAttempts: 3,
    backoff: {
      initial: 100,  // Initial delay in ms
      multiplier: 2, // Exponential multiplier
      maxDelay: 5000 // Maximum delay in ms
    },
    retryableErrors: [
      ErrorCode.NETWORK_ERROR,
      ErrorCode.TIMEOUT_ERROR
    ]
  },
  
  // Enable circuit breaker for request steps
  enableCircuitBreaker: true,
  // Use custom circuit breaker config (or use DEFAULT_CIRCUIT_BREAKER_CONFIG)
  circuitBreakerConfig: {
    failureThreshold: 5,   // Number of failures before opening circuit
    recoveryTime: 30000,   // Time in ms to wait before attempting recovery
    monitorWindow: 60000   // Time window for failure evaluation
  }
});
```

#### Dynamic Error Handling Updates

You can update error handling options at runtime:

```typescript
// Update error handling options during execution
executor.updateErrorHandlingOptions({
  enableRetries: true,
  retryPolicy: {
    maxAttempts: 5,         // Increase max attempts
    backoff: {
      initial: 200,         // Change initial delay
      multiplier: 1.5,      // Change multiplier
      maxDelay: 10000       // Change max delay
    },
    retryableErrors: [
      ErrorCode.NETWORK_ERROR,
      ErrorCode.TIMEOUT_ERROR,
      ErrorCode.RESOURCE_ERROR  // Add additional retryable errors
    ]
  },
  enableCircuitBreaker: false  // Disable circuit breaker if needed
});
```

#### Retry Policies

Configure retry behavior for transient errors using retry policies:

```typescript
import { RetryableOperation, ErrorCode } from '@open-rpc/flow';

// Define a retry policy
const retryPolicy = {
  maxAttempts: 3,
  backoff: {
    initial: 100,  // Initial delay in ms
    multiplier: 2, // Exponential multiplier
    maxDelay: 5000 // Maximum delay in ms
  },
  retryableErrors: [
    ErrorCode.NETWORK_ERROR,
    ErrorCode.TIMEOUT_ERROR,
    ErrorCode.OPERATION_TIMEOUT
  ]
};

// Create a retryable operation
const operation = new RetryableOperation(
  async () => {
    // Your operation that might fail
    return await jsonRpcHandler(request);
  },
  retryPolicy,
  logger
);

// Execute with automatic retries
try {
  const result = await operation.execute();
} catch (error) {
  // This will only be thrown after all retry attempts fail
  console.error('All retry attempts failed:', error);
}
```

#### Circuit Breakers

Prevent cascading failures in your workflows with circuit breaker patterns:

```typescript
import { CircuitBreaker } from '@open-rpc/flow';

// Configure a circuit breaker
const circuitBreaker = new CircuitBreaker({
  failureThreshold: 5,   // Number of failures before opening circuit
  recoveryTime: 30000,   // Time in ms to wait before attempting recovery
  monitorWindow: 60000   // Time window for failure evaluation
}, logger);

// Execute an operation with circuit breaker protection
try {
  const result = await circuitBreaker.execute(async () => {
    // Your operation that might fail
    return await jsonRpcHandler(request);
  });
} catch (error) {
  if (error instanceof StateError && error.code === 'INVALID_STATE') {
    console.error('Circuit breaker is open, failing fast');
  } else {
    console.error('Operation failed:', error);
  }
}
```

#### Expression Timeouts

The flow engine has built-in protection against expressions that could hang your application, such as infinite recursion or extremely complex operations:

```typescript
// Flow with a potentially problematic expression
const flow: Flow = {
  name: 'Expression Timeout Example',
  steps: [
    {
      name: 'transformData',
      transform: {
        input: '[1, 2, 3, 4, 5]',
        operations: [
          {
            type: 'map',
            // This expression contains recursion without a proper base case,
            // which would cause a stack overflow if not for the timeout protection
            using: `
              (function recursiveCalc(item) {
                return recursiveCalc(item + 1); // Infinite recursion!
              })(item)
            `
          }
        ]
      }
    }
  ]
};

// The engine automatically protects against such problematic expressions
// If an expression takes longer than the internal timeout (default: 1000ms)
// an error will be thrown with a timeout message
try {
  const executor = new FlowExecutor(flow, jsonRpcHandler);
  await executor.execute();
} catch (error) {
  console.error('Expression evaluation failed:', error.message);
  // You would see: "Expression evaluation timed out"
}
```

**Note:** This timeout protection is built into the flow engine automatically - you don't need to enable or configure it explicitly. It prevents issues like infinite loops, excessive recursion, or highly complex expressions from hanging your application.

Common scenarios that can trigger expression timeouts:
- Recursive functions without proper termination conditions
- Excessively deep object traversal
- Extremely large data structures in expressions
- Complex regular expressions that can cause catastrophic backtracking

### Multi-Level Timeout Configuration

In the ideal implementation, the flow engine should support timeout configuration at multiple levels:

```typescript
// Flow with comprehensive timeout configuration
const flow: Flow = {
  name: "Data Processing Flow",
  description: "Process data with custom timeouts",
  
  // Flow-level timeouts
  timeouts: {
    global: 60000,        // 60s default for all steps in this flow
    request: 120000,      // 120s for request steps
    transform: 30000      // 30s for transform steps
  },
  
  steps: [
    {
      name: "fetchData",
      timeout: 180000,    // 180s specific timeout for this step
      request: {
        method: "data.fetch",
        params: { source: "api" }
      }
    },
    {
      name: "processData",
      // Uses the flow-level transform timeout (30s)
      transform: {
        input: "${fetchData.result}",
        operations: [
          // Complex operations...
        ]
      }
    }
  ]
};

// Initialize executor with global defaults
const executor = new FlowExecutor(flow, jsonRpcHandler, {
  timeouts: {
    global: 30000,        // 30s global default
    expression: 2000      // 2s for expression evaluation
  }
});
```

The timeout resolution should follow this precedence order:
1. Step-level timeout (`step.timeout`)
2. Flow-level type-specific timeout (`flow.timeouts[stepType]`)
3. Flow-level global timeout (`flow.timeouts.global`) 
4. Global type-specific timeout from executor options
5. Global default timeout from executor options
6. System-level built-in defaults

This multi-level timeout architecture would allow for precise control over execution times, preventing:
- Runaway processes
- Excessive resource consumption
- Deadlocks from unresponsive services
- Performance degradation from slow operations

#### Error Events

You can listen for error events during flow execution:

```typescript
import { FlowExecutor, FlowEventType } from '@open-rpc/flow';

const executor = new FlowExecutor(flow, jsonRpcHandler);

// Listen for flow-level errors
executor.events.on(FlowEventType.FLOW_ERROR, (event) => {
  console.error(`Flow error in ${event.flowName}:`, event.error);
  console.log(`Execution time before error: ${event.duration}ms`);
});

// Listen for step-level errors
executor.events.on(FlowEventType.STEP_ERROR, (event) => {
  console.error(`Step error in ${event.stepName}:`, event.error);
  console.log(`Step execution time before error: ${event.duration}ms`);
});
```

## Event Emitter Interface

The flow executor includes an event emitter that allows you to receive real-time updates during flow execution. This is useful for monitoring progress, logging, and integrating with external systems.

### Using the Event Emitter

```typescript
import { FlowExecutor, FlowEventType } from '@open-rpc/flow';

// Create a flow executor with event options
const executor = new FlowExecutor(flow, jsonRpcHandler, {
  eventOptions: {
    emitFlowEvents: true,
    emitStepEvents: true,
    includeResults: true,
  },
});

// Listen for flow start events
executor.events.on(FlowEventType.FLOW_START, (event) => {
  console.log(`Flow started: ${event.flowName}`);
  console.log(`Steps to execute: ${event.orderedSteps.join(', ')}`);
});

// Listen for step completion events
executor.events.on(FlowEventType.STEP_COMPLETE, (event) => {
  console.log(`Step completed: ${event.stepName} in ${event.duration}ms`);
  console.log('Result:', event.result);
});

// Execute the flow and receive streamed updates
const results = await executor.execute();
```

### Available Events

| Event Type            | Description                                        |
| --------------------- | -------------------------------------------------- |
| `flow:start`          | Emitted when flow execution begins                 |
| `flow:complete`       | Emitted when flow execution completes successfully |
| `flow:error`          | Emitted when flow execution fails                  |
| `step:start`          | Emitted when a step execution begins               |
| `step:complete`       | Emitted when a step execution completes            |
| `step:error`          | Emitted when a step execution fails                |
| `step:skip`           | Emitted when a step is skipped                     |
| `dependency:resolved` | Emitted when dependencies are resolved             |

### Configuration Options

You can configure the event emitter behavior when creating the flow executor:

```typescript
const executor = new FlowExecutor(flow, jsonRpcHandler, {
  eventOptions: {
    // Whether to emit flow-level events
    emitFlowEvents: true,
    // Whether to emit step-level events
    emitStepEvents: true,
    // Whether to emit dependency resolution events
    emitDependencyEvents: false,
    // Whether to include result details in events
    includeResults: true,
    // Whether to include context details in events
    includeContext: false,
  },
});
```

You can also update the event options after creation:

```typescript
executor.updateEventOptions({
  emitStepEvents: false,
  includeResults: false,
});
```

## Type Safety

The engine is written in TypeScript and provides comprehensive type definitions:

```typescript
interface Flow {
  name: string;
  description?: string;
  context?: Record<string, any>;
  steps: Step[];
}

type Step = RequestStep | TransformStep | ConditionStep | LoopStep;

interface RequestStep {
  name: string;
  request: {
    method: string;
    params?: Record<string, any>;
  };
}

// More type definitions available in the source
```

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
