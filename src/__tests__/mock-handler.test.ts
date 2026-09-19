import { FlowExecutor } from '../flow-executor';
import { OpenRpcDocument } from '../flow-doctor';
import { generateFromSchema, MockJsonRpcHandler } from '../mock-handler';
import type { Flow } from '../types';

const pair = (name: string, value: unknown) => ({ name, value });

const testDocument: OpenRpcDocument = {
  openrpc: '1.2.6',
  info: { title: 'Test API', version: '1.0.0' },
  methods: [
    {
      name: 'getUser',
      params: [{ name: 'id', required: true, schema: { type: 'integer' } }],
      result: { schema: { type: 'object' } },
      examples: [
        {
          name: 'ada',
          params: [pair('id', 1)],
          result: pair('user', { id: 1, name: 'Ada' }),
        },
        {
          name: 'grace',
          params: [pair('id', 2)],
          result: pair('user', { id: 2, name: 'Grace' }),
        },
      ],
    },
    {
      name: 'searchUsers',
      params: [{ name: 'q', schema: { type: 'string' } }],
      examples: [
        {
          name: 'positional',
          // Non-spec shape, tolerated: raw positional params.
          params: ['ada'],
          result: { value: ['Ada'] },
        },
      ],
    },
    {
      name: 'getOrder',
      params: [],
      result: {
        schema: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            status: { enum: ['pending', 'shipped', 'delivered'] },
            total: { type: 'number', minimum: 10, maximum: 20 },
            customer: {
              type: 'object',
              properties: {
                email: { type: 'string', format: 'email' },
                nickname: { type: 'string' },
              },
              required: ['email'],
            },
            tags: { type: 'array', items: { type: 'string' } },
            note: { type: 'string' },
            ref: { type: 'string' },
            extra: { type: 'string' },
          },
          required: ['id', 'status', 'customer'],
        },
      },
    },
    {
      name: 'getFormats',
      params: [],
      result: {
        schema: {
          type: 'object',
          properties: {
            ts: { type: 'string', format: 'date-time' },
            d: { type: 'string', format: 'date' },
            t: { type: 'string', format: 'time' },
            u: { type: 'string', format: 'uuid' },
            e: { type: 'string', format: 'email' },
            uri: { type: 'string', format: 'uri' },
            url: { type: 'string', format: 'url' },
            h: { type: 'string', format: 'hostname' },
            v4: { type: 'string', format: 'ipv4' },
            v6: { type: 'string', format: 'ipv6' },
            weird: { type: 'string', format: 'whatever' },
            plain: { type: 'string' },
          },
          required: ['ts', 'd', 't', 'u', 'e', 'uri', 'url', 'h', 'v4', 'v6', 'weird', 'plain'],
        },
      },
    },
    {
      name: 'listItems',
      params: [],
      result: { schema: { type: 'array', items: { type: 'string' } } },
    },
    { name: 'bareArray', params: [], result: { schema: { type: 'array' } } },
    { name: 'arrayItemsJunk', params: [], result: { schema: { type: 'array', items: [] } } },
    { name: 'bareObject', params: [], result: { schema: { type: 'object' } } },
    { name: 'arrayProps', params: [], result: { schema: { type: 'object', properties: [] } } },
    {
      name: 'mixedRequired',
      params: [],
      result: {
        schema: {
          type: 'object',
          properties: { a: { type: 'string' } },
          required: ['a', 42],
        },
      },
    },
    {
      name: 'getCount',
      params: [],
      result: { schema: { type: 'integer', minimum: 5, maximum: 10 } },
    },
    {
      name: 'getWeirdCount',
      params: [],
      result: { schema: { type: 'integer', minimum: 10, maximum: 5 } },
    },
    { name: 'getPrice', params: [], result: { schema: { type: 'number' } } },
    { name: 'isActive', params: [], result: { schema: { type: 'boolean' } } },
    { name: 'getNothing', params: [] },
    { name: 'getNull', params: [], result: { schema: { type: 'null' } } },
    { name: 'getMystery', params: [], result: { schema: { type: 'fancy' } } },
    { name: 'getBoolSchema', params: [], result: { schema: true } },
    { name: 'getStringSchema', params: [], result: { schema: 'nope' } },
    { name: 'getArraySchema', params: [], result: { schema: [] } },
    { name: 'getEmpty', params: [], result: { schema: {} } },
    { name: 'getUnion', params: [], result: { schema: { type: ['string', 'null'] } } },
    { name: 'getEmptyType', params: [], result: { schema: { type: [] } } },
    {
      name: 'getChoice',
      params: [],
      result: { schema: { anyOf: [{ type: 'string' }, { type: 'integer' }] } },
    },
    {
      name: 'getEither',
      params: [],
      result: { schema: { oneOf: [{ type: 'boolean' }, { type: 'string' }] } },
    },
    { name: 'getEmptyAnyOf', params: [], result: { schema: { anyOf: [] } } },
    { name: 'getEnum', params: [], result: { schema: { enum: ['a', 'b', 'c'] } } },
    { name: 'getEmptyEnum', params: [], result: { schema: { enum: [] } } },
    { name: 'getNonArrayEnum', params: [], result: { schema: { enum: 'x', type: 'string' } } },
    { name: 'getShort', params: [], result: { schema: { type: 'string', minLength: 20 } } },
    { name: 'getZeroMin', params: [], result: { schema: { type: 'string', minLength: 0 } } },
    { name: 'getCapped', params: [], result: { schema: { type: 'string', maxLength: 5 } } },
    { name: 'getNegMax', params: [], result: { schema: { type: 'string', maxLength: -1 } } },
    {
      name: 'getExampleOdd',
      params: [],
      examples: [{ params: { q: 'x' }, result: 'direct' }],
    },
    {
      name: 'getExampleNull',
      params: [],
      examples: [{ params: [null], result: { value: 'saw-null' } }],
    },
    {
      name: 'getExampleSkip',
      params: [],
      examples: [{ params: [pair('a', 1), 5], result: { value: 'mixed' } }],
    },
    {
      name: 'getExampleJunk',
      params: [],
      examples: [null, 'nope', { params: { q: 'y' }, result: { value: 'junk-ok' } }],
    },
    {
      name: 'getExampleUnwrap',
      params: [],
      examples: [{ params: [], result: { name: 'r', value: [1, 2] } }],
    },
    {
      name: 'getExampleNoUnwrap',
      params: [],
      examples: [{ params: [], result: { name: 'r' } }],
    },
    {
      name: 'getExampleNullResult',
      params: [],
      examples: [{ params: {}, result: null }],
    },
    {
      name: 'getExampleBadName',
      params: [],
      examples: [{ params: [{ name: 5, value: 'x' }], result: 'bad' }],
    },
    {
      name: 'getExampleNoValue',
      params: [],
      examples: [{ params: [{ name: 'a' }], result: 'nv' }],
    },
    {
      name: 'getExampleArr',
      params: [],
      examples: [{ params: [[1]], result: 'arr' }],
    },
    {
      name: 'getBadExamples',
      params: [],
      examples: 'nope',
      result: { schema: { type: 'string' } },
    },
    {
      name: 'getEmptyExamples',
      params: [],
      examples: [],
      result: { schema: { type: 'string' } },
    },
    {
      name: 'getNullParams',
      params: [],
      examples: [{ params: { a: null }, result: 'nulls' }],
    },
  ],
};

