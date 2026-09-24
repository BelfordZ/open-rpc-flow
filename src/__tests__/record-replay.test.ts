import { FlowExecutor } from '../flow-executor';
import type { OpenRpcDocument } from '../flow-doctor';
import { JsonRpcRequestError } from '../step-executors/types';
import type { Flow, JsonRpcHandler, JsonRpcRequest } from '../types';
import {
  createRecordingHandler,
  createReplayHandler,
  detectContractDrift,
  isRecordedError,
  overrideSequence,
  validateTraceForFlow,
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
        path: 'getUser',
        step: 'getUser',
        method: 'getUser',
        params: { id: 1 },
        result: { name: 'ann', role: 'user' },
        durationMs: 3,
        timestamp: new Date().toISOString(),
      },
      {
        path: 'greet',
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

  it('throws on unserializable values instead of silently degrading them', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const inner: JsonRpcHandler = jest.fn(async () => circular);
    const { handler, getTrace } = createRecordingHandler(inner);
    await expect(handler(makeRequest('m'))).rejects.toThrow(/not JSON-serializable/);
    // No phantom entry is recorded for the failed serialization.
    expect(getTrace('f').steps).toHaveLength(0);
  });

  it('throws on unserializable params before the inner handler is called', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const inner: JsonRpcHandler = jest.fn(async () => 'ok');
    const { handler, getTrace } = createRecordingHandler(inner);
    await expect(handler(makeRequest('m', circular))).rejects.toThrow(/not JSON-serializable/);
    expect(inner).not.toHaveBeenCalled();
    expect(getTrace('f').steps).toHaveLength(0);
  });

  it('records the execution path when the executor tags the call', async () => {
    const inner: JsonRpcHandler = jest.fn(async () => 'ok');
    const { handler, getTrace } = createRecordingHandler(inner);
    await handler(makeRequest('getUser'), { stepPath: 'processUsers[2].fetchUser' });
    const entry = getTrace('f').steps[0];
    expect(entry.path).toBe('processUsers[2].fetchUser');
    expect(entry.step).toBe('fetchUser');
  });

  it('falls back to the method name for untagged calls', async () => {
    const inner: JsonRpcHandler = jest.fn(async () => 'ok');
    const { handler, getTrace } = createRecordingHandler(inner);
    await handler(makeRequest('getUser'));
    const entry = getTrace('f').steps[0];
    expect(entry.path).toBe('getUser');
    expect(entry.step).toBe('getUser');
  });

  it('round-trips stepHashes through getTrace', async () => {
    const inner: JsonRpcHandler = jest.fn(async () => 'v');
    const { handler, getTrace } = createRecordingHandler(inner);
    await handler(makeRequest('m'));
    expect(getTrace('f', { fetch: 'digest1' }).stepHashes).toEqual({ fetch: 'digest1' });
    expect(getTrace('f').stepHashes).toBeUndefined();
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

  it('throws ReplayError on method mismatch within a path group', async () => {
    const replay = createReplayHandler(makeTrace());
    await expect(replay(makeRequest('nope'), { stepPath: 'getUser' })).rejects.toThrow(ReplayError);
    await expect(replay(makeRequest('nope'), { stepPath: 'getUser' })).rejects.toThrow(
      /expected method "getUser"/,
    );
  });

  it('throws ReplayError naming the path when the replayed flow diverges', async () => {
    const replay = createReplayHandler(makeTrace());
    await expect(
      replay(makeRequest('getUser', { id: 1 }), { stepPath: 'branchNeverRecorded' }),
    ).rejects.toThrow(/no recorded calls for path "branchNeverRecorded"/);
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

  it('names the path when a group is exhausted', async () => {
    const replay = createReplayHandler(makeTrace());
    await replay(makeRequest('getUser', { id: 1 }));
    await expect(replay(makeRequest('getUser', { id: 1 }))).rejects.toThrow(
      /Replay exhausted for path "getUser"/,
    );
  });

  it('throws ReplayError for a malformed trace', async () => {
    const replay = createReplayHandler({} as unknown as RecordedTrace);
    await expect(replay(makeRequest('getUser'))).rejects.toThrow(/no recorded calls for path/);
    const nullReplay = createReplayHandler(null as unknown as RecordedTrace);
    await expect(nullReplay(makeRequest('getUser'))).rejects.toThrow(/no recorded calls for path/);
  });

  it('supports fromStep to skip earlier entries', async () => {
    const replay = createReplayHandler(makeTrace(), { fromStep: 'greet' });
    await expect(replay(makeRequest('getUser', { id: 1 }))).rejects.toThrow(ReplayError);
    await expect(replay(makeRequest('greet', { name: 'ann' }))).resolves.toBe('hello ann');
  });

  it('fromStep matches a step-name prefix covering iterations and nested sub-steps', async () => {
    const trace: RecordedTrace = {
      flowName: 'f',
      recordedAt: new Date().toISOString(),
      steps: [
        {
          path: 'setup',
          step: 'setup',
          method: 'm',
          params: {},
          result: 1,
          durationMs: 1,
          timestamp: new Date().toISOString(),
        },
        {
          path: 'loop[0].fetch',
          step: 'fetch',
          method: 'm',
          params: {},
          result: 2,
          durationMs: 1,
          timestamp: new Date().toISOString(),
        },
        {
          path: 'loop[1].fetch',
          step: 'fetch',
          method: 'm',
          params: {},
          result: 3,
          durationMs: 1,
          timestamp: new Date().toISOString(),
        },
      ],
    };
    const replay = createReplayHandler(trace, { fromStep: 'loop' });
    await expect(replay(makeRequest('m'), { stepPath: 'setup' })).rejects.toThrow(ReplayError);
    await expect(replay(makeRequest('m'), { stepPath: 'loop[0].fetch' })).resolves.toBe(2);
    await expect(replay(makeRequest('m'), { stepPath: 'loop[1].fetch' })).resolves.toBe(3);
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
      path: 'unknown',
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

describe('per-group replay matching', () => {
  function interleavedTrace(): RecordedTrace {
    const entry = (
      path: string,
      params: unknown,
      result: unknown,
    ): RecordedTrace['steps'][number] => ({
      path,
      step: 'a',
      method: 'm',
      params: params as Record<string, unknown>,
      result,
      durationMs: 1,
      timestamp: new Date().toISOString(),
    });
    return {
      flowName: 'f',
      recordedAt: new Date().toISOString(),
      // Recorded interleave: A1, B1, A2, B2.
      steps: [
        entry('loop[0].a', { n: 1 }, 'a1'),
        entry('loop[1].a', { n: 1 }, 'b1'),
        entry('loop[0].a', { n: 2 }, 'a2'),
        entry('loop[1].a', { n: 2 }, 'b2'),
      ],
    };
  }

  it('matches per path-group so a different interleave still replays', async () => {
    const replay = createReplayHandler(interleavedTrace());
    // Replay interleave: B1, A1, B2, A2 — per-group cursors make the
    // cross-group order irrelevant.
    const call = (path: string, n: number) => replay(makeRequest('m', { n }), { stepPath: path });
    await expect(call('loop[1].a', 1)).resolves.toBe('b1');
    await expect(call('loop[0].a', 1)).resolves.toBe('a1');
    await expect(call('loop[1].a', 2)).resolves.toBe('b2');
    await expect(call('loop[0].a', 2)).resolves.toBe('a2');
  });

  it('still enforces order within a path group', async () => {
    const replay = createReplayHandler(interleavedTrace());
    await expect(replay(makeRequest('m', { n: 2 }), { stepPath: 'loop[0].a' })).rejects.toThrow(
      /params do not deep-equal/,
    );
  });
});

describe('execution path tagging (executor integration)', () => {
  function makeLoopFlow(): Flow {
    return {
      name: 'LoopPaths',
      description: 'loop path tagging test flow',
      context: { users: [{ id: 1 }, { id: 2 }, { id: 3 }] },
      steps: [
        {
          name: 'processUsers',
          loop: {
            over: '${context.users}',
            as: 'u',
            step: {
              name: 'fetchUser',
              request: { method: 'getUser', params: { id: '${u.id}' } },
            },
          },
        },
      ],
    };
  }

  it('tags recorded calls with the step execution path, per loop iteration', async () => {
    const inner: JsonRpcHandler = jest.fn(async (req) => ({
      id: (req.params as Record<string, unknown>).id,
    }));
    const { handler, getTrace } = createRecordingHandler(inner);
    const executor = new FlowExecutor(makeLoopFlow(), handler);
    await executor.execute();

    const trace = getTrace('LoopPaths');
    expect(trace.steps).toHaveLength(3);
    expect(trace.steps.map((s) => s.path).sort()).toEqual([
      'processUsers[0].fetchUser',
      'processUsers[1].fetchUser',
      'processUsers[2].fetchUser',
    ]);
    for (const entry of trace.steps) {
      expect(entry.step).toBe('fetchUser');
    }
  });

  it('replays a recorded loop run end-to-end with zero live calls', async () => {
    const network: JsonRpcHandler = jest.fn(async (req) => ({
      id: (req.params as Record<string, unknown>).id,
    }));
    const { handler: recorder, getTrace } = createRecordingHandler(network);
    const flow = { ...makeLoopFlow(), context: { users: [{ id: 1 }, { id: 2 }] } };
    const recordExecutor = new FlowExecutor(flow, recorder);
    const recordedResults = await recordExecutor.execute();
    const trace = getTrace('LoopPaths');
    expect(network).toHaveBeenCalledTimes(2);

    const replay = createReplayHandler(trace);
    const replayExecutor = new FlowExecutor(flow, replay);
    const replayedResults = await replayExecutor.execute();

    expect(network).toHaveBeenCalledTimes(2); // replay never touched the network
    const recordedLoop = recordedResults.get('processUsers').result;
    const replayedLoop = replayedResults.get('processUsers').result;
    expect(replayedLoop.iterationCount).toBe(recordedLoop.iterationCount);
    expect(replayedLoop.value.map((v: { result: unknown }) => v.result)).toEqual(
      recordedLoop.value.map((v: { result: unknown }) => v.result),
    );
  });

  it('supports path-keyed what-if overrides for a single iteration', async () => {
    const network: JsonRpcHandler = jest.fn(async (req) => ({
      id: (req.params as Record<string, unknown>).id,
    }));
    const { handler: recorder, getTrace } = createRecordingHandler(network);
    const flow = { ...makeLoopFlow(), context: { users: [{ id: 1 }, { id: 2 }] } };
    const recordExecutor = new FlowExecutor(flow, recorder);
    await recordExecutor.execute();
    const trace = getTrace('LoopPaths');

    // What if the second iteration's fetch returned a different user?
    // Only that iteration's path is overridden; the other replays recorded.
    const replay = createReplayHandler(trace, {
      overrides: { 'processUsers[1].fetchUser': { id: 2, vip: true } },
    });
    const replayExecutor = new FlowExecutor(flow, replay);
    const results = await replayExecutor.execute();

    const values = results
      .get('processUsers')
      .result.value.map((v: { result: unknown }) => v.result);
    expect(values).toEqual([{ id: 1 }, { id: 2, vip: true }]);
    expect(network).toHaveBeenCalledTimes(2);
  });
});

describe('overrideSequence (failure injection)', () => {
  function seqTrace(): RecordedTrace {
    const entry = (result: unknown): RecordedTrace['steps'][number] => ({
      path: 'fetch',
      step: 'fetch',
      method: 'get',
      params: {},
      result,
      durationMs: 1,
      timestamp: new Date().toISOString(),
    });
    return {
      flowName: 's',
      recordedAt: new Date().toISOString(),
      steps: [entry('recorded-1'), entry('recorded-2')],
    };
  }

  const call = (replay: ReturnType<typeof createReplayHandler>) =>
    replay(makeRequest('get'), { stepPath: 'fetch' });

  it('serves sequence responses in order across successive calls', async () => {
    const replay = createReplayHandler(seqTrace(), {
      overrides: { fetch: overrideSequence('first', 'second') },
    });
    await expect(call(replay)).resolves.toBe('first');
    await expect(call(replay)).resolves.toBe('second');
  });

  it('re-throws sequence items shaped as recorded errors', async () => {
    const replay = createReplayHandler(seqTrace(), {
      overrides: {
        fetch: overrideSequence({ error: { message: 'boom', code: -32000 } }, 'recovered'),
      },
    });
    const err = await call(replay).catch((e) => e);
    expect(err).toBeInstanceOf(JsonRpcRequestError);
    expect(err.message).toBe('boom');
    await expect(call(replay)).resolves.toBe('recovered');
  });

  it('throws ReplayError when the sequence is spent', async () => {
    const replay = createReplayHandler(seqTrace(), {
      overrides: { fetch: overrideSequence('only') },
    });
    await call(replay);
    await expect(call(replay)).rejects.toThrow(/sequence is spent/);
  });

  it('treats a bare array override as a single array-valued response', async () => {
    const replay = createReplayHandler(seqTrace(), { overrides: { fetch: [1, 2, 3] } });
    await expect(call(replay)).resolves.toEqual([1, 2, 3]);
  });
});

describe('createReplayHandler overrides shape validation', () => {
  it('throws a helpful error when overrides is a bare overrideSequence(...)', () => {
    expect(() =>
      createReplayHandler(makeTrace(), { overrides: overrideSequence('a', 'b') as never }),
    ).toThrow(
      /`overrides` must be a path-keyed record like { getPrice: overrideSequence\(50\) } — did you pass overrideSequence\(\.\.\.\) directly\?/,
    );
  });

  it('throws a ReplayError for a bare overrideSequence(...)', () => {
    let thrown: unknown;
    try {
      createReplayHandler(makeTrace(), { overrides: overrideSequence('a') as never });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ReplayError);
  });

  it('still accepts path-keyed plain-value overrides', async () => {
    const replay = createReplayHandler(makeTrace(), { overrides: { getUser: { name: 'zed' } } });
    await expect(
      replay(makeRequest('getUser', { id: 1 }), { stepPath: 'getUser' }),
    ).resolves.toEqual({ name: 'zed' });
  });

  it('still accepts path-keyed sequence overrides', async () => {
    const replay = createReplayHandler(makeTrace(), {
      overrides: { getUser: overrideSequence({ name: 'one' }, { name: 'two' }) },
    });
    await expect(
      replay(makeRequest('getUser', { id: 1 }), { stepPath: 'getUser' }),
    ).resolves.toEqual({ name: 'one' });
  });
});

describe('getReplayReport', () => {
  it('reports consumed counts and unconsumed entries', async () => {
    const replay = createReplayHandler(makeTrace());
    await replay(makeRequest('getUser', { id: 1 }));
    const report = replay.getReplayReport();
    expect(report.consumed).toEqual({ getUser: 1 });
    expect(report.unconsumed).toEqual([{ path: 'greet', remaining: 1 }]);
  });

  it('throws in strict mode when entries go unconsumed', async () => {
    const replay = createReplayHandler(makeTrace(), { strict: true });
    await replay(makeRequest('getUser', { id: 1 }));
    expect(() => replay.getReplayReport()).toThrow(/Strict replay.*greet/);
  });

  it('passes strict mode when everything is consumed', async () => {
    const replay = createReplayHandler(makeTrace(), { strict: true });
    await replay(makeRequest('getUser', { id: 1 }));
    await replay(makeRequest('greet', { name: 'ann' }));
    expect(replay.getReplayReport().unconsumed).toEqual([]);
  });
});

describe('validateTraceForFlow', () => {
  it('passes when digests match or the trace carries none', () => {
    expect(() => validateTraceForFlow(makeTrace(), {})).not.toThrow();
    const hashed: RecordedTrace = {
      ...makeTrace(),
      stepHashes: { getUser: 'abc', greet: 'def' },
    };
    expect(() => validateTraceForFlow(hashed, { getUser: 'abc', greet: 'def' })).not.toThrow();
  });

  it('throws ReplayError naming the stale steps', () => {
    const trace: RecordedTrace = {
      ...makeTrace(),
      stepHashes: { getUser: 'old', greet: 'def' },
    };
    expect(() => validateTraceForFlow(trace, { getUser: 'new', greet: 'def' })).toThrow(
      /stale.*getUser/,
    );
  });

  it('ignores steps removed from the flow', () => {
    const trace: RecordedTrace = {
      ...makeTrace(),
      stepHashes: { getUser: 'abc', gone: 'x' },
    };
    expect(() => validateTraceForFlow(trace, { getUser: 'abc' })).not.toThrow();
  });
});
