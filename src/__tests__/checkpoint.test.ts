import {
  CHECKPOINT_VERSION,
  CheckpointError,
  FlowCheckpoint,
  assertJsonSerializable,
  hashFlow,
  stableStringify,
  validateCheckpoint,
} from '../checkpoint';
import { ValidationError } from '../errors';
import { ErrorCode } from '../errors/codes';
import type { Flow } from '../types';

function validCheckpoint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    flowName: 'my-flow',
    flowHash: 'deadbeef',
    exportedAt: new Date().toISOString(),
    context: {},
    stepResults: {},
    stepStatus: {},
    lastFailedStepName: null,
    ...overrides,
  };
}

function makeFlow(name: string, stepNames: string[]): Flow {
  return {
    name,
    description: `${name} description`,
    steps: stepNames.map((stepName) => ({
      name: stepName,
      request: { method: `m_${stepName}`, params: {} },
    })),
  };
}

describe('stableStringify', () => {
  it('is deterministic and sorts object keys', () => {
    const a = { z: 1, a: [3, 2, { y: 'x', b: true }] };
    const b = { a: [3, 2, { b: true, y: 'x' }], z: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('renders primitives distinctly', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('undefined');
    expect(stableStringify('hi')).toBe('"hi"');
    expect(stableStringify(42)).toBe('42');
    expect(stableStringify(true)).toBe('true');
    expect(stableStringify(10n)).toBe('10');
  });

  it('renders functions and symbols without throwing', () => {
    function namedFn(): void {}
    expect(stableStringify(namedFn)).toContain('namedFn');
    expect(stableStringify(() => {})).toContain('anonymous');
    expect(stableStringify(Symbol('s'))).toContain('s');
  });

  it('rejects circular references', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => stableStringify(circular)).toThrow(ValidationError);
    const arrCircular: unknown[] = [];
    arrCircular.push(arrCircular);
    expect(() => stableStringify(arrCircular)).toThrow(ValidationError);
  });
});

