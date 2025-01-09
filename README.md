# Flow Execution Engine

A flexible and type-safe execution engine for JSON-RPC based workflows. This engine allows you to define complex flows of operations including requests, transformations, conditions, and loops, with full support for data dependencies and parallel execution.

## Features

- 🔄 **JSON-RPC Request Handling**: Execute JSON-RPC 2.0 requests with automatic request ID management
- 🔀 **Flow Control**: Support for conditional execution, loops, and parallel processing
- 🔄 **Data Transformation**: Transform data between steps using map, filter, reduce, and other operations
- 📊 **Expression Evaluation**: Dynamic expression evaluation with support for template literals and object paths
- 🔗 **Dependency Resolution**: Automatic handling of data dependencies between steps
- 🎯 **Type Safety**: Written in TypeScript with comprehensive type definitions
- ⚡ **Parallel Execution**: Automatic parallel execution of independent steps
- 🔍 **Error Handling**: Detailed error reporting and validation

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

// Define a flow
const flow: Flow = {
  name: 'Example Flow',
  description: 'Demonstrates basic flow functionality',
  steps: [
    {
      name: 'getData',
      request: {
        method: 'data.get',
        params: { id: 1 },
      },
    },
    {
      name: 'processData',
      transform: {
        input: '${getData}',
        operations: [
          {
            type: 'map',
            using: '{ id: item.id, value: item.value * 2 }',
          },
        ],
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

Execute JSON-RPC requests:

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
    input: '${getUser}',
    operations: [
      {
        type: 'map',
        using: '{ name: item.name, age: item.age }'
      },
      {
        type: 'filter',
        using: '${item.age} > 18'
      }
    ]
  }
}
```

### Conditional Steps

Execute steps based on conditions:

```typescript
{
  name: 'notifyIfAdmin',
  condition: {
    if: '${getUser.role} === "admin"',
    then: {
      name: 'sendNotification',
      request: {
        method: 'notification.send',
        params: { userId: '${getUser.id}' }
      }
    }
  }
}
```

### Loop Steps

Iterate over collections:

```typescript
{
  name: 'processItems',
  loop: {
    over: '${getItems}',
    as: 'item',
    step: {
      name: 'processItem',
      request: {
        method: 'item.process',
        params: { id: '${item.id}' }
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
- Comparisons: `${value} > 10`
- Object literals: `{ id: ${item.id}, name: ${item.name} }`

## Error Handling

The engine provides detailed error information:

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

// ... more type definitions available in the source
```

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
