import { EventEmitter } from 'events';
import { Step, StepExecutionContext, getStepType } from '../types';
import { StepExecutionResult } from '../step-executors';

/**
 * Event types emitted by the FlowExecutor
 */
export enum FlowEventType {
  FLOW_START = 'flow:start',
  FLOW_COMPLETE = 'flow:complete',
  FLOW_ERROR = 'flow:error',
  STEP_START = 'step:start',
  STEP_COMPLETE = 'step:complete',
  STEP_ERROR = 'step:error',
  STEP_SKIP = 'step:skip',
  DEPENDENCY_RESOLVED = 'dependency:resolved',
}

/**
 * Base interface for all flow events
 */
export interface FlowEvent {
  timestamp: number;
  type: FlowEventType;
}

/**
 * Flow start event
 */
export interface FlowStartEvent extends FlowEvent {
  type: FlowEventType.FLOW_START;
  flowName: string;
  orderedSteps: string[];
}

/**
 * Flow complete event
 */
export interface FlowCompleteEvent extends FlowEvent {
  type: FlowEventType.FLOW_COMPLETE;
  flowName: string;
  results: Record<string, any>;
  duration: number;
}

/**
 * Flow error event
 */
export interface FlowErrorEvent extends FlowEvent {
  type: FlowEventType.FLOW_ERROR;
  flowName: string;
  error: Error;
  duration: number;
}

/**
 * Step start event
 */
export interface StepStartEvent extends FlowEvent {
  type: FlowEventType.STEP_START;
  stepName: string;
  stepType: string;
  context?: Record<string, any>;
}

/**
 * Step complete event
 */
export interface StepCompleteEvent extends FlowEvent {
  type: FlowEventType.STEP_COMPLETE;
  stepName: string;
  stepType: string;
  result: any;
  duration: number;
}

/**
 * Step error event
 */
export interface StepErrorEvent extends FlowEvent {
  type: FlowEventType.STEP_ERROR;
  stepName: string;
  stepType: string;
  error: Error;
  duration: number;
}

/**
 * Step skip event
 */
export interface StepSkipEvent extends FlowEvent {
  type: FlowEventType.STEP_SKIP;
  stepName: string;
  reason: string;
}

/**
 * Dependency resolved event
 */
export interface DependencyResolvedEvent extends FlowEvent {
  type: FlowEventType.DEPENDENCY_RESOLVED;
  orderedSteps: string[];
}

/**
 * Configuration options for the flow event emitter
 */
export interface FlowEventOptions {
  /** Whether to emit flow-level events */
  emitFlowEvents?: boolean;
  /** Whether to emit step-level events */
  emitStepEvents?: boolean;
  /** Whether to emit dependency resolution events */
  emitDependencyEvents?: boolean;
  /** Whether to include result details in events */
  includeResults?: boolean;
  /** Whether to include context details in events */
  includeContext?: boolean;
}

/**
 * Default event options
 */
export const DEFAULT_EVENT_OPTIONS: FlowEventOptions = {
  emitFlowEvents: true,
  emitStepEvents: true,
  emitDependencyEvents: false,
  includeResults: true,
  includeContext: false,
};

/**
 * EventEmitter for FlowExecutor
 * Emits events during flow execution
 */
export class FlowExecutorEvents extends EventEmitter {
  private options: FlowEventOptions;

  constructor(options: Partial<FlowEventOptions> = {}) {
    super();
    this.options = { ...DEFAULT_EVENT_OPTIONS, ...options };
  }

  /**
   * Update event options
   */
  updateOptions(options: Partial<FlowEventOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /**
   * Emit flow start event
   */
  emitFlowStart(flowName: string, orderedSteps: string[]): void {
    if (!this.options.emitFlowEvents) return;

    this.emit(FlowEventType.FLOW_START, {
      timestamp: Date.now(),
      type: FlowEventType.FLOW_START,
      flowName,
      orderedSteps,
    } as FlowStartEvent);
  }

  /**
   * Emit flow complete event
   */
  emitFlowComplete(flowName: string, results: Map<string, any>, startTime: number): void {
    if (!this.options.emitFlowEvents) return;

    const resultsObj = this.options.includeResults
      ? Object.fromEntries(results.entries())
      : { stepCount: results.size };

    this.emit(FlowEventType.FLOW_COMPLETE, {
      timestamp: Date.now(),
      type: FlowEventType.FLOW_COMPLETE,
      flowName,
      results: resultsObj,
      duration: Date.now() - startTime,
    } as FlowCompleteEvent);
  }

  /**
   * Emit flow error event
   */
  emitFlowError(flowName: string, error: Error, startTime: number): void {
    if (!this.options.emitFlowEvents) return;

    this.emit(FlowEventType.FLOW_ERROR, {
      timestamp: Date.now(),
      type: FlowEventType.FLOW_ERROR,
      flowName,
      error,
      duration: Date.now() - startTime,
    } as FlowErrorEvent);
  }

  /**
   * Emit step start event
   */
  emitStepStart(
    step: Step,
    executionContext: StepExecutionContext,
    extraContext: Record<string, any> = {},
  ): void {
    if (!this.options.emitStepEvents) return;

    const context = this.options.includeContext
      ? { ...executionContext.context, ...extraContext }
      : undefined;

    const stepType = getStepType(step);

    this.emit(FlowEventType.STEP_START, {
      timestamp: Date.now(),
      type: FlowEventType.STEP_START,
      stepName: step.name,
      stepType,
      context,
    } as StepStartEvent);
  }

  /**
   * Emit step complete event
   */
  emitStepComplete(step: Step, result: StepExecutionResult, startTime: number): void {
    if (!this.options.emitStepEvents) return;

    const stepType = getStepType(step);
    const resultData = this.options.includeResults ? result : { type: result.type };

    this.emit(FlowEventType.STEP_COMPLETE, {
      timestamp: Date.now(),
      type: FlowEventType.STEP_COMPLETE,
      stepName: step.name,
      stepType,
      result: resultData,
      duration: Date.now() - startTime,
    } as StepCompleteEvent);
  }

  /**
   * Emit step error event
   */
  emitStepError(step: Step, error: Error, startTime: number): void {
    if (!this.options.emitStepEvents) return;

    const stepType = getStepType(step);

    this.emit(FlowEventType.STEP_ERROR, {
      timestamp: Date.now(),
      type: FlowEventType.STEP_ERROR,
      stepName: step.name,
      stepType,
      error,
      duration: Date.now() - startTime,
    } as StepErrorEvent);
  }

  /**
   * Emit step skip event
   */
  emitStepSkip(step: Step, reason: string): void {
    if (!this.options.emitStepEvents) return;

    this.emit(FlowEventType.STEP_SKIP, {
      timestamp: Date.now(),
      type: FlowEventType.STEP_SKIP,
      stepName: step.name,
      reason,
    } as StepSkipEvent);
  }

  /**
   * Emit dependency resolved event
   */
  emitDependencyResolved(orderedSteps: string[]): void {
    if (!this.options.emitDependencyEvents) return;

    this.emit(FlowEventType.DEPENDENCY_RESOLVED, {
      timestamp: Date.now(),
      type: FlowEventType.DEPENDENCY_RESOLVED,
      orderedSteps,
    } as DependencyResolvedEvent);
  }
}
