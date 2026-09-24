import { ValidationError } from '../errors/base';
import {
  didYouMean,
  extractReferencePaths,
  OpenRpcDocument,
  referenceBase,
  splitPathSegments,
  validateFlow,
} from '../flow-doctor';
import { FlowExecutor } from '../flow-executor';
import type { Flow } from '../types';

const testDocument: OpenRpcDocument = {
  openrpc: '1.2.6',
  info: { title: 'Test API', version: '1.0.0' },
  methods: [
    {
      name: 'getUser',
      params: [
        { name: 'id', required: true, schema: { type: 'integer' } },
        { name: 'verbose', required: false, schema: { type: 'boolean' } },
      ],
      result: {
        schema: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name: { type: 'string' },
          },
        },
      },
    },
    {
      name: 'listUsers',
      params: [{ name: 'limit', schema: { type: 'integer' } }],
      result: { schema: { type: 'array', items: { type: 'object' } } },
    },
    {
      name: 'ping',
      params: [],
      result: { schema: { type: 'string' } },
    },
  ],
};

const requestStep = (
  name: string,
  method: string,
  params: Record<string, unknown> | unknown[] = {},
): any => ({
  name,
  request: { method, params },
});

const makeFlow = (steps: any[]): Flow => ({
  name: 'test-flow',
  description: 'test flow',
  steps,
});

describe('extractReferencePaths', () => {
  it('returns an empty list when there are no references', () => {
    expect(extractReferencePaths('plain string')).toEqual([]);
  });

  it('extracts a single reference', () => {
    expect(extractReferencePaths('hello ${getUser.result.id} world')).toEqual([
      'getUser.result.id',
    ]);
  });

  it('extracts multiple references', () => {
    expect(extractReferencePaths('${a} and ${b.c}')).toEqual(['a', 'b.c']);
  });

  it('handles nested references', () => {
    expect(extractReferencePaths("${lookup.result[steps['a'].index]}")).toEqual([
      "lookup.result[steps['a'].index]",
    ]);
  });

  it('handles a reference nested inside another reference', () => {
    expect(extractReferencePaths('a ${outer.${inner}.x} b')).toEqual(['outer.${inner}.x']);
  });

  it('ignores unbalanced references', () => {
    expect(extractReferencePaths('broken ${a.b')).toEqual([]);
  });

  it('trims whitespace inside the braces', () => {
    expect(extractReferencePaths('${  getUser.result  }')).toEqual(['getUser.result']);
  });
});

describe('referenceBase', () => {
  it('returns the part before the first dot', () => {
    expect(referenceBase('getUser.result.id')).toBe('getUser');
  });

  it('returns the whole path when there is no dot', () => {
    expect(referenceBase('getUser')).toBe('getUser');
  });

  it('handles bracket notation', () => {
    expect(referenceBase("steps['a b']")).toBe('steps');
  });
});

describe('splitPathSegments', () => {
  it('splits dot notation', () => {
    expect(splitPathSegments('a.b.c')).toEqual(['a', 'b', 'c']);
  });

  it('splits quoted bracket keys', () => {
    expect(splitPathSegments("a['b c'].d")).toEqual(['a', 'b c', 'd']);
    expect(splitPathSegments('a["e"].f')).toEqual(['a', 'e', 'f']);
  });

  it('splits numeric and bare bracket keys', () => {
    expect(splitPathSegments('a[0].b')).toEqual(['a', '0', 'b']);
    expect(splitPathSegments('a[name]')).toEqual(['a', 'name']);
  });
});

describe('didYouMean', () => {
  it('suggests a close match', () => {
    expect(didYouMean('getUsr', ['getUser', 'listUsers'])).toBe('getUser');
  });

  it('returns undefined when nothing is close', () => {
    expect(didYouMean('zzz', ['getUser', 'listUsers'])).toBeUndefined();
  });

  it('never suggests the name itself', () => {
    expect(didYouMean('getUser', ['getUser'])).toBeUndefined();
  });

  it('picks the closest candidate', () => {
    expect(didYouMean('lstUsers', ['getUser', 'listUsers'])).toBe('listUsers');
  });
});