describe('hashFlow', () => {
  it('is deterministic across calls', () => {
    const flow = makeFlow('f', ['a', 'b']);
    expect(hashFlow(flow)).toBe(hashFlow(flow));
    expect(hashFlow(flow)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when a step definition changes', () => {
    const before = hashFlow(makeFlow('f', ['a', 'b']));
    const after = hashFlow(makeFlow('f', ['a', 'c']));
    expect(after).not.toBe(before);
  });

  it('ignores name, description, context, and policies', () => {
    const base = makeFlow('one', ['a']);
    const renamed: Flow = {
      ...base,
      name: 'two',
      description: 'different',
      context: { extra: 1 },
      policies: { global: {} },
    };
    expect(hashFlow(renamed)).toBe(hashFlow(base));
  });
});

describe('validateCheckpoint', () => {
  it('accepts a well-formed checkpoint and tolerates unknown fields', () => {
    const checkpoint = validateCheckpoint(
      validCheckpoint({
        futureField: 'ignored',
        stepStatus: {
          s1: { status: 'success' },
          s2: { status: 'failed', error: { message: 'boom', stack: 'stack...' } },
        },
        stepResults: { s1: { result: 1 } },
        lastFailedStepName: 's2',
      }),
    );
    expect(checkpoint.version).toBe(CHECKPOINT_VERSION);
    expect(checkpoint.stepStatus.s2.error?.message).toBe('boom');
  });

  it('accepts objects with a null prototype as plain objects', () => {
    const nullProto = Object.assign(Object.create(null), { a: 1 });
    const checkpoint = validateCheckpoint(validCheckpoint({ context: nullProto }));
    expect(checkpoint.context).toEqual({ a: 1 });
  });

  it('rejects non-object input', () => {
    for (const bad of [null, undefined, 42, 'nope', [{}], []]) {
      expect(() => validateCheckpoint(bad)).toThrow(ValidationError);
    }
  });

  it('collects every structural problem into one error', () => {
    const err = catchError(() =>
      validateCheckpoint({
        version: '1',
        flowName: '',
        flowHash: '',
        exportedAt: 123,
        context: [],
        stepResults: null,
        stepStatus: {
          ok: { status: 'success' },
          badStatus: { status: 'nope' },
          notObject: 7,
          badError: { status: 'failed', error: 'oops' },
          badMessage: { status: 'failed', error: { message: 42 } },
          badStack: { status: 'failed', error: { message: 'x', stack: 42 } },
        },
        lastFailedStepName: 42,
      }),
    );
    expect(err).toBeInstanceOf(ValidationError);
    const message = (err as Error).message;
    for (const fragment of [
      'version',
      'flowName',
      'flowHash',
      'exportedAt',
      'context',
      'stepResults',
      'badStatus',
      'notObject',
      'badError',
      'badMessage',
      'badStack',
      'lastFailedStepName',
    ]) {
      expect(message).toContain(fragment);
    }
  });

  it('rejects an unsupported version with a CheckpointError', () => {
    const err = catchError(() => validateCheckpoint(validCheckpoint({ version: 999 })));
    expect(err).toBeInstanceOf(CheckpointError);
    expect((err as CheckpointError).code).toBe(ErrorCode.CHECKPOINT_VERSION_MISMATCH);
    expect((err as CheckpointError).context.actualVersion).toBe(999);
  });
});

describe('assertJsonSerializable', () => {
  it('accepts plain JSON-shaped data', () => {
    expect(() =>
      assertJsonSerializable({
        a: [1, 'two', true, null, undefined, { nested: [NaN] }],
        date: new Date('2026-01-01T00:00:00.000Z'),
        instance: new (class Foo {
          x = 1;
        })(),
      }),
    ).not.toThrow();
  });

  it.each([
    ['function', () => {}, '$.stepResults["weird-key"].fn'],
    ['symbol', Symbol('s'), '$.stepResults["weird-key"].fn'],
    ['bigint', 10n, '$.stepResults["weird-key"].fn'],
    ['Map', new Map(), '$.stepResults["weird-key"].fn'],
    ['Set', new Set(), '$.stepResults["weird-key"].fn'],
    ['WeakMap', new WeakMap(), '$.stepResults["weird-key"].fn'],
    ['WeakSet', new WeakSet(), '$.stepResults["weird-key"].fn'],
    ['Promise', Promise.resolve(), '$.stepResults["weird-key"].fn'],
    ['ArrayBuffer', new ArrayBuffer(8), '$.stepResults["weird-key"].fn'],
    ['typed array', new Uint8Array(8), '$.stepResults["weird-key"].fn'],
  ])('rejects %s with a precise path', (_kind, badValue, expectedPath) => {
    const err = catchError(() =>
      assertJsonSerializable({ stepResults: { 'weird-key': { fn: badValue } } }),
    );
    expect(err).toBeInstanceOf(CheckpointError);
    expect((err as CheckpointError).code).toBe(ErrorCode.CHECKPOINT_NOT_SERIALIZABLE);
    expect((err as CheckpointError).context.path).toBe(expectedPath);
  });

  it('rejects circular references with their path', () => {
    const circular: Record<string, unknown> = { list: [] as unknown[] };
    (circular.list as unknown[]).push(circular);
    const err = catchError(() => assertJsonSerializable({ top: circular }));
    expect(err).toBeInstanceOf(CheckpointError);
    expect((err as CheckpointError).context.path).toBe('$.top.list[0]');
  });

  it('formats array indices and nested paths', () => {
    const err = catchError(() => assertJsonSerializable({ items: [{ deep: new Map() }] }));
    expect((err as CheckpointError).context.path).toBe('$.items[0].deep');
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected function to throw');
}

// Type-level sanity: FlowCheckpoint round-trips through JSON.
function _typeCheck(checkpoint: FlowCheckpoint): string {
  const restored = JSON.parse(JSON.stringify(checkpoint)) as FlowCheckpoint;
  return restored.flowName;
}
void _typeCheck;