const call = async (
  method: string,
  params: Record<string, unknown> | unknown[] = {},
  seed = 42,
) => {
  const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, { seed });
  const result = await handler({ jsonrpc: '2.0', method, params, id: 1 });
  return { handler, result };
};

describe('MockJsonRpcHandler examples', () => {
  it('returns the example whose params exactly match the request', async () => {
    const { result } = await call('getUser', { id: 1 });
    expect(result).toEqual({ id: 1, name: 'Ada' });
  });

  it('matches the second example exactly', async () => {
    const { result } = await call('getUser', { id: 2 });
    expect(result).toEqual({ id: 2, name: 'Grace' });
  });

  it('falls back to the first example when no params match', async () => {
    const { result } = await call('getUser', { id: 999 });
    expect(result).toEqual({ id: 1, name: 'Ada' });
  });

  it('does not match when a param value has a different type', async () => {
    const { result } = await call('getUser', { id: '1' });
    expect(result).toEqual({ id: 1, name: 'Ada' });
  });

  it('does not match a null example value against an object', async () => {
    const { result } = await call('getNullParams', { a: {} });
    expect(result).toBe('nulls');
  });

  it('matches positional example params against positional requests', async () => {
    const { result } = await call('searchUsers', ['ada']);
    expect(result).toEqual(['Ada']);
  });

  it('does not match positional examples against by-name requests', async () => {
    const { result } = await call('searchUsers', { q: 'ada' });
    expect(result).toEqual(['Ada']);
  });

  it('tolerates plain-object example params', async () => {
    const { result } = await call('getExampleOdd', { q: 'x' });
    expect(result).toBe('direct');
  });

  it('passes through non-pair array example params for matching', async () => {
    const { result } = await call('getExampleNull', [null]);
    expect(result).toBe('saw-null');
  });

  it('passes through example params when a pair is malformed mid-array', async () => {
    const { result } = await call('getExampleSkip', [{ name: 'a', value: 1 }, 5]);
    expect(result).toBe('mixed');
  });

  it('skips junk example entries', async () => {
    const { result } = await call('getExampleJunk', { q: 'y' });
    expect(result).toBe('junk-ok');
  });

  it('does not unwrap array example results', async () => {
    const { result } = await call('getExampleUnwrap', []);
    expect(result).toEqual([1, 2]);
  });

  it('passes through example results without a value key', async () => {
    const { result } = await call('getExampleNoUnwrap', []);
    expect(result).toEqual({ name: 'r' });
  });

  it('passes through null example results', async () => {
    const { result } = await call('getExampleNullResult', {});
    expect(result).toBeNull();
  });

  it('passes through pairs with non-string names', async () => {
    const { result } = await call('getExampleBadName', [{ name: 5, value: 'x' }]);
    expect(result).toBe('bad');
  });

  it('passes through pairs missing the value key', async () => {
    const { result } = await call('getExampleNoValue', [{ name: 'a' }]);
    expect(result).toBe('nv');
  });

  it('passes through array elements as example params', async () => {
    const { result } = await call('getExampleArr', [[1]]);
    expect(result).toBe('arr');
  });

  it('ignores a non-array examples field and generates from schema', async () => {
    const { result } = await call('getBadExamples', {});
    expect(typeof result).toBe('string');
  });

  it('generates from schema when examples is empty', async () => {
    const { result } = await call('getEmptyExamples', {});
    expect(typeof result).toBe('string');
  });
});