describe('validateFlow', () => {
  it('returns no diagnostics for a healthy flow', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      requestStep('notify', 'ping', {}),
    ]);
    expect(validateFlow(flow, testDocument)).toEqual([]);
  });

  it('returns no diagnostics when the flow has no steps', () => {
    expect(validateFlow(makeFlow([]), testDocument)).toEqual([]);
    expect(validateFlow({ name: 'x', description: 'y' } as Flow, testDocument)).toEqual([]);
  });

  it('flags a call to an unknown method', () => {
    const flow = makeFlow([requestStep('bad', 'getUsr', { id: 1 })]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      step: 'bad',
      severity: 'error',
      code: 'UNKNOWN_METHOD',
    });
    expect(diagnostics[0].message).toContain("Did you mean 'getUser'?");
  });

  it('flags an unknown method without a suggestion when nothing is close', () => {
    const flow = makeFlow([requestStep('bad', 'zzz', {})]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).not.toContain('Did you mean');
  });

  it('flags dynamic method names as unknown methods', () => {
    // Method names are sent literally (never interpolated), so `${...}`
    // there is an unknown method, not an unknown step reference.
    const flow = makeFlow([requestStep('dynamic', '${methodName}', {})]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      step: 'dynamic',
      severity: 'error',
      code: 'UNKNOWN_METHOD',
    });
  });

  it('flags a missing required param', () => {
    const flow = makeFlow([requestStep('getUser', 'getUser', {})]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics).toEqual([
      {
        step: 'getUser',
        severity: 'error',
        code: 'MISSING_REQUIRED_PARAM',
        message: "Method 'getUser' requires param 'id' but the step does not provide it.",
      },
    ]);
  });

  it('treats params without a required flag as required', () => {
    // listUsers.limit omits `required`, which defaults to required per OpenRPC.
    const flow = makeFlow([requestStep('listUsers', 'listUsers', {})]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('MISSING_REQUIRED_PARAM');
  });

  it('does not flag a missing optional param', () => {
    const flow = makeFlow([requestStep('getUser', 'getUser', { id: 1 })]);
    expect(validateFlow(flow, testDocument)).toEqual([]);
  });

  it('flags a param that violates its schema', () => {
    const flow = makeFlow([requestStep('getUser', 'getUser', { id: 'not-an-int' })]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      step: 'getUser',
      severity: 'error',
      code: 'PARAM_SCHEMA_MISMATCH',
    });
    expect(diagnostics[0].message).toContain("'id'");
  });

  it('skips schema checks for dynamic param values', () => {
    const flow = makeFlow([requestStep('getUser', 'getUser', { id: '${previousStep.result.id}' })]);
    // The unknown step reference is flagged, but no schema mismatch is.
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics.every((d) => d.code !== 'PARAM_SCHEMA_MISMATCH')).toBe(true);
  });

  it('skips schema checks for params without a schema in the document', () => {
    const doc: OpenRpcDocument = {
      openrpc: '1.2.6',
      info: { title: 't', version: '1' },
      methods: [{ name: 'm', params: [{ name: 'p' }] }],
    };
    const flow = makeFlow([requestStep('s', 'm', { p: 'anything' })]);
    expect(validateFlow(flow, doc)).toEqual([]);
  });

  it('skips schema checks for dynamic values nested in arrays and objects', () => {
    const flow = makeFlow([
      requestStep('a', 'getUser', { id: ['${x}', 1] }),
      requestStep('b', 'getUser', { id: { nested: '${x}' } }),
    ]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics.filter((d) => d.code === 'PARAM_SCHEMA_MISMATCH')).toEqual([]);
  });

  it('tolerates a broken schema in the document', () => {
    const doc: OpenRpcDocument = {
      openrpc: '1.2.6',
      info: { title: 't', version: '1' },
      methods: [
        {
          name: 'm',
          params: [{ name: 'p', schema: { $ref: '#/definitions/missing' } }],
        },
      ],
    };
    const flow = makeFlow([requestStep('s', 'm', { p: 1 })]);
    expect(validateFlow(flow, doc)).toEqual([]);
  });

  it('tolerates a broken positional schema in the document', () => {
    const doc: OpenRpcDocument = {
      openrpc: '1.2.6',
      info: { title: 't', version: '1' },
      methods: [
        {
          name: 'm',
          params: [{ name: 'p', schema: { $ref: '#/definitions/missing' } }],
        },
      ],
    };
    const flow = makeFlow([requestStep('s', 'm', [1])]);
    expect(validateFlow(flow, doc)).toEqual([]);
  });

  it('tolerates a method with non-array params in the document', () => {
    const doc = {
      openrpc: '1.2.6',
      info: { title: 't', version: '1' },
      methods: [{ name: 'm', params: 'nope' }],
    } as unknown as OpenRpcDocument;
    const flow = makeFlow([requestStep('s', 'm', { p: 1 })]);
    expect(validateFlow(flow, doc)).toEqual([]);
  });

  it('handles a document without a methods array', () => {
    const doc = {
      openrpc: '1.2.6',
      info: { title: 't', version: '1' },
    } as unknown as OpenRpcDocument;
    const flow = makeFlow([requestStep('s', 'ping', {})]);
    const diagnostics = validateFlow(flow, doc);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('UNKNOWN_METHOD');
  });

  it('validates by-position params', () => {
    const doc: OpenRpcDocument = {
      openrpc: '1.2.6',
      info: { title: 't', version: '1' },
      methods: [
        {
          name: 'add',
          params: [
            { name: 'a', required: true, schema: { type: 'integer' } },
            { name: 'b', required: true, schema: { type: 'integer' } },
          ],
        },
      ],
    };
    expect(validateFlow(makeFlow([requestStep('s', 'add', [1, 2])]), doc)).toEqual([]);

    const tooFew = validateFlow(makeFlow([requestStep('s', 'add', [1])]), doc);
    expect(tooFew).toHaveLength(1);
    expect(tooFew[0].code).toBe('MISSING_REQUIRED_PARAM');

    const wrongType = validateFlow(makeFlow([requestStep('s', 'add', [1, 'x'])]), doc);
    expect(wrongType).toHaveLength(1);
    expect(wrongType[0].code).toBe('PARAM_SCHEMA_MISMATCH');
  });

  it('skips dynamic and extra positional params', () => {
    const doc: OpenRpcDocument = {
      openrpc: '1.2.6',
      info: { title: 't', version: '1' },
      methods: [{ name: 'm', params: [{ name: 'a', schema: { type: 'integer' } }] }],
    };
    const flow = makeFlow([requestStep('s', 'm', ['${x}', 99])]);
    expect(validateFlow(flow, doc).filter((d) => d.code === 'PARAM_SCHEMA_MISMATCH')).toEqual([]);
  });

  it('flags references to unknown steps with a suggestion', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      requestStep('use', 'ping', { note: '${getUsr.result.name}' }),
    ]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      step: 'use',
      severity: 'error',
      code: 'UNKNOWN_STEP_REFERENCE',
    });
    expect(diagnostics[0].message).toContain("Did you mean 'getUser'?");
  });

  it('resolves references to real steps', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      requestStep('use', 'ping', { note: '${getUser.result.name}' }),
    ]);
    expect(validateFlow(flow, testDocument)).toEqual([]);
  });

  it('flags duplicate step names', () => {
    const flow = makeFlow([requestStep('dup', 'ping', {}), requestStep('dup', 'ping', {})]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      step: 'dup',
      severity: 'error',
      code: 'DUPLICATE_STEP_NAME',
    });
  });

  it('does not flag documentation examples in name/description', () => {
    const flow = makeFlow([
      {
        name: 'getUser',
        description: 'Fetches via ${getUser.result} references',
        request: { method: 'getUser', params: { id: 1 } },
      },
    ]);
    expect(validateFlow(flow, testDocument)).toEqual([]);
  });

  it('walks loops without an `as` variable', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      {
        name: 'loopStep',
        loop: {
          over: '${getUser.result}',
          steps: [requestStep('inner', 'ping', {})],
        },
      },
    ]);
    expect(validateFlow(flow, testDocument)).toEqual([]);
  });

  it('ignores special variables', () => {
    const flow = makeFlow([
      {
        name: 'loopStep',
        loop: {
          over: '${getUser.result}',
          as: 'user',
          steps: [requestStep('inner', 'ping', { note: '${item.id} ${context.x} ${acc}' })],
        },
      },
      requestStep('getUser', 'getUser', { id: 1 }),
    ]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics.filter((d) => d.code === 'UNKNOWN_STEP_REFERENCE')).toEqual([]);
  });

  it('treats loop variables as in-scope for nested steps', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      {
        name: 'loopStep',
        loop: {
          over: '${getUser.result}',
          as: 'user',
          step: requestStep('inner', 'ping', { note: '${user.name}' }),
        },
      },
    ]);
    expect(validateFlow(flow, testDocument)).toEqual([]);
  });

  it('checks references inside condition branches', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      {
        name: 'branch',
        condition: {
          if: '${getUser.result.id} > 0',
          then: requestStep('thenStep', 'ping', { note: '${missing.result}' }),
          else: requestStep('elseStep', 'ping', {}),
        },
      },
    ]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ step: 'thenStep', code: 'UNKNOWN_STEP_REFERENCE' });
  });

  it('warns when reading a property missing from the result schema', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      requestStep('use', 'ping', { note: '${getUser.result.email}' }),
    ]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      step: 'use',
      severity: 'warning',
      code: 'UNKNOWN_RESULT_PROPERTY',
    });
    expect(diagnostics[0].message).toContain("'email'");
  });

  it('does not warn for declared result properties', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      requestStep('use', 'ping', { note: '${getUser.result.name}' }),
    ]);
    expect(validateFlow(flow, testDocument)).toEqual([]);
  });

  it('does not warn when the result schema is loose or missing', () => {
    const flow = makeFlow([
      requestStep('listUsers', 'listUsers', { limit: 5 }),
      requestStep('use', 'ping', { note: '${listUsers.result.whatever}' }),
    ]);
    expect(validateFlow(flow, testDocument)).toEqual([]);
  });

  it('does not warn for non-result property paths', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      requestStep('use', 'ping', { note: '${getUser.type}' }),
    ]);
    expect(validateFlow(flow, testDocument)).toEqual([]);
  });

  it('does not warn when the referenced step is not a request step', () => {
    const flow = makeFlow([
      {
        name: 'transformStep',
        transform: { input: '${getUser.result}', operations: [] },
      },
      requestStep('getUser', 'getUser', { id: 1 }),
      requestStep('use', 'ping', { note: '${transformStep.result.foo}' }),
    ]);
    expect(validateFlow(flow, testDocument)).toEqual([]);
  });

  it('does not warn on properties when the referenced step calls a dynamic method', () => {
    // The dynamic method itself is flagged as unknown, but no property
    // warning is emitted since there is no schema to check against.
    const flow = makeFlow([
      requestStep('dynamic', '${methodName}', {}),
      requestStep('use', 'ping', { note: '${dynamic.result.foo}' }),
    ]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ step: 'dynamic', code: 'UNKNOWN_METHOD' });
  });

  it('handles bracket-notation property access in the warning check', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      requestStep('use', 'ping', { note: "${getUser.result['email']}" }),
    ]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('UNKNOWN_RESULT_PROPERTY');
  });

  it('ignores empty references', () => {
    const flow = makeFlow([requestStep('s', 'ping', { note: 'value ${} here' })]);
    expect(validateFlow(flow, testDocument)).toEqual([]);
  });
});

