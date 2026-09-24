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
- 🌍 **Context Management**: Read-only global context available to all steps with proper scoping
- 📦 **Batch Processing**: Support for processing data in configurable batch sizes

## Examples

### 1. Team Member Processing

Process team members with nested operations and dynamic notifications. See the full example here:

[**src/examples/03-nested-loops.json**](src/examples/03-nested-loops.json)

---

### 2. Data Pipeline with Error Recovery

Process data with validation, transformation, and error handling. See the full example here:

[**src/examples/05-complex-data-pipeline.json**](src/examples/05-complex-data-pipeline.json)

---

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

### 4. Stop Flow Execution

Demonstrates halting a flow when a condition is met. See the full example here:

[**src/examples/06-stop-flow.json**](src/examples/06-stop-flow.json)

---

### 5. Timeouts and Retries

Handle flaky endpoints with retry policies and step-level timeouts. See the full example here:

[**src/examples/07-retry-timeout.json**](src/examples/07-retry-timeout.json)

### 6. Abortable Requests

Integrate `AbortSignal` to cancel long running requests.

[**src/examples/abort-signal-example.ts**](src/examples/abort-signal-example.ts)

### 7. Resume and Retry with Seeded State

Resume a partially completed flow or retry from a failure without re-running completed
work. This is useful when restoring execution state from a job queue or database.

[**src/examples/resume-retry-example.ts**](src/examples/resume-retry-example.ts)

## Installation

```bash
npm install open-rpc-flow
```

## Quick Start

Here's a simple example of defining and executing a flow:

```typescript
import { FlowExecutor, Flow } from 'open-rpc-flow';

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

// Context is treated as immutable input; use step results to pass derived data.

// Execute the flow
const executor = new FlowExecutor(flow, jsonRpcHandler);
const results = await executor.execute();
```

You can reset context between runs:

```typescript
executor.setContext({ minValue: 20 });
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

#### Parallel iterations

Loop iterations run concurrently by default. The engine automatically falls
back to sequential execution when the body depends on ordering:

- reading `metadata.iteration` (the current iteration index),
- referencing the loop's own accumulated result,
- or containing a `stop` step.

Results are always collected in iteration order, regardless of completion
order, and each iteration gets an isolated context (`${item}`,
`metadata.current`, etc.). Nested loops decide independently, so an inner
loop can run sequentially inside a parallel outer loop and vice versa.

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

#### Error Handling with Retry

Enable automatic retries for failed request steps:

```typescript
const executor = new FlowExecutor(flow, jsonRpcHandler, {
  // Enable retry policy
  enableRetries: true,
  // Configure retry policy (or use DEFAULT_RETRY_POLICY)
  retryPolicy: {
    maxAttempts: 3, // Retry up to 3 times
    backoff: {
      initial: 100, // 100ms initial delay
      multiplier: 2, // Exponential backoff
      maxDelay: 5000, // Maximum 5s delay
    },
    retryableErrors: [ErrorCode.NETWORK_ERROR, ErrorCode.TIMEOUT_ERROR],
  },
});
```

### Resume, Retry, and State Seeding

You can safely seed context and prior step results before calling `resume()` or `retry()`.

- `setContext(context)` replaces the execution context used by references like
  `${context.foo}`.
- `setStepResults(results)` seeds completed step outputs and marks those steps as successful.
- `resume()` starts from the step after the last successful step.
- `retry()` starts from the last failed step and clears results for that step and all following
  steps.

```typescript
const executor = new FlowExecutor(flow, jsonRpcHandler);

// Typically loaded from durable storage
executor.setContext({ requestId: 'req-123', actorId: 'user-42' });
executor.setStepResults({
  fetchProfile: { result: { id: 'user-42', status: 'active' } },
});

// Continue from the next unfinished step
const resumedResults = await executor.resume();

