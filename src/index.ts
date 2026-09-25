/* istanbul ignore file */
export { Flow, Step, JsonRpcRequest, StepExecutionContext, FlowInput } from './types';
export {
  StepExecutor,
  StepExecutionResult,
  StepType,
  JsonRpcRequestError,
  RequestStepExecutor,
  LoopStepExecutor,
  ConditionStepExecutor,
  TransformStepExecutor,
  DelayStepExecutor,
  StopStepExecutor,
} from './step-executors';
export {
  FlowExecutor,
  FlowExecutorOptions,
  ExecuteOptions,
  DEFAULT_RETRY_POLICY,
} from './flow-executor';
export {
  FlowCheckpoint,
  CheckpointStepError,
  CheckpointStepStatus,
  CheckpointError,
  CHECKPOINT_VERSION,
  hashFlow,
  hashStep,
  validateCheckpoint,
} from './checkpoint';
export {
  validateFlow,
  FlowDiagnostic,
  FlowDiagnosticCode,
  FlowDiagnosticSeverity,
  OpenRpcDocument,
  OpenRpcMethodDescriptor,
  OpenRpcParamDescriptor,
} from './flow-doctor';
export {
  MockJsonRpcHandler,
  MockJsonRpcHandlerFn,
  MockJsonRpcHandlerOptions,
  MockedCall,
  generateFromSchema,
} from './mock-handler';
export { SafeExpressionEvaluator } from './expression-evaluator/safe-evaluator';
export {
  ReferenceResolver,
  ReferenceResolverError,
  UnknownReferenceError,
  InvalidReferenceError,
  ReferenceResolutionError,
  CircularReferenceError,
} from './reference-resolver';
export {
  PathAccessor,
  PathSegment,
  PathAccessorError,
  PathSyntaxError,
  PropertyAccessError,
  InvalidPathError,
} from './path-accessor';
export {
  DependencyResolver,
  DependencyResolverError,
  StepNotFoundError,
  UnknownDependencyError,
  CircularDependencyError,
} from './dependency-resolver';
export {
  FlowExecutorEvents,
  FlowEventType,
  FlowEvent,
  FlowStartEvent,
  FlowCompleteEvent,
  FlowErrorEvent,
  FlowTimeoutEvent,
  StepStartEvent,
  StepCompleteEvent,
  StepErrorEvent,
  StepSkipEvent,
  StepProgressEvent,
  StepAbortedEvent,
  FlowAbortedEvent,
  FlowPausedEvent,
  StepRetryEvent,
  StepTimeoutEvent,
  DependencyResolvedEvent,
  FlowEventOptions,
} from './util/flow-executor-events';
export { NoLogger, noLogger } from './util/no-logger';

// Export error handling related types
export {
  FlowError,
  ExecutionError,
  ValidationError,
  TimeoutError,
  StateError,
  PauseError,
  ResetError,
} from './errors';
export { ErrorCode, ErrorCategory } from './errors/codes';
export { RetryPolicy, RetryableOperation } from './errors/recovery';
export {
  createRecordingHandler,
  createReplayHandler,
  detectContractDrift,
  isRecordedError,
  overrideSequence,
  validateTraceForFlow,
  ReplayError,
  ReplaySequence,
  RecordedCall,
  RecordedError,
  RecordedTrace,
  ReplayOptions,
  ReplayReport,
  ReplayHandler,
  DriftReport,
} from './record-replay';

import metaSchemaContent from '../meta-schema.json';
export const metaSchema = metaSchemaContent;

// Logger utilities: pass a `logger` option to FlowExecutor to control output.
export { ConsoleLogger, Logger, LogLevel } from './util/logger';