describe('FlowExecutor validateUpfront', () => {
  const handler = jest.fn();

  it('throws when validateUpfront is set without a document', () => {
    const flow = makeFlow([requestStep('s', 'ping', {})]);
    expect(() => new FlowExecutor(flow, handler, { validateUpfront: true })).toThrow(
      ValidationError,
    );
  });

  it('throws a ValidationError listing diagnostics for an invalid flow', () => {
    const flow = makeFlow([requestStep('bad', 'nope', {})]);
    let error: ValidationError | undefined;
    try {
      new FlowExecutor(flow, handler, {
        validateUpfront: true,
        openrpcDocument: testDocument,
      });
    } catch (e) {
      error = e as ValidationError;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect(error?.message).toContain('failed upfront validation');
    expect(error?.message).toContain('[bad]');
    const context = error?.context as { diagnostics?: unknown[] };
    expect(context.diagnostics).toHaveLength(1);
  });

  it('constructs normally when the flow is healthy', () => {
    const flow = makeFlow([requestStep('s', 'ping', {})]);
    expect(
      () =>
        new FlowExecutor(flow, handler, {
          validateUpfront: true,
          openrpcDocument: testDocument,
        }),
    ).not.toThrow();
  });

  it('does not validate when validateUpfront is not set', () => {
    const flow = makeFlow([requestStep('bad', 'nope', {})]);
    expect(() => new FlowExecutor(flow, handler, { openrpcDocument: testDocument })).not.toThrow();
  });

  it('ignores warning-only diagnostics', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      requestStep('use', 'ping', { note: '${getUser.result.email}' }),
    ]);
    expect(
      () =>
        new FlowExecutor(flow, handler, {
          validateUpfront: true,
          openrpcDocument: testDocument,
        }),
    ).not.toThrow();
  });
});

