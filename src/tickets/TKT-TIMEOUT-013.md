# TKT-TIMEOUT-013: Update Flow Executor with Timeout Resolution Support

## Description

Update the FlowExecutor to support timeout resolution and propagation to step executors. This will ensure that timeouts are properly enforced throughout flow execution.

## Acceptance Criteria

- Update FlowExecutor to accept timeout configuration options
- Implement timeout resolution logic in the execution context creation
- Pass timeout information to step executors through the context
- Add a strategy for handling steps without explicit timeouts
- Add timeout information to execution logs
- Add tests for FlowExecutor timeout handling

## Proposed Implementation

```typescript
export class FlowExecutor {
  private readonly options: CompleteFlowExecutorOptions;

  constructor(options: FlowExecutorOptions = {}) {
    // Merge with default options
    this.options = {
      // Existing default options
      ...DEFAULT_OPTIONS,
      // New timeout options with defaults
      timeouts: {
        global: DEFAULT_GLOBAL_TIMEOUT,
        request: DEFAULT_REQUEST_TIMEOUT,
        transform: DEFAULT_TRANSFORM_TIMEOUT,
        branch: DEFAULT_BRANCH_TIMEOUT,
        loop: DEFAULT_LOOP_TIMEOUT,
        sequence: DEFAULT_SEQUENCE_TIMEOUT,
        parallel: DEFAULT_PARALLEL_TIMEOUT,
        ...options.timeouts,
      },
      // Other user options
      ...options,
    };

    // Create step executors
    // ... existing code ...
  }

  async execute(
    flow: Flow,
    initialContext: Record<string, any> = {},
  ): Promise<FlowExecutionResult> {
    try {
      // Validate flow
      // ... existing code ...

      // Create execution context with timeout information
      const context: StepExecutionContext = {
        initialContext,
        flowResults: {},
        // Resolve timeouts based on flow and global configuration
        ...this.resolveTimeouts(flow),
      };

      // Execute step with timeouts
      // ... existing code ...

      return {
        result,
        metadata: {
          flowId: flow.id,
          executionTime: Date.now() - startTime,
          // ... other metadata ...
        },
      };
    } catch (error) {
      // Handle errors, including timeout errors
      this.logError('Flow execution failed', error);
      throw error;
    }
  }

  /**
   * Resolve timeouts for the flow and create a timeout context
   */
  private resolveTimeouts(flow: Flow): { timeout: number | null } {
    // Get global timeouts from options
    const { timeouts: globalTimeouts } = this.options;

    // Get flow-level timeouts if defined
    const flowTimeouts = flow.timeouts || {};

    // Resolve the appropriate timeout for the flow's main step
    const mainStep = flow.steps[0];

    let timeout: number | null = null;

    // Step-level timeout has highest priority
    if (mainStep.timeout !== undefined) {
      timeout = mainStep.timeout;
    }
    // Then flow-level timeout for this step type
    else if (flowTimeouts[mainStep.type] !== undefined) {
      timeout = flowTimeouts[mainStep.type];
    }
    // Then flow-level global timeout
    else if (flowTimeouts.global !== undefined) {
      timeout = flowTimeouts.global;
    }
    // Then executor-level timeout for this step type
    else if (globalTimeouts[mainStep.type] !== undefined) {
      timeout = globalTimeouts[mainStep.type];
    }
    // Finally, executor-level global timeout
    else if (globalTimeouts.global !== undefined) {
      timeout = globalTimeouts.global;
    }

    // Log timeout configuration (if logging is enabled)
    if (this.options.logging) {
      this.log(
        `Resolved timeout for flow execution: ${timeout !== null ? `${timeout}ms` : 'none'}`,
      );
    }

    return { timeout };
  }

  // ... existing methods ...
}

/**
 * Extended options interface with timeout configuration
 */
export interface FlowExecutorOptions extends Partial<FlowExecutorDefaultOptions> {
  // Existing options

  /**
   * Timeout configuration for different step types
   */
  timeouts?: {
    /**
     * Global timeout for all steps (if not overridden)
     */
    global?: number | null;

    /**
     * Timeout for request steps
     */
    request?: number | null;

    /**
     * Timeout for transform steps
     */
    transform?: number | null;

    /**
     * Timeout for branch steps
     */
    branch?: number | null;

    /**
     * Timeout for loop steps
     */
    loop?: number | null;

    /**
     * Timeout for sequence steps
     */
    sequence?: number | null;

    /**
     * Timeout for parallel steps
     */
    parallel?: number | null;
  };
}
```

## Dependencies

- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces
- TKT-TIMEOUT-002: Define Default Timeout Values
- TKT-TIMEOUT-004: Implement Timeout Resolution Logic

## Estimation

3 story points (5-8 hours)
