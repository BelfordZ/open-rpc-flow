/**
 * Flow Doctor types: static (semantic) validation of a flow against its
 * OpenRPC document. See issue #151.
 *
 * The OpenRPC interfaces below are intentionally minimal structural types —
 * only the surface Flow Doctor reads. A full OpenRPC document is assignable
 * to them; no `@open-rpc/*` dependency is required.
 */

/** A parameter descriptor as found in an OpenRPC method object. */
export interface OpenRpcParamDescriptor {
  name: string;
  required?: boolean;
  schema?: unknown;
  [key: string]: unknown;
}

/** A method object as found in an OpenRPC document. */
export interface OpenRpcMethodDescriptor {
  name: string;
  params?: OpenRpcParamDescriptor[];
  result?: {
    schema?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Minimal structural type for the OpenRPC document Flow Doctor validates against. */
export interface OpenRpcDocument {
  openrpc: string;
  info: {
    title: string;
    version: string;
    [key: string]: unknown;
  };
  methods: OpenRpcMethodDescriptor[];
  [key: string]: unknown;
}

export type FlowDiagnosticSeverity = 'error' | 'warning';

/**
 * A single step-scoped finding from Flow Doctor.
 */
export interface FlowDiagnostic {
  /** Name of the step the diagnostic belongs to. */
  step: string;
  severity: FlowDiagnosticSeverity;
  /** Machine-readable code, e.g. 'UNKNOWN_METHOD'. */
  code: string;
  message: string;
}

/** Diagnostic codes emitted by {@link validateFlow}. */
export const FlowDiagnosticCode = {
  /** Two steps share the same name; references would be ambiguous. */
  DUPLICATE_STEP_NAME: 'DUPLICATE_STEP_NAME',
  /** A request step calls a method not present in the OpenRPC document. */
  UNKNOWN_METHOD: 'UNKNOWN_METHOD',
  /** A required method param has no value in the step's params. */
  MISSING_REQUIRED_PARAM: 'MISSING_REQUIRED_PARAM',
  /** A static param value does not match the method's param schema. */
  PARAM_SCHEMA_MISMATCH: 'PARAM_SCHEMA_MISMATCH',
  /** An expression references a step name that does not exist. */
  UNKNOWN_STEP_REFERENCE: 'UNKNOWN_STEP_REFERENCE',
  /** An expression reads a property absent from the upstream result schema. */
  UNKNOWN_RESULT_PROPERTY: 'UNKNOWN_RESULT_PROPERTY',
  /** A step's onError recovery config is structurally invalid. */
  INVALID_ON_ERROR: 'INVALID_ON_ERROR',
} as const;

export type FlowDiagnosticCode = (typeof FlowDiagnosticCode)[keyof typeof FlowDiagnosticCode];