describe('validateFlow switch conditions', () => {
  it('validates nested steps inside switch cases', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      {
        name: 'route',
        condition: {
          switch: '${getUser.result.name}',
          cases: {
            foo: requestStep('a', 'getUser', { id: 'not-an-integer' }),
            bar: [requestStep('b', 'nope', {})],
          },
          default: requestStep('c', 'ping', {}),
        },
      },
    ]);
    const diagnostics = validateFlow(flow, testDocument);
    const codes = diagnostics.map((d) => `${d.step}:${d.code}`).sort();
    expect(codes).toEqual(['a:PARAM_SCHEMA_MISMATCH', 'b:UNKNOWN_METHOD']);
  });

  it('flags unknown step references in the switch expression', () => {
    const flow = makeFlow([
      {
        name: 'route',
        condition: {
          switch: '${missing.result}',
          cases: { foo: requestStep('a', 'ping', {}) },
        },
      },
    ]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ step: 'route', code: 'UNKNOWN_STEP_REFERENCE' });
  });

  it('does not double-report references inside switch cases', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      {
        name: 'route',
        condition: {
          switch: '${getUser.result.name}',
          cases: { foo: requestStep('a', 'ping', { note: '${typo.result}' }) },
        },
      },
    ]);
    const diagnostics = validateFlow(flow, testDocument);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ step: 'a', code: 'UNKNOWN_STEP_REFERENCE' });
  });

  it('accepts a healthy switch flow', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      {
        name: 'route',
        condition: {
          switch: '${getUser.result.name}',
          cases: {
            foo: requestStep('a', 'ping', {}),
            bar: [requestStep('b', 'getUser', { id: 2 })],
          },
          default: [requestStep('c', 'ping', {}), requestStep('d', 'ping', {})],
        },
      },
    ]);
    expect(validateFlow(flow, testDocument)).toEqual([]);
  });

  it('tolerates a switch with missing cases at runtime', () => {
    const flow = makeFlow([
      requestStep('getUser', 'getUser', { id: 1 }),
      {
        name: 'route',
        condition: {
          switch: '${getUser.result.name}',
          default: requestStep('c', 'ping', {}),
        } as unknown as import('../types').SwitchCondition,
      },
    ]);
    expect(validateFlow(flow, testDocument)).toEqual([]);
  });
});