// If a later run fails, retry from the last failed step
const retriedResults = await executor.retry();
```

See [**src/examples/resume-retry-example.ts**](src/examples/resume-retry-example.ts) for a
complete, runnable example that shows how to snapshot and restore state.

#### Durable Checkpoints

For resume across processes or machines, export a versioned, JSON-serializable
checkpoint and import it into a fresh executor later:

```typescript
const executor = new FlowExecutor(flow, jsonRpcHandler);
try {
  await executor.execute();
} catch {
  // Persist this JSON — new process, new machine, hours later…
  await db.save('run-123', JSON.stringify(executor.exportState()));
}

// …later, possibly in a different process:
const executor2 = new FlowExecutor(flow, jsonRpcHandler);
executor2.importState(JSON.parse(await db.load('run-123')));
await executor2.execute(); // skips completed steps, re-runs the failed step
```

- `exportState()` returns a `FlowCheckpoint`: deeply isolated from executor
  internals and JSON-normalized, so the persisted form is exactly what imports.
  Step results and context must be JSON-serializable — functions, `Map`s,
  `BigInt`s, and circular references throw a `CheckpointError`
  (`CHECKPOINT_NOT_SERIALIZABLE`) naming the offending path instead of
  silently corrupting the snapshot.
- `importState()` validates the checkpoint and reconciles it with the current
  flow per step: unchanged steps keep their recorded progress and stay
  skipped, steps added after export simply run, and a recorded step whose
  definition changed is treated as fixed — its recorded results are discarded
  so it re-runs, along with the steps that depend on it. A recorded step that
  no longer exists is dropped with a warning. An unsupported `version` still
  throws a `CheckpointError` instead of silently misbehaving.
- **Observability:** importing logs what reconciliation did (info for changed
  steps and their invalidated dependents, warnings for removed steps or a
  renamed flow). The resumed `execute()` logs one info line naming the
  completed steps it skips and the failed step it re-runs, so a resumed run is
  auditable without per-step noise.
- **Versioning:** checkpoints are versioned (`CHECKPOINT_VERSION`, currently
  2). The schema moved from one flow-wide digest to a digest per step, so
  checkpoints exported by older versions are rejected with
  `CHECKPOINT_VERSION_MISMATCH` — re-run to export a fresh checkpoint.
- **Idempotency warning:** resuming re-runs the failed step and every step that
  never completed. Steps that already succeeded are never re-run — make sure
  re-executed steps are safe to run again.

#### Record & Replay (What-If Overrides)

Record a run's JSON-RPC traffic, then replay the flow offline — no network —
with optional path-keyed what-if overrides. Resume (above) and replay share
the checkpoint/digest substrate, but they are separate operations: resume
trusts and skips completed steps at the scheduler layer, while replay re-runs
step logic and mocks each call from a recorded trace.

```typescript
import {
  createRecordingHandler,
  createReplayHandler,
  overrideSequence,
} from '@open-rpc/flow-executor';

// 1. Record: wrap the real handler once.
const { handler: recorder, getTrace } = createRecordingHandler(jsonRpcHandler);
await new FlowExecutor(flow, recorder).execute();
const trace = getTrace('MyFlow'); // JSON-serializable RecordedTrace

