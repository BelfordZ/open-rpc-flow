# TKT-TIMEOUT-017: Add Timeout-Related Documentation and Examples

## Description

Add comprehensive documentation and examples for the timeout feature to ensure users understand how to effectively configure and use timeouts in their flows.

## Acceptance Criteria

- Update the README.md with a dedicated timeout configuration section
- Include examples of timeout configuration at different levels
- Document default timeout values and behavior
- Provide best practices for timeout configuration
- Create example flows demonstrating timeout handling
- Add documentation for timeout error handling and retry configuration
- Include timeout monitoring and metrics documentation

## Proposed Documentation Updates

The documentation should include the following sections:

### Timeout Configuration

````markdown
## Timeout Configuration

The Flow Execution Engine provides a flexible system for configuring timeouts at different levels:

### Multi-Level Timeout Configuration

Timeouts can be configured at three levels, in order of precedence:

1. **Step-Level Timeouts**: Applied to specific steps
2. **Flow-Level Timeouts**: Applied to all steps of a given type within a flow
3. **Global Timeouts**: Applied to all steps of a given type across all flows

This hierarchy allows for precise control over execution times.

### Default Timeout Values

The system comes with the following default timeout values:

| Step Type | Default Timeout |
| --------- | --------------- |
| Global    | 60000ms (60s)   |
| Request   | 30000ms (30s)   |
| Transform | 5000ms (5s)     |
| Branch    | 10000ms (10s)   |
| Loop      | 60000ms (60s)   |
| Sequence  | 30000ms (30s)   |
| Parallel  | 30000ms (30s)   |

These defaults can be overridden at any level.

### Configuring Timeouts

#### Global Timeouts in FlowExecutor

When initializing the FlowExecutor, you can set global timeout values:

```typescript
const executor = new FlowExecutor({
  timeouts: {
    global: 30000, // 30 seconds global timeout
    request: 10000, // 10 seconds for request steps
    transform: 3000, // 3 seconds for transform steps
    loop: 60000, // 60 seconds for loop steps
  },
});
```
````

#### Flow-Level Timeouts

Configure timeouts for a specific flow:

```typescript
const flow = new Flow()
  .name('My Flow')
  // Set global timeout for this flow
  .setTimeout(45000) // 45 seconds
  // Set timeouts for specific step types in this flow
  .setTimeouts({
    [StepType.Request]: 15000, // 15 seconds for requests
    [StepType.Transform]: 5000, // 5 seconds for transformations
  });
```

#### Step-Level Timeouts

Set a timeout for an individual step:

```typescript
const flow = new Flow()
  .addStep(
    new Step()
      .name('fetchData')
      .type(StepType.Request)
      .request({
        method: 'eth_getBalance',
        params: ['0x407d73d8a49eeb85d32cf465507dd71d507100c1', 'latest'],
      }),
  )
  // Set timeout for a specific step
  .setStepTimeout('fetchData', 5000); // 5 seconds timeout for this step
```

### Timeout Error Handling

When a step exceeds its timeout, a `TimeoutError` is thrown. This error includes:

- The step name where the timeout occurred
- The configured timeout value
- The actual elapsed time
- Additional context specific to the step type

Timeout errors can be retried based on your retry policy configuration:

```typescript
const executor = new FlowExecutor({
  retryPolicy: {
    timeoutRetry: {
      maxRetries: 3, // Maximum retries for timeout errors
      resetTimeout: true, // Reset the timer for each retry
      timeoutMultiplier: 1.5, // Increase timeout by 50% on retries
      backoffStrategy: BackoffStrategy.Exponential,
    },
  },
});
```

### Timeout Monitoring

The engine includes timeout monitoring capabilities that help identify potential performance issues:

```typescript
const executor = new FlowExecutor({
  timeoutMonitorOptions: {
    nearTimeoutThreshold: 80, // Alert at 80% of timeout threshold
    onNearTimeout: (event) => {
      console.warn(
        `Step ${event.stepName} is approaching timeout: ${event.percentConsumed}% of limit used`,
      );
    },
  },
});

// After execution, get timeout metrics
const result = await executor.execute(flow);
console.log(result.metadata.timeoutMetrics);
```

### Best Practices

