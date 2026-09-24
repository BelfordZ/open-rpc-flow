import { ValidationError } from '../errors';
import { ErrorCode } from '../errors/codes';
import { CheckpointError } from './errors';
import { CHECKPOINT_VERSION, FlowCheckpoint } from './types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Structurally validate an unknown value as a {@link FlowCheckpoint}.
 *
 * Unknown top-level fields are ignored so newer checkpoints stay readable;
 * every known field is checked strictly. All problems are collected and
 * reported together rather than failing on the first one.
 *
 * A checkpoint whose `version` is a valid integer but does not match
 * {@link CHECKPOINT_VERSION} is rejected with a `CheckpointError`
 * (`CHECKPOINT_VERSION_MISMATCH`) — it is structurally fine but this version
 * of the library cannot interpret it.
 *
 * @throws ValidationError when the value is not a well-formed checkpoint.
 * @throws CheckpointError when the checkpoint version is not supported.
 */
export function validateCheckpoint(value: unknown): FlowCheckpoint {
  if (!isPlainObject(value)) {
    throw new ValidationError('Invalid checkpoint: expected a plain object', {
      actualType: Array.isArray(value) ? 'array' : typeof value,
    });
  }
  const candidate = value as Record<string, unknown>;
  const problems: string[] = [];

  if (typeof candidate.version !== 'number' || !Number.isInteger(candidate.version)) {
    problems.push(`version must be an integer, got ${describe(candidate.version)}`);
  }
  if (typeof candidate.flowName !== 'string' || candidate.flowName.length === 0) {
    problems.push(`flowName must be a non-empty string, got ${describe(candidate.flowName)}`);
  }
  if (!isPlainObject(candidate.stepHashes)) {
    problems.push(`stepHashes must be an object, got ${describe(candidate.stepHashes)}`);
  } else {
    for (const [stepName, hash] of Object.entries(candidate.stepHashes)) {
      if (typeof hash !== 'string' || hash.length === 0) {
        problems.push(
          `stepHashes[${JSON.stringify(stepName)}] must be a non-empty string, got ${describe(hash)}`,
        );
      }
    }
  }
  if (typeof candidate.exportedAt !== 'string') {
    problems.push(`exportedAt must be a string, got ${describe(candidate.exportedAt)}`);
  }
  if (!isPlainObject(candidate.context)) {
    problems.push(`context must be an object, got ${describe(candidate.context)}`);
  }
  if (!isPlainObject(candidate.stepResults)) {
    problems.push(`stepResults must be an object, got ${describe(candidate.stepResults)}`);
  }
  if (!isPlainObject(candidate.stepStatus)) {
    problems.push(`stepStatus must be an object, got ${describe(candidate.stepStatus)}`);
  } else {
    for (const [stepName, status] of Object.entries(candidate.stepStatus)) {
      problems.push(...validateStepStatus(stepName, status));
    }
  }
  if (typeof candidate.lastFailedStepName !== 'string' && candidate.lastFailedStepName !== null) {
    problems.push(
      `lastFailedStepName must be a string or null, got ${describe(candidate.lastFailedStepName)}`,
    );
  }

  if (problems.length > 0) {
    throw new ValidationError(`Invalid checkpoint: ${problems.join('; ')}`, { problems });
  }

  const checkpoint = candidate as unknown as FlowCheckpoint;
  if (checkpoint.version !== CHECKPOINT_VERSION) {
    throw new CheckpointError(
      `Unsupported checkpoint version ${checkpoint.version}: this version of open-rpc-flow ` +
        `reads version ${CHECKPOINT_VERSION}. The checkpoint was exported by a different ` +
        `version and cannot be imported.`,
      {
        expectedVersion: CHECKPOINT_VERSION,
        actualVersion: checkpoint.version,
      },
      ErrorCode.CHECKPOINT_VERSION_MISMATCH,
    );
  }
  return checkpoint;
}

