import { createHash } from 'crypto';
import { ValidationError } from '../errors';
import type { Flow } from '../types';

/**
 * Deterministic serialization with sorted object keys, so structurally
 * identical values always produce identical strings regardless of key
 * insertion order. Functions and symbols are rendered by name — they should
 * not appear in flow definitions, but they must not break hashing if they do.
 *
 * @throws ValidationError if the value contains circular references.
 */
export function stableStringify(value: unknown): string {
  const seen = new Set<object>();
  const stringify = (current: unknown): string => {
    if (current === null) {
      return 'null';
    }
    switch (typeof current) {
      case 'undefined':
        return 'undefined';
      case 'string':
        return JSON.stringify(current);
      case 'number':
      case 'boolean':
      case 'bigint':
        return String(current);
      case 'function':
        return `"[function ${(current as (...args: never[]) => unknown).name || 'anonymous'}]"`;
      case 'symbol':
        return JSON.stringify(String(current));
      case 'object':
        break;
    }
    const obj = current as object;
    if (seen.has(obj)) {
      throw new ValidationError('Cannot hash a value containing circular references', {
        valueType: Array.isArray(current) ? 'array' : 'object',
      });
    }
    seen.add(obj);
    try {
      if (Array.isArray(current)) {
        return `[${current.map(stringify).join(',')}]`;
      }
      const record = current as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${stringify(record[key])}`).join(',')}}`;
    } finally {
      seen.delete(obj);
    }
  };
  return stringify(value);
}

/**
 * Compatibility digest for a flow definition. Only the step definitions are
 * hashed: the flow name, description, context, and policies do not change what
 * recorded step results *mean*, so a renamed (or re-described) flow with
 * identical steps keeps the same hash and a checkpoint still imports.
 *
 * The digest is deterministic across processes and machines.
 */
export function hashFlow(flow: Flow): string {
  return createHash('sha256')
    .update(stableStringify({ steps: flow.steps }))
    .digest('hex');
}