// 2. Replay: no network is touched. Each replayed call is matched by its
// execution path (e.g. "processUsers[2].fetchUser"), so loop iterations and
// nested sub-steps get their own replay cursors regardless of how the
// original calls interleaved.
const replay = createReplayHandler(trace);
await new FlowExecutor(flow, replay).execute();
```

- **What-if overrides** replace responses by execution path, without
  re-running anything upstream:

  ```typescript
  // What if user #42 is flagged? Only that iteration's call changes.
  const replay = createReplayHandler(trace, {
    overrides: { 'processUsers[0].fetchUser': { id: 42, flagged: true } },
  });

  // What if the retry policy kicks in? Serve an ordered response script —
  // an item shaped like a recorded error re-throws as JsonRpcRequestError.
  const flaky = createReplayHandler(trace, {
    overrides: {
      fetchUser: overrideSequence(
        { error: { message: 'timeout', code: -32000 } },
        { error: { message: 'timeout', code: -32000 } },
        { id: 1, recovered: true },
      ),
    },
  });
  ```

  An override may also be a plain array — it is served as a single
  array-valued response. Only `overrideSequence(...)` is a response script.
  When any override is present, parameter matching is relaxed for downstream
  calls, since substituted results can legitimately alter downstream
  requests; without overrides, calls must match recorded params exactly.

- **Divergence is explicit.** More replay calls than recorded, a brand-new
  execution path (e.g. an iteration that never ran during recording), a
  method mismatch, or an exhausted response script all throw `ReplayError` —
  there is no live-network fallback. Fewer replay calls than recorded are
  reported by `replay.getReplayReport()` (`consumed` / `unconsumed`), and
  `strict: true` turns unconsumed entries into an error when the report is
  requested.
- **Serialization is strict.** Traces only carry JSON-safe values —
  `undefined` records as `null`, and circular references, `BigInt`s, and
  functions throw instead of silently degrading.
- **Stale steps are detectable.** `validateTraceForFlow(trace, stepHashes)`
  throws a `ReplayError` naming any recorded step whose definition changed
  since recording, using the same per-step digests as durable checkpoints.

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

The flow executor exposes a `FlowExecutorEvents` instance built on Node's
`EventEmitter`. It emits strongly typed events during execution so you can
monitor progress, log information or integrate with external systems in real
time. All event names are available through the `FlowEventType` enum.

### Using the Event Emitter

```typescript
import { FlowExecutor, FlowEventType } from 'open-rpc-flow';

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

See [**src/examples/event-emitter-example.ts**](src/examples/event-emitter-example.ts)
for a full working example.

### Available Events

| Event Type            | Description                                        |
| --------------------- | -------------------------------------------------- |
| `flow:start`          | Emitted when flow execution begins                 |
| `flow:complete`       | Emitted when flow execution completes successfully |
| `flow:error`          | Emitted when flow execution fails                  |
| `flow:aborted`        | Emitted when flow execution is externally aborted  |
| `flow:paused`         | Emitted when `executor.pause()` interrupts a flow  |
| `flow:timeout`        | Emitted when global flow timeout is reached        |
| `step:start`          | Emitted when a step execution begins               |
| `step:complete`       | Emitted when a step execution completes            |
| `step:error`          | Emitted when a step execution fails                |
| `step:skip`           | Emitted when a step is skipped                     |
| `step:progress`       | Emitted to report progress of long-running steps   |
| `dependency:resolved` | Emitted when dependencies are resolved             |

### Event Payloads

Each emitted event carries a typed payload. Below is a quick reference of the
most useful fields:

| Event           | Key fields                                                        |
| --------------- | ----------------------------------------------------------------- |
| `flow:start`    | `flowName`, `orderedSteps`                                        |
| `flow:complete` | `flowName`, `results`, `duration`                                 |
| `flow:error`    | `flowName`, `error`, `duration`                                   |
| `flow:aborted`  | `flowName`, `reason`                                              |
| `flow:paused`   | `flowName`, `reason`                                              |
| `flow:timeout`  | `flowName`, `timeout`, `duration`                                 |
| `step:start`    | `stepName`, `stepType`, `context?`                                |
| `step:complete` | `stepName`, `stepType`, `result`, `duration`                      |
| `step:error`    | `stepName`, `stepType`, `error`, `duration`                       |
| `step:progress` | `stepName`, `stepType`, `iteration`, `totalIterations`, `percent` |

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

## Development

This project requires **Node.js 22.15.0** as specified in the `.node-version` file. The CI pipeline tests against Node **18.x**, **20.x**, **21.x**, and **22.x**.

After cloning the repository, install dependencies and run the build and tests:

```bash
npm install
npm run build
npm test
```

## License

This project is licensed under the MIT License, see the [LICENSE](LICENSE) file for details.