function validateStepStatus(stepName: string, status: unknown): string[] {
  const label = `stepStatus[${JSON.stringify(stepName)}]`;
  if (!isPlainObject(status)) {
    return [`${label} must be an object, got ${describe(status)}`];
  }
  const problems: string[] = [];
  if (status.status !== 'success' && status.status !== 'failed') {
    problems.push(`${label}.status must be 'success' or 'failed', got ${describe(status.status)}`);
  }
  if (status.error !== undefined) {
    if (!isPlainObject(status.error)) {
      problems.push(`${label}.error must be an object, got ${describe(status.error)}`);
    } else {
      if (typeof status.error.message !== 'string') {
        problems.push(`${label}.error.message must be a string`);
      }
      if (status.error.stack !== undefined && typeof status.error.stack !== 'string') {
        problems.push(`${label}.error.stack must be a string`);
      }
    }
  }
  return problems;
}

function describe(value: unknown): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  return typeof value;
}

/**
 * Values that `JSON.stringify` silently corrupts (or cannot represent at
 * all) and that must therefore never appear in a checkpoint.
 */
function nonSerializableKind(value: object): string | null {
  if (value instanceof Map) {
    return 'Map';
  }
  if (value instanceof Set) {
    return 'Set';
  }
  if (value instanceof WeakMap) {
    return 'WeakMap';
  }
  if (value instanceof WeakSet) {
    return 'WeakSet';
  }
  if (value instanceof Promise) {
    return 'Promise';
  }
  if (value instanceof ArrayBuffer) {
    return 'ArrayBuffer';
  }
  if (ArrayBuffer.isView(value)) {
    return 'typed array / DataView';
  }
  return null;
}

function formatPath(path: (string | number)[]): string {
  let out = '$';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)) {
      out += `.${segment}`;
    } else {
      out += `[${JSON.stringify(segment)}]`;
    }
  }
  return out;
}

/**
 * Assert that a value survives a JSON round trip without silent corruption.
 *
 * `JSON.stringify` *throws* on BigInts and circular references (loud), but
 * silently drops functions/symbols and mangles Maps, Sets, Promises, and
 * binary buffers into `{}` (quiet). This walk rejects the quiet cases up
 * front so `exportState()` fails fast with a precise path instead of
 * persisting a checkpoint that imports as something different.
 *
 * Allowed with documented normalization: `undefined` (dropped from objects,
 * `null` in arrays), `Date` (becomes an ISO string), `NaN`/`Infinity`
 * (become `null`), class instances (lose their prototype).
 *
 * @throws CheckpointError with code CHECKPOINT_NOT_SERIALIZABLE.
 */
export function assertJsonSerializable(value: unknown): void {
  const seen = new Set<object>();
  const stack: Array<{ value: unknown; path: (string | number)[] }> = [{ value, path: [] }];

  while (stack.length > 0) {
    const { value: current, path } = stack.pop() as {
      value: unknown;
      path: (string | number)[];
    };
    const location = formatPath(path);

    if (current === null || current === undefined) {
      continue;
    }
    const kind =
      typeof current === 'function'
        ? 'function'
        : typeof current === 'symbol'
          ? 'symbol'
          : typeof current === 'bigint'
            ? 'bigint'
            : typeof current === 'object'
              ? nonSerializableKind(current)
              : null;
    if (kind !== null) {
      throw new CheckpointError(
        `Checkpoint state is not JSON-serializable: ${location} holds a ${kind}, which ` +
          `cannot survive persistence. Convert it to plain data before exporting.`,
        {
          path: location,
          kind,
        },
        ErrorCode.CHECKPOINT_NOT_SERIALIZABLE,
      );
    }
    if (typeof current !== 'object') {
      continue;
    }
    if (seen.has(current)) {
      throw new CheckpointError(
        `Checkpoint state is not JSON-serializable: ${location} is circular. ` +
          `Remove the cycle before exporting.`,
        {
          path: location,
          kind: 'circular reference',
        },
        ErrorCode.CHECKPOINT_NOT_SERIALIZABLE,
      );
    }
    seen.add(current);
    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i--) {
        stack.push({ value: current[i], path: [...path, i] });
      }
    } else {
      const entries = Object.entries(current);
      for (let i = entries.length - 1; i >= 0; i--) {
        stack.push({ value: entries[i][1], path: [...path, entries[i][0]] });
      }
    }
  }
}
