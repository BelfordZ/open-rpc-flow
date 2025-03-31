# Flow Execution Engine

A flexible and type-safe execution engine for JSON-RPC based workflows. This engine allows you to define complex flows of operations including requests, transformations, conditions, and loops, with full support for data dependencies, execution optimization, and error handling.

## Features

- 🔄 **JSON-RPC Request Handling**: Execute JSON-RPC 2.0 requests with automatic request ID management and error handling
- 🔀 **Flow Control**: Support for conditional execution and loops with proper variable scoping
- 🔄 **Data Transformation**: Transform data between steps using map, filter, reduce, and other operations
- 📊 **Expression Evaluation**: Dynamic expression evaluation with support for template literals and object paths
- 🔗 **Dependency Resolution**: Automatic handling of data dependencies between steps
- 🎯 **Type Safety**: Written in TypeScript with comprehensive type definitions
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

Aggregate data from multiple API endpoints:

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

Flow provides built-in error handling capabilities including automatic retries and circuit breaker patterns for request steps.

##### Retry Configuration

Configure automatic retries for transient errors:

```typescript
const executor = new FlowExecutor(flow, jsonRpcHandler, {
  // Enable automatic retries for request steps
  enableRetries: true,
  // Configure retry behavior (or use DEFAULT_RETRY_POLICY)
  retryPolicy: {
    maxAttempts: 3,
    backoff: {
      initial: 100, // Initial delay in ms
      multiplier: 2, // Exponential multiplier
      maxDelay: 5000, // Maximum delay in ms
    },
    retryableErrors: [ErrorCode.NETWORK_ERROR, ErrorCode.TIMEOUT_ERROR],
  },
});
```

Retries can be updated at runtime:

```typescript
// Update retry configuration during execution
executor.updateErrorHandlingOptions({
  enableRetries: true,
  retryPolicy: {
    maxAttempts: 5,
    backoff: {
      initial: 200,
      multiplier: 1.5,
      maxDelay: 10000,
    },
    retryableErrors: [ErrorCode.NETWORK_ERROR, ErrorCode.TIMEOUT_ERROR, ErrorCode.RESOURCE_ERROR],
  },
});
```

##### Circuit Breaker

Enable circuit breaker protection for request steps:

```typescript
const executor = new FlowExecutor(flow, jsonRpcHandler, {
  // Enable circuit breaker
  enableCircuitBreaker: true,
  // Configure circuit breaker (or use DEFAULT_CIRCUIT_BREAKER_CONFIG)
  circuitBreakerConfig: {
    failureThreshold: 5, // Number of failures before opening circuit
    recoveryTime: 30000, // Time in ms before attempting recovery
    monitorWindow: 60000, // Time window for failure evaluation
  },
});
```

##### Error Events

Listen for error events during flow execution:

```typescript
const executor = new FlowExecutor(flow, jsonRpcHandler, {
  eventOptions: {
    emitFlowEvents: true,
    emitStepEvents: true,
  },
});

// Listen for flow-level errors
executor.events.on('flow:error', (event) => {
  console.error(`Flow error in ${event.flowName}:`, event.error);
  console.log(`Execution time before error: ${event.duration}ms`);
});

// Listen for step-level errors
executor.events.on('step:error', (event) => {
  console.error(`Step error in ${event.stepName}:`, event.error);
});
```

### Timeout Configuration

Flow provides multi-level timeout configuration to control execution time at various scopes:

#### Step-Level Timeout

Set a timeout for a specific step:

```typescript
const flow = {
  name: 'MyFlow',
  steps: [
    {
      name: 'longRunningStep',
      timeout: 5000, // 5 second timeout for this step
      request: {
        method: 'slowOperation',
        params: {},
      },
    },
  ],
};
```

#### Flow-Level Timeouts

Configure timeouts for all steps of a certain type within a flow:

```typescript
const flow = {
  name: 'MyFlow',
  timeouts: {
    global: 30000, // 30s default for all steps
    request: 10000, // 10s for request steps
    transform: 5000, // 5s for transform steps
    condition: 2000, // 2s for condition steps
    loop: 60000, // 60s for loop steps
    expression: 1000, // 1s for expression evaluation
  },
  steps: [
    /* ... */
  ],
};
```

#### Executor-Level Timeouts

Set default timeouts when creating the executor:

```typescript
const executor = new FlowExecutor(flow, jsonRpcHandler, {
  timeouts: {
    global: 30000, // 30s default
    request: 10000, // 10s for requests
    transform: 5000, // 5s for transformations
  },
});
```

Timeout resolution follows this precedence order:

1. Step-level timeout (`step.timeout`)
2. Flow-level type-specific timeout (`flow.timeouts[stepType]`)
3. Flow-level global timeout (`flow.timeouts.global`)
4. Executor-level type-specific timeout
5. Default timeout for the step type

All timeouts must be:

- At least 50ms
- No more than 1 hour (3,600,000ms)
- A positive integer

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
