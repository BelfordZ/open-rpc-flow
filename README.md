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

The Flow Execution Engine throws specific error classes, all extending `FlowError`. Use `instanceof` to catch and handle them.

### Error Classes

- `ValidationError`: Pre-execution flow structure issues (e.g., missing fields).
- `DependencyError`: Unresolved step dependencies.
- `ExpressionError`: Expression evaluation failures.
- `RequestError`: JSON-RPC request failures.
- `StepExecutionError`: Step execution issues.
  - `LoopError`: Loop-specific errors (e.g., missing configuration, invalid inputs).
  - `TransformError`: Transform-specific errors (e.g., invalid operations).
  - `ConditionError`: Condition-specific errors (e.g., non-boolean conditions).

### Example

```typescript
import { 
  FlowExecutor, 
  FlowError,
  ValidationError, 
  DependencyError,
  ExpressionError,
  RequestError,
  StepExecutionError,
  LoopError,
  TransformError,
  ConditionError
} from '@open-rpc/flow';

try {
  const executor = new FlowExecutor(flow, jsonRpcHandler);
  await executor.execute();
} catch (error) {
  if (error instanceof ValidationError) {
    console.error(`Invalid flow: ${error.message}`, error.details);
  } else if (error instanceof DependencyError) {
    console.error(`Dependency issue: ${error.message}`, error.details);
  } else if (error instanceof ExpressionError) {
    console.error(`Expression error: ${error.message}`, error.details);
  } else if (error instanceof RequestError) {
    console.error(`Request failed: ${error.message}`, error.details);
  } else if (error instanceof LoopError) {
    console.error(`Loop issue: ${error.message}`, error.details);
  } else if (error instanceof TransformError) {
    console.error(`Transform issue: ${error.message}`, error.details);
  } else if (error instanceof ConditionError) {
    console.error(`Condition issue: ${error.message}`, error.details);
  } else if (error instanceof StepExecutionError) {
    console.error(`Step execution failed: ${error.message}`, error.details);
  } else if (error instanceof FlowError) {
    console.error(`Flow error: ${error.message}`, error.details);
  } else {
    console.error(`Unexpected error: ${error.message}`);
  }
}
```

### Error Details

All error classes include a `details` property with contextual information about the error:

```typescript
// ValidationError details
{
  field: 'steps',  // The field that failed validation
  stepIndex: 2     // Optional: index of the step that failed validation
}

// DependencyError details
{
  stepName: 'processData',           // The step with the dependency issue
  missingDependency: 'fetchData',    // The missing dependency
  availableSteps: ['step1', 'step2'] // Available steps in the flow
}

// RequestError details
{
  stepName: 'makeRequest',    // The step that failed
  method: 'data.fetch',       // The JSON-RPC method
  requestId: 123,             // The request ID
  originalError: 'Network error' // The original error message
}
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
