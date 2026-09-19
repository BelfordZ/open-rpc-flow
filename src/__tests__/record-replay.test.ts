import { FlowExecutor } from '../flow-executor';
import type { OpenRpcDocument } from '../flow-doctor';
import { JsonRpcRequestError } from '../step-executors/types';
import type { Flow, JsonRpcHandler, JsonRpcRequest } from '../types';
import {
  createRecordingHandler,
  createReplayHandler,
  detectContractDrift,
  isRecordedError,
  ReplayError,
} from '../record-replay';
import type { RecordedTrace } from '../record-replay';

function makeRequest(method: string, params: unknown = {}, id = 1): JsonRpcRequest {
  return { jsonrpc: '2.0', method, params: params as Record<string, unknown>, id };
}

function makeTrace(): RecordedTrace {
  return {
    flowName: 'WhatIf',
    recordedAt: new Date().toISOString(),
    steps: [
      {
        step: 'getUser',
        method: 'getUser',
        params: { id: 1 },
        result: { name: 'ann', role: 'user' },
        durationMs: 3,
        timestamp: new Date().toISOString(),
      },
      {
        step: 'greet',
        method: 'greet',
        params: { name: 'ann' },
        result: 'hello ann',
        durationMs: 1,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

function makeFlow(): Flow {
  return {
    name: 'WhatIf',
    description: 'what-if test flow',
    steps: [
      { name: 'getUser', request: { method: 'getUser', params: { id: 1 } } },
      { name: 'greet', request: { method: 'greet', params: { name: '${getUser.result.name}' } } },
    ],
  };
}

const driftDocument: OpenRpcDocument = {
  openrpc: '1.2.6',
  info: { title: 't', version: '1' },
  methods: [
    {
      name: 'getUser',
      params: [],
      result: {
        schema: {
          type: 'object',
          properties: { name: { type: 'string' }, age: { type: 'integer' } },
          required: ['name'],
        },
      },
    },
  ],
};

describe('createRecordingHandler', () => {
  it('records method, params, result, and timing for each call', async () => {
    const inner: JsonRpcHandler = jest.fn(async (req) => ({ echoed: req.params }));
    const { handler, getTrace } = createRecordingHandler(inner);

    await handler(makeRequest('getUser', { id: 1 }), { signal: undefined });

    const trace = getTrace('MyFlow');
    expect(trace.flowName).toBe('MyFlow');
    expect(Number.isNaN(Date.parse(trace.recordedAt))).toBe(false);
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0]).toMatchObject({
      step: 'getUser',
      method: 'getUser',
      params: { id: 1 },
      result: { echoed: { id: 1 } },
    });
    expect(typeof trace.steps[0].durationMs).toBe('number');
    expect(trace.steps[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(trace.steps[0].timestamp))).toBe(false);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('passes options through to the inner handler', async () => {
    const inner: JsonRpcHandler = jest.fn(async () => 'ok');
    const { handler } = createRecordingHandler(inner);
    const options = { signal: undefined, custom: 'yes' };
    await handler(makeRequest('m'), options);
    expect(inner).toHaveBeenCalledWith(expect.objectContaining({ method: 'm' }), options);
  });

  it('records thrown errors as { error: { message, code } } and re-throws the original', async () => {
    const boom = new JsonRpcRequestError('bad thing', { code: -32602, message: 'bad thing' });
    const inner: JsonRpcHandler = jest
      .fn()
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce('fine');
    const { handler, getTrace } = createRecordingHandler(inner);

    await expect(handler(makeRequest('a'))).rejects.toBe(boom);
    await handler(makeRequest('b'));

    const trace = getTrace('f');
    expect(trace.steps[0].result).toEqual({ error: { message: 'bad thing', code: -32602 } });
    expect(trace.steps[1].result).toBe('fine');
  });

  it('captures direct { code, message } throws, plain errors, strings, and unknown values', async () => {
    const cases: Array<[unknown, unknown]> = [
      [{ code: 7, message: 'direct' }, { error: { message: 'direct', code: 7 } }],
      [{ code: 7 }, { error: { message: 'Unknown error', code: 7 } }],
      [new Error('kaput'), { error: { message: 'kaput' } }],
      ['string failure', { error: { message: 'string failure' } }],
      [42, { error: { message: 'Unknown error' } }],
      [null, { error: { message: 'Unknown error' } }],
    ];
    for (const [thrown, expected] of cases) {
      const inner: JsonRpcHandler = jest.fn().mockRejectedValueOnce(thrown);
      const { handler, getTrace } = createRecordingHandler(inner);
      await expect(handler(makeRequest('a'))).rejects.toBe(thrown);
      expect(getTrace('f').steps[0].result).toEqual(expected);
    }
  });

  it('snapshots values so later mutation cannot corrupt the trace', async () => {
    const result = { user: { name: 'ann' } };
    const inner: JsonRpcHandler = jest.fn(async () => result);
    const { handler, getTrace } = createRecordingHandler(inner);
    await handler(makeRequest('getUser'));
    result.user.name = 'bob';
    expect(getTrace('f').steps[0].result).toEqual({ user: { name: 'ann' } });
  });

  it('degrades unserializable values to null instead of breaking the flow', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const inner: JsonRpcHandler = jest.fn(async () => circular);
    const { handler, getTrace } = createRecordingHandler(inner);
    await handler(makeRequest('m'));
    expect(getTrace('f').steps[0].result).toBeNull();
  });

  it('records undefined results as null', async () => {
    const inner: JsonRpcHandler = jest.fn(async () => undefined);
    const { handler, getTrace } = createRecordingHandler(inner);
    await handler(makeRequest('m'));
    expect(getTrace('f').steps[0].result).toBeNull();
  });

  it('returns an isolated copy from getTrace', async () => {
    const inner: JsonRpcHandler = jest.fn(async () => 'v');
    const { handler, getTrace } = createRecordingHandler(inner);
    await handler(makeRequest('m'));
    const first = getTrace('f');
    first.steps.push(makeTrace().steps[0]);
    first.steps[0].method = 'mutated';
    const second = getTrace('f');
    expect(second.steps).toHaveLength(1);
    expect(second.steps[0].method).toBe('m');
  });

  it('produces a trace that survives a JSON round-trip', async () => {
    const inner: JsonRpcHandler = jest.fn(async (req) => ({ ok: true, method: req.method }));
    const { handler, getTrace } = createRecordingHandler(inner);
    await handler(makeRequest('a', { x: [1, 2] }));
    const trace = getTrace('f');
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
  });
});

describe('createReplayHandler', () => {
  it('replays recorded responses in order with zero inner handler calls', async () => {
    // Note: results are objects here because a latent request-executor crash
    // on truthy primitive results is fixed separately in PR #173.
    const network: JsonRpcHandler = jest.fn(async (req) =>
      req.method === 'getUser' ? { name: 'ann' } : { live: req.method },
    );
    const { handler: recorder, getTrace } = createRecordingHandler(network);
    await new FlowExecutor(makeFlow(), recorder).execute();
    const trace = getTrace('WhatIf');
    expect(network).toHaveBeenCalledTimes(2);

    const replay = createReplayHandler(trace);
    const seen: string[] = [];
    const watching: JsonRpcHandler = async (req) => {
      seen.push(req.method);
      return replay(req);
    };
    await new FlowExecutor(makeFlow(), watching).execute();

    expect(network).toHaveBeenCalledTimes(2); // replay never touched the network
    expect(seen).toEqual(['getUser', 'greet']);
  });

  it('throws ReplayError on method mismatch', async () => {
    const replay = createReplayHandler(makeTrace());
    await expect(replay(makeRequest('nope'))).rejects.toThrow(ReplayError);
    await expect(replay(makeRequest('nope'))).rejects.toThrow(/expected method "getUser"/);
  });

  it('throws ReplayError on params mismatch', async () => {
    const replay = createReplayHandler(makeTrace());
    await expect(replay(makeRequest('getUser', { id: 2 }))).rejects.toThrow(
      /params do not deep-equal/,
    );
  });

  it('matches nested params structurally', async () => {
    const trace = makeTrace();
    trace.steps[0].params = { filter: { tags: ['a', 'b'], nested: { x: 1 } } };
    const replay = createReplayHandler(trace);
    await expect(
      replay(makeRequest('getUser', { filter: { tags: ['a', 'b'], nested: { x: 1 } } })),
    ).resolves.toEqual({ name: 'ann', role: 'user' });
  });

  it('detects array length, key count, type, null, and primitive mismatches', async () => {
    const variants: unknown[] = [
      { id: [1, 2, 3] },
      { id: 1, extra: true },
      { id: '1' },
      null,
      { id: 2 },
    ];
    for (const params of variants) {
      const trace = makeTrace();
      trace.steps[0].params = { id: 1 };
      const replay = createReplayHandler(trace);
      await expect(replay(makeRequest('getUser', params))).rejects.toThrow(ReplayError);
    }
  });

  it('truncates long params in mismatch messages', async () => {
    const trace = makeTrace();
    trace.steps[0].params = { blob: 'x'.repeat(500) };
    const replay = createReplayHandler(trace);
    await expect(replay(makeRequest('getUser', { blob: 'y' }))).rejects.toThrow(/…/);
  });

  it('renders unserializable params safely in mismatch messages', async () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const replay = createReplayHandler(makeTrace());
    await expect(replay(makeRequest('getUser', circular))).rejects.toThrow(/<unserializable>/);
  });

  it('throws ReplayError when the trace is exhausted', async () => {
    const replay = createReplayHandler(makeTrace());
    await replay(makeRequest('getUser', { id: 1 }));
    await replay(makeRequest('greet', { name: 'ann' }));
    await expect(replay(makeRequest('getUser', { id: 1 }))).rejects.toThrow(/exhausted/);
  });

  it('throws ReplayError for a malformed trace', async () => {
    const replay = createReplayHandler({} as unknown as RecordedTrace);
    await expect(replay(makeRequest('getUser'))).rejects.toThrow(/exhausted/);
    const nullReplay = createReplayHandler(null as unknown as RecordedTrace);
    await expect(nullReplay(makeRequest('getUser'))).rejects.toThrow(/exhausted/);
  });

  it('supports fromStep to skip earlier entries', async () => {
    const replay = createReplayHandler(makeTrace(), { fromStep: 'greet' });
    await expect(replay(makeRequest('getUser', { id: 1 }))).rejects.toThrow(ReplayError);
    await expect(replay(makeRequest('greet', { name: 'ann' }))).resolves.toBe('hello ann');
  });

  it('throws ReplayError at creation for an unknown fromStep', () => {
    expect(() => createReplayHandler(makeTrace(), { fromStep: 'nope' })).toThrow(ReplayError);
    expect(() =>
      createReplayHandler(
        { flowName: 'f', recordedAt: '', steps: [null] } as unknown as RecordedTrace,
        {
          fromStep: 'x',
        },
      ),
    ).toThrow(/no recorded call/);
  });
});

describe('createReplayHandler overrides (what-if)', () => {
  it('substitutes the overridden response and changes downstream flow behavior', async () => {
    const network: JsonRpcHandler = jest.fn(async (req) => {
      if (req.method === 'getUser') {
        return { name: 'ann', role: 'user' };
      }
      return { greeting: `hello ${(req.params as Record<string, unknown>).name}` };
    });
    const { handler: recorder, getTrace } = createRecordingHandler(network);
    await new FlowExecutor(makeFlow(), recorder).execute();
    const trace = getTrace('WhatIf');

    // What if getUser had returned bob the admin? The downstream greet call
    // is then built from the substituted response, so its params legitimately
    // differ from the recording — matching relaxes to method + order.
    const replay = createReplayHandler(trace, {
      overrides: { getUser: { name: 'bob', role: 'admin' } },
    });
    const seenParams: unknown[] = [];
    const watching: JsonRpcHandler = async (req) => {
      seenParams.push(req.params);
      return replay(req);
    };
    await new FlowExecutor(makeFlow(), watching).execute();

    expect(network).toHaveBeenCalledTimes(2); // still zero live calls during replay
    expect(seenParams[0]).toEqual({ id: 1 });
    expect(seenParams[1]).toEqual({ name: 'bob' }); // downstream saw the override
  });

  it('still serves recorded responses for non-overridden methods', async () => {
    const replay = createReplayHandler(makeTrace(), { overrides: { getUser: { name: 'zed' } } });
    await expect(replay(makeRequest('getUser', { id: 1 }))).resolves.toEqual({ name: 'zed' });
    await expect(replay(makeRequest('greet', { name: 'ann' }))).resolves.toBe('hello ann');
  });

  it('re-throws recorded errors as JsonRpcRequestError', async () => {
    const trace = makeTrace();
    trace.steps[0].result = { error: { message: 'bad thing', code: -32602 } };
    const replay = createReplayHandler(trace);
    const error = await replay(makeRequest('getUser', { id: 1 })).catch((e) => e);
    expect(error).toBeInstanceOf(JsonRpcRequestError);
    expect(error.message).toBe('bad thing');
    expect(error.error.code).toBe(-32602);
  });

  it('defaults a missing recorded error code to internal error', async () => {
    const trace = makeTrace();
    trace.steps[0].result = { error: { message: 'mystery' } };
    const replay = createReplayHandler(trace);
    const error = await replay(makeRequest('getUser', { id: 1 })).catch((e) => e);
    expect(error).toBeInstanceOf(JsonRpcRequestError);
    expect(error.error.code).toBe(-32603);
  });

  it('returns isolated copies so one replay cannot corrupt another', async () => {
    const trace = makeTrace();
    const first = createReplayHandler(trace);
    const result = (await first(makeRequest('getUser', { id: 1 }))) as Record<string, unknown>;
    result.name = 'mutated';
    const second = createReplayHandler(trace);
    await expect(second(makeRequest('getUser', { id: 1 }))).resolves.toEqual({
      name: 'ann',
      role: 'user',
    });
  });
});

describe('isRecordedError', () => {
  it('recognizes the recorded-error shape and rejects near-misses', () => {
    expect(isRecordedError({ error: { message: 'x', code: 1 } })).toBe(true);
    expect(isRecordedError({ error: { message: 'x' } })).toBe(true);
    expect(isRecordedError(null)).toBe(false);
    expect(isRecordedError([{ error: { message: 'x' } }])).toBe(false);
    expect(isRecordedError({ error: { message: 'x' }, other: 1 })).toBe(false);
    expect(isRecordedError({ error: 'nope' })).toBe(false);
    expect(isRecordedError({ error: {} })).toBe(false);
    expect(isRecordedError('str')).toBe(false);
  });
});

describe('detectContractDrift', () => {
  it('passes when recorded results match the schemas', () => {
    const trace = makeTrace();
    trace.steps[0].result = { name: 'ann', age: 30 };
    trace.steps[1].result = 'anything';
    expect(detectContractDrift(trace, driftDocument)).toEqual([]);
  });

  it('flags each schema violation with method, path, and message', () => {
    const trace = makeTrace();
    trace.steps[0].result = { name: 42, age: 'old' };
    const reports = detectContractDrift(trace, driftDocument);
    expect(reports).toHaveLength(2);
    expect(reports[0]).toMatchObject({ method: 'getUser', path: '/name' });
    expect(reports[0].message).toContain('must be string');
    expect(reports[1]).toMatchObject({ method: 'getUser', path: '/age' });
  });

  it('skips recorded errors, unknown methods, and methods without schemas', () => {
    const trace = makeTrace();
    trace.steps[0].result = { error: { message: 'boom', code: -32603 } };
    trace.steps.push({
      step: 'unknown',
      method: 'unknown',
      params: {},
      result: { whatever: true },
      durationMs: 1,
      timestamp: new Date().toISOString(),
    });
    expect(detectContractDrift(trace, driftDocument)).toEqual([]);
  });

  it('never throws on weird documents or traces', () => {
    const trace = makeTrace();
    const weirdDoc = { methods: 'nope' } as unknown as OpenRpcDocument;
    expect(detectContractDrift(trace, weirdDoc)).toEqual([]);
    expect(detectContractDrift(trace, {} as unknown as OpenRpcDocument)).toEqual([]);
    const nullMethods = {
      openrpc: '1.2.6',
      info: { title: 't', version: '1' },
      methods: [null, {}],
    };
    expect(detectContractDrift(trace, nullMethods as unknown as OpenRpcDocument)).toEqual([]);
    expect(detectContractDrift({} as unknown as RecordedTrace, driftDocument)).toEqual([]);
    const nullSteps = { flowName: 'f', recordedAt: '', steps: [null] };
    expect(detectContractDrift(nullSteps as unknown as RecordedTrace, driftDocument)).toEqual([]);
    const badMethod = {
      flowName: 'f',
      recordedAt: '',
      steps: [{ step: 'x', method: 42, params: {}, result: 1, durationMs: 1, timestamp: '' }],
    };
    expect(detectContractDrift(badMethod as unknown as RecordedTrace, driftDocument)).toEqual([]);
  });

  it('skips methods whose result schema cannot be compiled', () => {
    const doc: OpenRpcDocument = {
      openrpc: '1.2.6',
      info: { title: 't', version: '1' },
      methods: [
        {
          name: 'getUser',
          result: { schema: { $ref: '#/definitions/missing' } },
        },
      ],
    };
    const trace = makeTrace();
    expect(detectContractDrift(trace, doc)).toEqual([]);
  });
});