1. **Set Appropriate Timeouts**: Consider the nature of each operation when setting timeouts.
2. **Use Hierarchical Configuration**: Set reasonable defaults at the global level, refine at the flow level, and fine-tune at the step level.
3. **Monitor Near-Timeouts**: Use the monitoring system to identify steps that are approaching their timeout limits.
4. **Implement Retry Strategies**: Configure retry policies specifically for timeout errors, especially for network operations.
5. **Consider Fallbacks**: For critical operations that might time out, implement fallback mechanisms.

````

## Example Flow

Create a new example file `src/examples/timeout-handling-example.ts` with a flow that demonstrates timeout configuration and handling:

```typescript
import { Flow, Step, StepType, FlowExecutor } from '../index';

// Example flow with timeout configuration
export const timeoutConfigurationFlow = new Flow()
  .id('timeout-configuration-example')
  .name('Timeout Configuration Example')
  .description('Demonstrates how to configure timeouts at different levels')

  // Set a global timeout for all steps in this flow
  .setTimeout(30000) // 30 seconds

  // Set specific timeouts for different step types
  .setTimeouts({
    [StepType.Request]: 10000,  // 10 seconds for all request steps
    [StepType.Transform]: 5000, // 5 seconds for all transform steps
  })

  // Add a request step
  .addStep(
    new Step()
      .name('fetchBlockNumber')
      .type(StepType.Request)
      .request({
        method: 'eth_blockNumber',
        params: [],
      })
  )

  // Add a transform step
  .addStep(
    new Step()
      .name('processBlock')
      .type(StepType.Transform)
      .expression('parseInt(context.flowResults.fetchBlockNumber.result, 16)')
  )

  // Add a request step with a specific timeout
  .addStep(
    new Step()
      .name('fetchBalance')
      .type(StepType.Request)
      .request({
        method: 'eth_getBalance',
        params: ['0x407d73d8a49eeb85d32cf465507dd71d507100c1', 'latest'],
      })
  )
  // Set a specific timeout for this step
  .setStepTimeout('fetchBalance', 15000) // 15 seconds

  // Add a final transform step
  .addStep(
    new Step()
      .name('formatResults')
      .type(StepType.Transform)
      .expression(`{
        blockNumber: context.flowResults.processBlock.result,
        balance: parseInt(context.flowResults.fetchBalance.result, 16) / 1e18
      }`)
  );

// Example function to execute the flow with timeout monitoring
export async function executeTimeoutExample(jsonRpcUrl: string) {
  // Create executor with timeout monitoring
  const executor = new FlowExecutor({
    transport: {
      type: 'http',
      url: jsonRpcUrl,
    },
    timeouts: {
      global: 60000, // 60 seconds global timeout
    },
    timeoutMonitorOptions: {
      nearTimeoutThreshold: 75,
      onNearTimeout: (event) => {
        console.warn(`⚠️ Near timeout: Step ${event.stepName} has used ${event.percentConsumed.toFixed(1)}% of its ${event.timeout}ms timeout`);
      },
      collectMetrics: true,
    },
    logging: true,
  });

  console.log('Executing flow with timeout configuration...');

  try {
    const result = await executor.execute(timeoutConfigurationFlow);

    console.log('Flow execution successful!');
    console.log('Result:', result.result);

    // Display timeout metrics
    const metrics = result.metadata.timeoutMetrics;
    console.log('\nTimeout Metrics:');
    console.log(`- Total execution time: ${metrics.totalExecutionTime}ms`);
    console.log(`- Slowest step: ${metrics.slowestExecution.stepName} (${metrics.slowestExecution.executionTime}ms)`);
    console.log(`- Request step average: ${calculateAverage(metrics.executionTimes[StepType.Request])}ms`);
    console.log(`- Transform step average: ${calculateAverage(metrics.executionTimes[StepType.Transform])}ms`);

    return result;
  } catch (error) {
    console.error('Flow execution failed:', error.message);

    if (error.name === 'TimeoutError') {
      console.error(`Timeout occurred in step: ${error.stepName}`);
      console.error(`Configured timeout: ${error.timeout}ms`);
      console.error(`Actual elapsed time: ${error.elapsed}ms`);
    }

    throw error;
  }
}

// Helper to calculate average execution time
function calculateAverage(times: number[]): number {
  if (times.length === 0) return 0;
  const sum = times.reduce((total, time) => total + time, 0);
  return Math.round(sum / times.length);
}
````

## Dependencies

- TKT-TIMEOUT-016: Add Timeout Support to Flow API
- TKT-TIMEOUT-014: Add Timeout Monitoring and Metrics

## Estimation

3 story points (5-8 hours)
