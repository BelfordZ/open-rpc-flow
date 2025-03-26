# TKT-TIMEOUT-014: Add Timeout Monitoring and Metrics

## Description
Implement timeout monitoring and metrics collection to provide visibility into execution times and near-timeouts. This will help users identify performance bottlenecks and optimize their flow configurations.

## Acceptance Criteria
- Create a TimeoutMonitor class to track execution times
- Add support for near-timeout alerts (e.g., 80% of timeout threshold)
- Collect timing metrics for different step types
- Add timeout statistics to execution results
- Implement optional callback for near-timeout events
- Add documentation for timeout monitoring features

## Proposed Implementation

```typescript
/**
 * Interface for timeout monitoring configuration
 */
export interface TimeoutMonitorOptions {
  /**
   * Threshold percentage for near-timeout alerts (0-100)
   * Default: 80 (alert at 80% of timeout threshold)
   */
  nearTimeoutThreshold?: number;
  
  /**
   * Callback function for near-timeout events
   */
  onNearTimeout?: (event: NearTimeoutEvent) => void;
  
  /**
   * Whether to collect detailed timing metrics
   * Default: true
   */
  collectMetrics?: boolean;
}

/**
 * Event data for near-timeout notifications
 */
export interface NearTimeoutEvent {
  stepName: string;
  stepType: StepType;
  timeout: number;
  elapsed: number;
  percentConsumed: number;
  timestamp: string;
}

/**
 * Execution timing metrics
 */
export interface TimeoutMetrics {
  /**
   * Step type execution times (in ms)
   */
  executionTimes: Record<StepType, number[]>;
  
  /**
   * Count of near-timeouts by step type
   */
  nearTimeouts: Record<StepType, number>;
  
  /**
   * Slowest step execution time
   */
  slowestExecution: {
    stepName: string;
    stepType: StepType;
    executionTime: number;
  };
  
  /**
   * Total flow execution time
   */
  totalExecutionTime: number;
}

/**
 * Monitors execution times and provides timeout-related metrics
 */
export class TimeoutMonitor {
  private readonly options: Required<TimeoutMonitorOptions>;
  private metrics: TimeoutMetrics;
  private startTime: number;
  
  constructor(options: TimeoutMonitorOptions = {}) {
    // Set default options
    this.options = {
      nearTimeoutThreshold: 80,
      onNearTimeout: () => {},
      collectMetrics: true,
      ...options,
    };
    
    // Initialize metrics
    this.metrics = {
      executionTimes: {
        [StepType.Request]: [],
        [StepType.Transform]: [],
        [StepType.Branch]: [],
        [StepType.Loop]: [],
        [StepType.Sequence]: [],
        [StepType.Parallel]: [],
      },
      nearTimeouts: {
        [StepType.Request]: 0,
        [StepType.Transform]: 0,
        [StepType.Branch]: 0,
        [StepType.Loop]: 0,
        [StepType.Sequence]: 0,
        [StepType.Parallel]: 0,
      },
      slowestExecution: {
        stepName: '',
        stepType: StepType.Request,
        executionTime: 0,
      },
      totalExecutionTime: 0,
    };
    
    // Start the monitor
    this.startTime = Date.now();
  }
  
  /**
   * Start monitoring a step execution
   */
  public startStep(step: Step): () => void {
    const stepStartTime = Date.now();
    
    // Return a function to call when step completes
    return () => {
      const executionTime = Date.now() - stepStartTime;
      
      // Update metrics
      if (this.options.collectMetrics) {
        this.metrics.executionTimes[step.type].push(executionTime);
        
        // Update slowest execution if this is slower
        if (executionTime > this.metrics.slowestExecution.executionTime) {
          this.metrics.slowestExecution = {
            stepName: step.name,
            stepType: step.type,
            executionTime,
          };
        }
      }
      
      return executionTime;
    };
  }
  
  /**
   * Check if a step is approaching its timeout threshold
   */
  public checkNearTimeout(step: Step, elapsed: number, timeout: number | null): void {
    // Skip if no timeout or near-timeout callback
    if (timeout === null || !this.options.onNearTimeout) return;
    
    // Calculate percentage of timeout consumed
    const percentConsumed = (elapsed / timeout) * 100;
    
    // Check if we've crossed the near-timeout threshold
    if (percentConsumed >= this.options.nearTimeoutThreshold) {
      // Increment near-timeout counter
      if (this.options.collectMetrics) {
        this.metrics.nearTimeouts[step.type]++;
      }
      
      // Trigger near-timeout event
      const event: NearTimeoutEvent = {
        stepName: step.name,
        stepType: step.type,
        timeout,
        elapsed,
        percentConsumed,
        timestamp: new Date().toISOString(),
      };
      
      this.options.onNearTimeout(event);
    }
  }
  
  /**
   * Get the collected metrics
   */
  public getMetrics(): TimeoutMetrics {
    // Update total execution time
    this.metrics.totalExecutionTime = Date.now() - this.startTime;
    
    return this.metrics;
  }
}
```

## Integration with FlowExecutor

```typescript
export class FlowExecutor {
  private readonly options: CompleteFlowExecutorOptions;
  private timeoutMonitor: TimeoutMonitor;
  
  constructor(options: FlowExecutorOptions = {}) {
    // Existing initialization code
    
    // Create timeout monitor
    this.timeoutMonitor = new TimeoutMonitor({
      nearTimeoutThreshold: options.timeoutMonitorOptions?.nearTimeoutThreshold,
      onNearTimeout: options.timeoutMonitorOptions?.onNearTimeout,
      collectMetrics: options.timeoutMonitorOptions?.collectMetrics,
    });
  }
  
  async execute(flow: Flow, initialContext: Record<string, any> = {}): Promise<FlowExecutionResult> {
    try {
      // Existing code
      
      // Add timeout monitor to context
      const context: StepExecutionContext = {
        // Existing context properties
        timeoutMonitor: this.timeoutMonitor,
      };
      
      // Execute flow
      const result = await this.executeStep(flow.steps[0], context);
      
      // Collect timeout metrics
      const timeoutMetrics = this.timeoutMonitor.getMetrics();
      
      return {
        result,
        metadata: {
          // Existing metadata
          timeoutMetrics,
        },
      };
    } catch (error) {
      // Existing error handling
    }
  }
  
  // In executeStep method, add monitoring
  private async executeStep(step: Step, context: StepExecutionContext): Promise<any> {
    // Start monitoring step execution
    const endMonitoring = this.timeoutMonitor.startStep(step);
    
    try {
      // Get the appropriate executor
      const executor = this.stepExecutors.get(step.type);
      if (!executor) {
        throw new Error(`No executor found for step type: ${step.type}`);
      }
      
      // Execute the step
      const result = await executor.execute(step, context);
      
      // End monitoring and get execution time
      const executionTime = endMonitoring();
      
      // Check for near-timeout conditions
      const timeout = (context as any).timeout;
      if (timeout !== null) {
        this.timeoutMonitor.checkNearTimeout(step, executionTime, timeout);
      }
      
      return result;
    } catch (error) {
      // End monitoring even if there's an error
      endMonitoring();
      throw error;
    }
  }
}
```

## Dependencies
- TKT-TIMEOUT-001: Define Timeout Configuration Interfaces
- TKT-TIMEOUT-013: Update Flow Executor with Timeout Resolution Support

## Estimation
4 story points (8-12 hours) 