describe('MockJsonRpcHandler schema generation', () => {
  it('generates objects honoring required fields and nesting', async () => {
    const { result } = await call('getOrder', {});
    const order = result as Record<string, unknown>;
    // Required fields are always present and valid.
    expect(order.id).toEqual(expect.any(Number));
    expect(['pending', 'shipped', 'delivered']).toContain(order.status);
    const customer = order.customer as Record<string, unknown>;
    expect(customer.email).toMatch(/@/);
    // Optional fields are valid whenever the seeded draw includes them.
    expect(
      Object.keys(order).every((k) =>
        ['id', 'status', 'total', 'customer', 'tags', 'note', 'ref', 'extra'].includes(k),
      ),
    ).toBe(true);
    if (order.total !== undefined) {
      expect(order.total).toEqual(expect.any(Number));
      expect((order.total as number) >= 10 && (order.total as number) <= 20).toBe(true);
    }
    if (order.tags !== undefined) {
      expect(order.tags).toEqual(expect.any(Array));
      for (const tag of order.tags as unknown[]) {
        expect(typeof tag).toBe('string');
      }
    }
    for (const key of ['note', 'ref', 'extra'] as const) {
      if (order[key] !== undefined) {
        expect(typeof order[key]).toBe('string');
      }
    }
  });

  it('generates each string format', async () => {
    const { result } = await call('getFormats', {});
    const f = result as Record<string, string>;
    expect(f.ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(f.d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(f.t).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(f.u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(f.e).toMatch(/@/);
    expect(f.uri).toMatch(/^https:\/\/example\.com\//);
    expect(f.url).toMatch(/^https:\/\/example\.com\//);
    expect(f.h).toMatch(/\.example\.com$/);
    expect(f.v4).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
    expect(f.v6).toMatch(/^([0-9a-f]{1,4}:){7}[0-9a-f]{1,4}$/);
    expect(typeof f.weird).toBe('string');
    expect(typeof f.plain).toBe('string');
  });

  it('generates arrays from item schemas', async () => {
    const { result } = await call('listItems', {});
    expect(Array.isArray(result)).toBe(true);
    expect((result as unknown[]).length).toBeGreaterThanOrEqual(1);
    for (const item of result as unknown[]) {
      expect(typeof item).toBe('string');
    }
  });

  it('generates empty arrays without item schemas', async () => {
    expect((await call('bareArray', {})).result).toEqual([]);
    expect((await call('arrayItemsJunk', {})).result).toEqual([]);
  });

  it('generates empty objects without properties', async () => {
    expect((await call('bareObject', {})).result).toEqual({});
    expect((await call('arrayProps', {})).result).toEqual({});
  });

  it('ignores non-string entries in required', async () => {
    const { result } = await call('mixedRequired', {});
    expect((result as Record<string, unknown>).a).toEqual(expect.any(String));
  });

  it('generates integers within minimum/maximum', async () => {
    const { result } = await call('getCount', {});
    expect(Number.isInteger(result)).toBe(true);
    expect((result as number) >= 5 && (result as number) <= 10).toBe(true);
  });

  it('falls back when maximum is not above minimum', async () => {
    const { result } = await call('getWeirdCount', {});
    expect(Number.isInteger(result)).toBe(true);
    expect((result as number) >= 10).toBe(true);
  });

  it('generates plain numbers', async () => {
    expect(typeof (await call('getPrice', {})).result).toBe('number');
  });

  it('generates booleans', async () => {
    const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, { seed: 7 });
    const results = new Set<unknown>();
    for (let i = 0; i < 10; i++) {
      results.add(await handler({ jsonrpc: '2.0', method: 'isActive', params: {}, id: i }));
    }
    expect(results.has(true)).toBe(true);
    expect(results.has(false)).toBe(true);
  });

  it('returns null when the method has no result schema', async () => {
    expect((await call('getNothing', {})).result).toBeNull();
  });

  it('returns null for null schemas', async () => {
    expect((await call('getNull', {})).result).toBeNull();
  });

  it('returns null for unrecognized schemas instead of throwing', async () => {
    expect((await call('getMystery', {})).result).toBeNull();
    expect((await call('getBoolSchema', {})).result).toBeNull();
    expect((await call('getStringSchema', {})).result).toBeNull();
    expect((await call('getArraySchema', {})).result).toBeNull();
    expect((await call('getEmpty', {})).result).toBeNull();
    expect((await call('getEmptyType', {})).result).toBeNull();
    expect((await call('getEmptyAnyOf', {})).result).toBeNull();
  });

  it('uses the first variant of anyOf/oneOf', async () => {
    expect(typeof (await call('getChoice', {})).result).toBe('string');
    expect(typeof (await call('getEither', {})).result).toBe('boolean');
  });

  it('uses the first type of a type array', async () => {
    expect(typeof (await call('getUnion', {})).result).toBe('string');
  });

  it('picks enum values', async () => {
    expect(['a', 'b', 'c']).toContain(await call('getEnum', {}).then((r) => r.result));
  });

  it('ignores empty and non-array enums', async () => {
    expect((await call('getEmptyEnum', {})).result).toBeNull();
    expect(typeof (await call('getNonArrayEnum', {})).result).toBe('string');
  });

  it('honors minLength and maxLength', async () => {
    expect((await call('getShort', {})).result as string).toHaveLength(20);
    expect((await call('getCapped', {})).result as string).toHaveLength(5);
  });

  it('treats zero and negative length bounds as absent', async () => {
    expect(typeof (await call('getZeroMin', {})).result).toBe('string');
    expect(typeof (await call('getNegMax', {})).result).toBe('string');
  });
});

describe('MockJsonRpcHandler determinism and trace', () => {
  const traceFlow = async (seed?: number) => {
    const handler = MockJsonRpcHandler.fromOpenRpc(
      testDocument,
      seed === undefined ? {} : { seed },
    );
    await handler({ jsonrpc: '2.0', method: 'getOrder', params: {}, id: 1 });
    await handler({ jsonrpc: '2.0', method: 'getCount', params: {}, id: 2 });
    await handler({ jsonrpc: '2.0', method: 'getFormats', params: {}, id: 3 });
    return handler.getTrace();
  };

  it('produces identical traces for the same seed', async () => {
    expect(await traceFlow(42)).toEqual(await traceFlow(42));
  });

  it('produces different traces for different seeds', async () => {
    const a = await traceFlow(42);
    const b = await traceFlow(43);
    expect(a).not.toEqual(b);
  });

  it('works without a seed (non-deterministic)', async () => {
    const trace = await traceFlow(undefined);
    expect(trace).toHaveLength(3);
    expect(trace[0].method).toBe('getOrder');
  });

  it('works without an options argument', async () => {
    const handler = MockJsonRpcHandler.fromOpenRpc(testDocument);
    const result = await handler({ jsonrpc: '2.0', method: 'getUser', params: { id: 1 }, id: 1 });
    expect(result).toEqual({ id: 1, name: 'Ada' });
  });

  it('records method, params, and result for every call', async () => {
    const { handler } = await call('getUser', { id: 2 });
    expect(handler.getTrace()).toEqual([
      { method: 'getUser', params: { id: 2 }, result: { id: 2, name: 'Grace' } },
    ]);
  });

  it('returns a copy from getTrace', async () => {
    const { handler } = await call('getUser', { id: 1 });
    const trace = handler.getTrace();
    trace.push({ method: 'x', params: {}, result: null });
    expect(handler.getTrace()).toHaveLength(1);
  });

  it('mocks unknown methods as null instead of throwing', async () => {
    const { handler, result } = await call('nope', { a: 1 });
    expect(result).toBeNull();
    expect(handler.getTrace()).toEqual([{ method: 'nope', params: { a: 1 }, result: null }]);
  });

  it('tolerates a document without a methods array', async () => {
    const doc = {
      openrpc: '1.2.6',
      info: { title: 't', version: '1' },
    } as unknown as OpenRpcDocument;
    const handler = MockJsonRpcHandler.fromOpenRpc(doc, { seed: 1 });
    expect(await handler({ jsonrpc: '2.0', method: 'ping', params: {}, id: 1 })).toBeNull();
  });

  it('skips malformed method entries', async () => {
    const doc = {
      openrpc: '1.2.6',
      info: { title: 't', version: '1' },
      methods: [null, {}, { name: 5 }, ...testDocument.methods],
    } as unknown as OpenRpcDocument;
    const handler = MockJsonRpcHandler.fromOpenRpc(doc, { seed: 1 });
    expect(await handler({ jsonrpc: '2.0', method: 'getUser', params: { id: 1 }, id: 1 })).toEqual({
      id: 1,
      name: 'Ada',
    });
  });
});

describe('MockJsonRpcHandler with FlowExecutor', () => {
  it('dry-runs a flow with zero live services', async () => {
    const flow: Flow = {
      name: 'dry-run-flow',
      description: 'dry run',
      steps: [
        { name: 'fetchUser', request: { method: 'getUser', params: { id: 1 } } },
        {
          name: 'countThings',
          request: { method: 'getCount', params: { owner: '${fetchUser.result.name}' } },
        },
      ],
    };
    const handler = MockJsonRpcHandler.fromOpenRpc(testDocument, { seed: 42 });
    const executor = new FlowExecutor(flow, handler);
    const results = await executor.execute();
    expect((results.get('fetchUser') as { result: unknown }).result).toEqual({
      id: 1,
      name: 'Ada',
    });
    expect((results.get('countThings') as { result: unknown }).result).toEqual(expect.any(Number));

    const trace = handler.getTrace();
    expect(trace).toHaveLength(2);
    expect(trace[0]).toEqual({
      method: 'getUser',
      params: { id: 1 },
      result: { id: 1, name: 'Ada' },
    });
    expect(trace[1].method).toBe('getCount');
    expect(trace[1].params).toEqual({ owner: 'Ada' });
  });
});

describe('generateFromSchema', () => {
  it('is exported for direct use', () => {
    expect(generateFromSchema({ type: 'boolean' }, () => 0.5)).toBe(false);
    expect(generateFromSchema({ type: 'boolean' }, () => 0.1)).toBe(true);
  });
});
