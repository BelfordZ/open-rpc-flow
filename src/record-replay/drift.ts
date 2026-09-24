/**
 * Contract-drift detection: validates each recorded result against the
 * method's result schema from an OpenRPC document. A recorded fixture that
 * no longer matches the current API contract is reported, not thrown.
 * See issue #153.
 */
import Ajv from 'ajv';
import type { OpenRpcDocument, OpenRpcMethodDescriptor } from '../flow-doctor/types';
import { isRecordedError } from './replay';
import type { DriftReport, RecordedTrace } from './types';

/**
 * Validates every recorded result against its method's result schema.
 * Returns one report per schema violation. Entries are skipped (never
 * reported, never thrown) when: the method isn't in the document, the method
 * has no resolvable result schema, the schema fails to compile, or the entry
 * is a recorded error rather than a result.
 */
export function detectContractDrift(
  trace: RecordedTrace,
  openrpcDocument: OpenRpcDocument,
): DriftReport[] {
  const reports: DriftReport[] = [];
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  const methods = Array.isArray(openrpcDocument?.methods) ? openrpcDocument.methods : [];
  const methodByName = new Map<string, OpenRpcMethodDescriptor>();
  for (const method of methods) {
    if (method && typeof method.name === 'string') {
      methodByName.set(method.name, method);
    }
  }
  const ajv = new Ajv({ strict: false, allErrors: true });

  for (const entry of steps) {
    if (!entry || typeof entry.method !== 'string') {
      continue;
    }
    if (isRecordedError(entry.result)) {
      continue;
    }
    const method = methodByName.get(entry.method);
    const schema = method?.result?.schema;
    if (schema === undefined) {
      continue;
    }
    let validate: ReturnType<Ajv['compile']>;
    try {
      validate = ajv.compile(schema as object);
    } catch {
      continue; // Broken schema in the document; not the trace's fault.
    }
    let valid: boolean;
    try {
      valid = validate(entry.result);
    } catch {
      /* istanbul ignore next -- defensive: compiled schemas don't throw on JSON data */
      continue;
    }
    if (!valid && validate.errors) {
      for (const error of validate.errors) {
        reports.push({
          method: entry.method,
          path: error.instancePath,
          message: ajv.errorsText([error]),
        });
      }
    }
  }
  return reports;
}
