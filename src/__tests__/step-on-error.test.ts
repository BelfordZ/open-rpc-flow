import { FlowExecutor, FlowEventType, ValidationError } from '../index';
import { TestLogger } from '../util/logger';
import { Flow, JsonRpcRequest, StepErrorInfo } from '../types';
import { validateFlow } from '../flow-doctor';
import { FlowDiagnosticCode } from '../flow-doctor/types';
import { createRecordingHandler, createReplayHandler } from '../record-replay';
import { DependencyResolver } from '../dependency-resolver';
import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';
import { ReferenceResolver } from '../reference-resolver';
import type { OpenRpcDocument } from '../flow-doctor/types';

/**
 * Per-step error recovery via `onError` (issue #193).
 *
 * A step that fails after retries are exhausted can recover instead of
 * failing the flow:
 * - `onError: { fallback }` — the fallback value (resolved against the
 *   normal input/context/completed-step scope) becomes the step's result;
 * - `onError: { step }` — one nested recovery step runs with `${error}`
 *   in scope; its `.result` becomes the parent's recovered result;
 * - `onError: {}` — the error summary itself becomes the result.
 *
 * A recovered step stays `success`; its result envelope carries the caught
 * failure as `error`, the parent emits `step:error` then `step:recovered`
 * (no `step:complete`), and dependents proceed normally.
 */
describe('per-step error recovery with onError (issue #193)', () => {
  const testLogger = () => new TestLogger('OnErrorTest');

  /** Programmable handler: per-method behavior, throwing when told to. */
  const handlerFor = (
    methods: Record<string, (params: any) => any>,
    calls: string[] = [],
  ): jest.Mock & { calls: string[] } => {
    const handler = jest.fn(async (request: JsonRpcRequest) => {
      calls.push(request.method);
      const impl = methods[request.method];
      if (!impl) {
        throw new Error(`No mock response for method: ${request.method}`);
      }
      return impl(request.params);
    });
    (handler as any).calls = calls;
    return handler as jest.Mock & { calls: string[] };
  };

  const trackEvents = (executor: FlowExecutor) => {
    const events: Array<{ type: string; payload: any }> = [];
    for (const type of Object.values(FlowEventType)) {
      executor.events.on(type, (payload) => events.push({ type, payload }));
    }
    return events;
  };

  const codedError = (message: string, code: string | number): Error => {
    const error = new Error(message);
    (error as any).code = code;
    return error;
  };

  describe('fallback recovery', () => {
    it('recovers with a static fallback value', async () => {
      const flow: Flow = {
        name: 'static-fallback',
        description: 'static fallback',
        steps: [
          { name: 'risky', request: { method: 'risky', params: {} }, onError: { fallback: 0 } },
          {
            name: 'downstream',
            request: { method: 'echo', params: { v: '${risky.result}' } },
          },
        ],
      };
      const handler = handlerFor({
        risky: () => {
          throw new Error('boom');
        },
        echo: (params) => params.v,
      });
      const executor = new FlowExecutor(flow, handler, { logger: testLogger() });

      const results = await executor.execute();

      const risky = results.get('risky')!;
      expect(risky.result).toBe(0);
      expect(risky.type).toBe('request');
      expect(risky.error).toMatchObject({ name: 'ExecutionError' });
      expect((risky.error as StepErrorInfo).message).toContain('boom');
      // The downstream dependent ran with the recovered value.
      expect(results.get('downstream')!.result).toBe(0);
    });

    it('resolves an expression fallback against input', async () => {
      const flow: Flow = {
        name: 'input-fallback',
        description: 'input fallback',
        steps: [
          {
            name: 'risky',
            request: { method: 'risky', params: {} },
            onError: { fallback: '${input.defaultPrice}' },
          },
        ],
      };
      const handler = handlerFor({
        risky: () => {
          throw new Error('boom');
        },
      });
      const results = await new FlowExecutor(flow, handler, { logger: testLogger() }).execute({
        defaultPrice: 42,
      });

      expect(results.get('risky')!.result).toBe(42);
    });

    it('resolves a fallback reference to another step and orders the dependency', async () => {
      const flow: Flow = {
        name: 'step-fallback',
        description: 'step fallback',
        steps: [
          { name: 'base', request: { method: 'base', params: {} } },
          {
            name: 'risky',
            request: { method: 'risky', params: {} },
            onError: { fallback: '${base.result}' },
          },
        ],
      };
      const handler = handlerFor({
        base: () => 10,
        risky: () => {
          throw new Error('boom');
        },
      });
      const results = await new FlowExecutor(flow, handler, { logger: testLogger() }).execute();

      // `base` is registered as a dependency of `risky`, so it always
      // completes before the fallback resolves.
      expect(results.get('risky')!.result).toBe(10);
    });

    it('recovers a non-request step type via the same hook', async () => {
      const flow: Flow = {
        name: 'transform-fallback',
        description: 'transform fallback',
        steps: [
          {
            name: 'shaper',
            transform: { input: '${context.missing.deep}', operations: [] },
            onError: { fallback: 'shaped-fallback' },
          },
        ],
      };
      const results = await new FlowExecutor(flow, handlerFor({}), {
        logger: testLogger(),
      }).execute();

      expect(results.get('shaper')!.result).toBe('shaped-fallback');
      expect(results.get('shaper')!.error).toBeDefined();
    });

    it('waits for retries to exhaust before recovering', async () => {
      const calls: string[] = [];
      const flow: Flow = {
        name: 'retry-then-recover',
        description: 'retry then recover',
        steps: [
          {
            name: 'flaky',
            request: { method: 'flaky', params: {} },
            policies: { retryPolicy: { maxAttempts: 2, backoff: { initial: 0 } } },
            onError: { fallback: 'recovered' },
          },
        ],
      };
      const handler = handlerFor(
        {
          flaky: () => {
            throw new Error('still failing');
          },
        },
        calls,
      );
      const results = await new FlowExecutor(flow, handler, { logger: testLogger() }).execute();

      expect(calls.filter((c) => c === 'flaky')).toHaveLength(2);
      expect(results.get('flaky')!.result).toBe('recovered');
    });

    it('does not recover when a retry succeeds', async () => {
      let attempts = 0;
      const flow: Flow = {
        name: 'retry-succeeds',
        description: 'retry succeeds',
        steps: [
          {
            name: 'flaky',
            request: { method: 'flaky', params: {} },
            policies: { retryPolicy: { maxAttempts: 3, backoff: { initial: 0 } } },
            onError: { fallback: 'recovered' },
          },
        ],
      };
      const handler = handlerFor({
        flaky: () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error('first attempt fails');
          }
          return 'second attempt ok';
        },
      });
      const executor = new FlowExecutor(flow, handler, { logger: testLogger() });
      const events = trackEvents(executor);

      const results = await executor.execute();

      expect(results.get('flaky')!.result).toBe('second attempt ok');
      expect(results.get('flaky')!.error).toBeUndefined();
      expect(events.some((e) => e.type === FlowEventType.STEP_RECOVERED)).toBe(false);
    });

    it('recovers from a step timeout', async () => {
      const flow: Flow = {
        name: 'timeout-recovery',
        description: 'timeout recovery',
        steps: [
          {
            name: 'slow',
            request: { method: 'slow', params: {} },
            timeout: 50,
            onError: { fallback: 'timed-out-fallback' },
          },
        ],
      };
      const handler = handlerFor({
        slow: async () => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          return 'too late';
        },
      });
      const results = await new FlowExecutor(flow, handler, { logger: testLogger() }).execute();

      expect(results.get('slow')!.result).toBe('timed-out-fallback');
      expect(results.get('slow')!.error).toMatchObject({ name: 'ExecutionError' });
      expect((results.get('slow')!.error as StepErrorInfo).message).toContain('timed out');
    });
  });

  describe('nested recovery steps', () => {
    it('runs a nested recovery step with ${error} in scope and adopts its result', async () => {
      const calls: Array<{ method: string; params: any }> = [];
      const flow: Flow = {
        name: 'nested-recovery',
        description: 'nested recovery',
        steps: [
          {
            name: 'risky',
            request: { method: 'risky', params: {} },
            onError: {
              step: {
                name: 'recover',
                request: {
                  method: 'log',
                  params: { reason: '${error.message}', code: '${error.code}' },
                },
              },
            },
          },
        ],
      };
      const handler = jest.fn(async (request: JsonRpcRequest) => {
        calls.push({ method: request.method, params: request.params });
        if (request.method === 'risky') {
          throw codedError('kaput', -32000);
        }
        return { logged: request.params };
      });
      const executor = new FlowExecutor(flow, handler, { logger: testLogger() });
      const events = trackEvents(executor);

      const results = await executor.execute();

      // The parent's result is the nested step's `.result`.
      const loggedParams = { reason: expect.stringContaining('kaput'), code: -32000 };
      expect(results.get('risky')!.result).toEqual({ logged: loggedParams });
      expect(results.get('risky')!.error).toMatchObject({ code: -32000 });
      expect((results.get('risky')!.error as StepErrorInfo).message).toContain('kaput');
      // The nested step is recorded under its own name.
      expect(results.get('recover')!.result).toEqual({ logged: loggedParams });
      // The nested step emits its own start/complete events.
      const nestedEvents = events.filter((e) => e.payload.stepName === 'recover');
      expect(nestedEvents.map((e) => e.type)).toEqual([
        FlowEventType.STEP_START,
        FlowEventType.STEP_COMPLETE,
      ]);
    });

    it('honors the nested step’s own retry policy', async () => {
      let attempts = 0;
      const flow: Flow = {
        name: 'nested-retry',
        description: 'nested retry',
        steps: [
          {
            name: 'risky',
            request: { method: 'risky', params: {} },
            onError: {
              step: {
                name: 'recover',
                request: { method: 'recover', params: {} },
                policies: { retryPolicy: { maxAttempts: 2, backoff: { initial: 0 } } },
              },
            },
          },
        ],
      };
      const handler = handlerFor({
        risky: () => {
          throw new Error('original');
        },
        recover: () => {
          attempts += 1;
          if (attempts === 1) {
            throw new Error('recover attempt 1 fails');
          }
          return 'recovered on retry';
        },
      });
      const results = await new FlowExecutor(flow, handler, { logger: testLogger() }).execute();

      expect(attempts).toBe(2);
      expect(results.get('risky')!.result).toBe('recovered on retry');
    });

    it('fails the parent for real when the nested recovery step fails, keeping the cause chain', async () => {
      const flow: Flow = {
        name: 'nested-failure',
        description: 'nested failure',
        steps: [
          {
            name: 'risky',
            request: { method: 'risky', params: {} },
            onError: { step: { name: 'recover', request: { method: 'recover', params: {} } } },
          },
          { name: 'never', request: { method: 'never', params: {} } },
        ],
      };
      const handler = handlerFor({
        risky: () => {
          throw new Error('original boom');
        },
        recover: () => {
          throw new Error('recovery boom');
        },
        never: () => 'never runs',
      });
      const executor = new FlowExecutor(flow, handler, { logger: testLogger() });

      const failure = await executor.execute().catch((error) => error);
      expect(failure).toBeDefined();
      const message = String(failure?.message ?? failure);
      expect(message).toContain('recovery boom');
      // The original failure is retained as the cause.
      const cause = (failure as { cause?: Error })?.cause;
      expect(cause?.message).toContain('original boom');
    });

    it('adopts the result when the nested recovery step stops', async () => {
      const flow: Flow = {
        name: 'nested-stop',
        description: 'nested stop',
        steps: [
          {
            name: 'risky',
            request: { method: 'risky', params: {} },
            onError: { step: { name: 'halt', stop: {} } },
          },
        ],
      };
      const handler = handlerFor({
        risky: () => {
          throw new Error('boom');
        },
      });
      const results = await new FlowExecutor(flow, handler, { logger: testLogger() }).execute();

      // The stop step's result becomes the parent's recovered result.
      expect(results.get('risky')).toBeDefined();
      expect((results.get('risky')!.error as StepErrorInfo).message).toContain('boom');
    });
  });

  describe('bare onError', () => {
    it('uses the error summary as the result and drives a downstream switch on ${step.result.code}', async () => {
      const flow: Flow = {
        name: 'bare-on-error',
        description: 'bare onError',
        steps: [
          { name: 'risky', request: { method: 'risky', params: {} }, onError: {} },
          {
            name: 'route',
            condition: {
              switch: '${risky.result.code}',
              cases: {
                '-32000': [{ name: 'handled', request: { method: 'handled', params: {} } }],
              },
              default: [{ name: 'unhandled', request: { method: 'unhandled', params: {} } }],
            },
          },
        ],
      };
      const calls: string[] = [];
      const handler = handlerFor(
        {
          risky: () => {
            throw codedError('service exploded', -32000);
          },
          handled: () => 'handled-ok',
          unhandled: () => 'unhandled-ok',
        },
        calls,
      );
      const results = await new FlowExecutor(flow, handler, { logger: testLogger() }).execute();

      const risky = results.get('risky')!;
      expect(risky.result).toMatchObject({ name: 'ExecutionError', code: -32000 });
      expect((risky.result as StepErrorInfo).message).toContain('service exploded');
      expect(risky.error).toEqual(risky.result);
      // The switch routed on the error code.
      expect(calls).toContain('handled');
      expect(calls).not.toContain('unhandled');
    });

    it('preserves string/number codes and drops non-string/number codes', async () => {
      const flow: Flow = {
        name: 'bare-normalize',
        description: 'bare normalize',
        steps: [
          { name: 'strCode', request: { method: 'strCode', params: {} }, onError: {} },
          { name: 'odd', request: { method: 'odd', params: {} }, onError: {} },
        ],
      };
      const handler = handlerFor({
        strCode: () => {
          throw codedError('string-coded failure', 'E_CUSTOM');
        },
        odd: () => {
          const error = new Error('odd code');
          (error as any).code = { weird: true };
          throw error;
        },
      });
      const results = await new FlowExecutor(flow, handler, { logger: testLogger() }).execute();

      // A string code survives normalization…
      const strInfo = results.get('strCode')!.result as StepErrorInfo;
      expect(strInfo.code).toBe('E_CUSTOM');
      expect(strInfo.message).toContain('string-coded failure');
      // …while a non-string/number code is dropped to stay JSON-safe.
      const oddInfo = results.get('odd')!.result as StepErrorInfo;
      expect(oddInfo.message).toContain('odd code');
      expect('code' in oddInfo).toBe(false);
    });
  });
});

describe('per-step error recovery events and flow behavior (issue #193)', () => {
  const testLogger = () => new TestLogger('OnErrorEventsTest');

  const handlerFor = (methods: Record<string, (params: any) => any>, calls: string[] = []) =>
    jest.fn(async (request: JsonRpcRequest) => {
      calls.push(request.method);
      const impl = methods[request.method];
      if (!impl) {
        throw new Error(`No mock response for method: ${request.method}`);
      }
      return impl(request.params);
    });

  const trackEvents = (executor: FlowExecutor) => {
    const events: Array<{ type: string; payload: any }> = [];
    for (const type of Object.values(FlowEventType)) {
      executor.events.on(type, (payload) => events.push({ type, payload }));
    }
    return events;
  };

  const failingFlow = (): Flow => ({
    name: 'recovery-events',
    description: 'recovery events',
    steps: [
      { name: 'risky', request: { method: 'risky', params: {} }, onError: { fallback: 'fb' } },
      { name: 'after', request: { method: 'after', params: { v: '${risky.result}' } } },
    ],
  });

  const failingHandler = (calls: string[]) =>
    handlerFor(
      {
        risky: () => {
          throw new Error('boom');
        },
        after: (params) => params.v,
      },
      calls,
    );

  it('emits step:error then step:recovered for the parent, with no step:complete', async () => {
    const calls: string[] = [];
    const executor = new FlowExecutor(failingFlow(), failingHandler(calls), {
      logger: testLogger(),
    });
    const events = trackEvents(executor);

    await executor.execute();

    const riskyEvents = events.filter((e) => e.payload.stepName === 'risky');
    const types = riskyEvents.map((e) => e.type);
    expect(types).toEqual([
      FlowEventType.STEP_START,
      FlowEventType.STEP_ERROR,
      FlowEventType.STEP_RECOVERED,
    ]);
    const recovered = riskyEvents.find((e) => e.type === FlowEventType.STEP_RECOVERED)!;
    expect(recovered.payload.stepName).toBe('risky');
    expect(recovered.payload.result.result).toBe('fb');
    expect(recovered.payload.error.message).toContain('boom');
    expect(recovered.payload.duration).toEqual(expect.any(Number));
    expect(recovered.payload.correlationId).toEqual(expect.any(String));
  });

  it('emits step:timeout for a recovered timeout, mirroring the failure path', async () => {
    const flow: Flow = {
      name: 'recovery-timeout-event',
      description: 'recovery timeout event',
      steps: [
        {
          name: 'slow',
          request: { method: 'slow', params: {} },
          timeout: 50,
          onError: { fallback: 'fb' },
        },
      ],
    };
    const executor = new FlowExecutor(
      flow,
      handlerFor({
        slow: async () => {
          await new Promise((resolve) => setTimeout(resolve, 500));
          return 'too late';
        },
      }),
      { logger: testLogger() },
    );
    const events = trackEvents(executor);

    await executor.execute();

    const types = events.filter((e) => e.payload.stepName === 'slow').map((e) => e.type);
    expect(types).toEqual([
      FlowEventType.STEP_START,
      FlowEventType.STEP_TIMEOUT,
      FlowEventType.STEP_ERROR,
      FlowEventType.STEP_RECOVERED,
    ]);
  });

  it('marks the recovered parent success without scheduling dependents twice', async () => {
    const calls: string[] = [];
    const executor = new FlowExecutor(failingFlow(), failingHandler(calls), {
      logger: testLogger(),
    });
    const events = trackEvents(executor);

    const results = await executor.execute();

    // Dependents proceed exactly once.
    expect(calls.filter((c) => c === 'after')).toHaveLength(1);
    expect(results.get('after')!.result).toBe('fb');
    // step:complete fired once for `after`, never for `risky`.
    expect(
      events.filter(
        (e) => e.type === FlowEventType.STEP_COMPLETE && e.payload.stepName === 'after',
      ),
    ).toHaveLength(1);
  });

  it('does not trigger flow-level onFailure abort-flow', async () => {
    const flow: Flow = {
      name: 'no-abort',
      description: 'no abort',
      policies: { global: { execution: { maxConcurrency: 1, onFailure: 'abort-flow' } } },
      steps: [
        { name: 'risky', request: { method: 'risky', params: {} }, onError: { fallback: 'fb' } },
        { name: 'later', request: { method: 'later', params: {} } },
      ],
    };
    const callsWithLater: string[] = [];
    const handlerWithLater = handlerFor(
      {
        risky: () => {
          throw new Error('boom');
        },
        later: () => 'later-ok',
      },
      callsWithLater,
    );
    const executor = new FlowExecutor(flow, handlerWithLater, { logger: testLogger() });
    const events = trackEvents(executor);

    const results = await executor.execute();

    expect(callsWithLater).toContain('later');
    expect(results.get('later')).toBeDefined();
    expect(events.some((e) => e.type === FlowEventType.FLOW_ABORTED)).toBe(false);
    expect(events.some((e) => e.type === FlowEventType.FLOW_COMPLETE)).toBe(true);
  });

  it('emits no step events when emitStepEvents is disabled, but still recovers', async () => {
    const calls: string[] = [];
    const executor = new FlowExecutor(failingFlow(), failingHandler(calls), {
      logger: testLogger(),
      eventOptions: { emitStepEvents: false },
    });
    const events = trackEvents(executor);

    const results = await executor.execute();

    expect(results.get('risky')!.result).toBe('fb');
    expect(events.filter((e) => e.payload?.stepName === 'risky')).toHaveLength(0);
  });
});

describe('onError dependency resolution (issue #193)', () => {
  const testLogger = () => new TestLogger('OnErrorDepsTest');
  const newResolver = (flow: Flow) => {
    const referenceResolver = new ReferenceResolver(new Map(), {}, testLogger());
    const expressionEvaluator = new SafeExpressionEvaluator(testLogger(), referenceResolver);
    return new DependencyResolver(flow, expressionEvaluator, testLogger());
  };

  it('treats fallback references as parent dependencies', async () => {
    const flow: Flow = {
      name: 'deps-fallback',
      description: 'deps fallback',
      steps: [
        { name: 'base', request: { method: 'base', params: {} } },
        {
          name: 'risky',
          request: { method: 'risky', params: {} },
          onError: { fallback: '${base.result}' },
        },
      ],
    };
    expect(newResolver(flow).getDependencies('risky')).toContain('base');
  });

  it('treats nested recovery step references as parent dependencies, ignoring ${error}', async () => {
    const flow: Flow = {
      name: 'deps-nested',
      description: 'deps nested',
      steps: [
        { name: 'base', request: { method: 'base', params: {} } },
        {
          name: 'risky',
          request: { method: 'risky', params: {} },
          onError: {
            step: {
              name: 'recover',
              request: { method: 'log', params: { b: '${base.result}', e: '${error.code}' } },
            },
          },
        },
      ],
    };
    // `${error}` is recovery-local; only the real step reference becomes a dep.
    expect(newResolver(flow).getDependencies('risky')).toEqual(['base']);
  });

  it('resolves downstream references to the nested recovery step name onto the parent', async () => {
    const flow: Flow = {
      name: 'deps-remap',
      description: 'deps remap',
      steps: [
        {
          name: 'risky',
          request: { method: 'risky', params: {} },
          onError: { step: { name: 'recover', request: { method: 'log', params: {} } } },
        },
        { name: 'audit', request: { method: 'audit', params: { r: '${recover.result}' } } },
      ],
    };
    expect(newResolver(flow).getDependencies('audit')).toEqual(['risky']);
  });

  it('rejects unknown recovery-step references at graph build time', () => {
    const flow: Flow = {
      name: 'deps-unknown',
      description: 'deps unknown',
      steps: [
        {
          name: 'risky',
          request: { method: 'risky', params: {} },
          onError: { fallback: '${nope.result}' },
        },
      ],
    };
    expect(() => newResolver(flow).getExecutionOrder()).toThrow(/unknown step 'nope'/);
  });
});

describe('Flow Doctor onError validation (issue #193)', () => {
  const makeFlow = (steps: any[]): Flow => ({
    name: 'doctor',
    description: 'doctor',
    steps,
  });
  // validateFlow requires a document; method 'm' keeps method checks quiet so
  // the assertions below only see the onError diagnostics.
  const doctorDocument: OpenRpcDocument = {
    openrpc: '1.2.6',
    info: { title: 'Test API', version: '1.0.0' },
    methods: [{ name: 'm', params: [], result: { schema: {} } }],
  };

  const invalidCases: Array<[string, any]> = [
    ['non-object onError', 'nope'],
    ['unknown keys', { bogus: 1 }],
    ['fallback and step together', { fallback: 1, step: { name: 'r' } }],
    [
      'fallback and step together with an undefined fallback',
      { fallback: undefined, step: { name: 'r' } },
    ],
    ['fallback and step together with an undefined step', { fallback: 1, step: undefined }],
    ['recovery step without a name', { step: {} }],
    ['recovery step declaring its own onError', { step: { name: 'r', onError: {} } }],
    ['non-object recovery step', { step: 'nope' }],
  ];

  it.each(invalidCases)('rejects %s', (_label, onError) => {
    const flow = makeFlow([{ name: 'risky', request: { method: 'm', params: {} }, onError }]);
    const diagnostics = validateFlow(flow, doctorDocument);
    const flagged = diagnostics.filter((d) => d.code === FlowDiagnosticCode.INVALID_ON_ERROR);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((d) => d.severity === 'error')).toBe(true);
    expect(flagged[0].step).toBe('risky');
  });

  it('accepts valid shapes and scopes ${error} to the nested recovery step', () => {
    const flow = makeFlow([
      { name: 'a', request: { method: 'm', params: {} }, onError: { fallback: 0 } },
      { name: 'b', request: { method: 'm', params: {} }, onError: {} },
      {
        name: 'c',
        request: { method: 'm', params: {} },
        onError: {
          step: { name: 'recoverC', request: { method: 'n', params: { e: '${error.code}' } } },
        },
      },
    ]);
    const diagnostics = validateFlow(flow, doctorDocument);
    expect(diagnostics.filter((d) => d.code === FlowDiagnosticCode.INVALID_ON_ERROR)).toEqual([]);
    // `${error}` resolves inside the recovery step — no unknown-reference diagnostic.
    expect(
      diagnostics.filter(
        (d) => d.code === FlowDiagnosticCode.UNKNOWN_STEP_REFERENCE && d.step === 'recoverC',
      ),
    ).toEqual([]);
  });

  it('flags ${error} used in the parent scope as an unknown reference', () => {
    const flow = makeFlow([
      {
        name: 'risky',
        request: { method: 'm', params: {} },
        onError: { fallback: '${error.code}' },
      },
    ]);
    const diagnostics = validateFlow(flow, doctorDocument);
    expect(
      diagnostics.some(
        (d) => d.code === FlowDiagnosticCode.UNKNOWN_STEP_REFERENCE && d.step === 'risky',
      ),
    ).toBe(true);
  });
});

describe('onError upfront and runtime validation (issue #193)', () => {
  const testDocument: OpenRpcDocument = {
    openrpc: '1.2.6',
    info: { title: 'Test API', version: '1.0.0' },
    methods: [
      {
        name: 'ping',
        params: [],
        result: { schema: { type: 'string' } },
      },
    ],
  };
  const handler = jest.fn(async () => 'pong');
  const testLogger = () => new TestLogger('OnErrorValidateTest');

  it('fails fast at construction with validateUpfront', () => {
    const flow: Flow = {
      name: 'upfront',
      description: 'upfront',
      steps: [
        {
          name: 'risky',
          request: { method: 'ping', params: {} },
          onError: { bogus: 1 } as any,
        },
      ],
    };
    let error: ValidationError | undefined;
    try {
      new FlowExecutor(flow, handler, {
        validateUpfront: true,
        openrpcDocument: testDocument,
        logger: testLogger(),
      });
    } catch (e) {
      error = e as ValidationError;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect(error?.message).toContain('unknown onError key(s)');
    const context = error?.context as { diagnostics?: Array<{ code: string }> };
    expect(context.diagnostics?.[0]?.code).toBe(FlowDiagnosticCode.INVALID_ON_ERROR);
  });

  it.each([
    ['non-object', 'nope'],
    ['unknown keys', { bogus: 1 }],
    ['fallback and step together', { fallback: 1, step: { name: 'r' } }],
    [
      'fallback and step together with an undefined fallback',
      { fallback: undefined, step: { name: 'r' } },
    ],
    ['recovery step without a name', { step: {} }],
    ['array recovery step', { step: [] }],
    ['nested onError', { step: { name: 'r', onError: {} } }],
  ])('fails fast at recovery time without upfront validation: %s', async (_label, onError) => {
    const flow: Flow = {
      name: 'runtime-validate',
      description: 'runtime validate',
      steps: [
        {
          name: 'risky',
          request: { method: 'ping', params: {} },
          onError: onError as any,
        },
      ],
    };
    const failing = jest.fn(async () => {
      throw new Error('boom');
    });
    const executor = new FlowExecutor(flow, failing, { logger: testLogger() });
    await expect(executor.execute()).rejects.toThrow(ValidationError);
  });
});

describe('onError checkpoint and replay (issue #193)', () => {
  const testLogger = () => new TestLogger('OnErrorCheckpointTest');

  const flow: Flow = {
    name: 'recovery-checkpoint',
    description: 'recovery checkpoint',
    steps: [
      { name: 'risky', request: { method: 'risky', params: {} }, onError: { fallback: 'fb' } },
      { name: 'after', request: { method: 'after', params: { v: '${risky.result}' } } },
    ],
  };

  it('round-trips recovered results through export/import without re-running', async () => {
    const calls: string[] = [];
    const failing = jest.fn(async (request: JsonRpcRequest) => {
      calls.push(request.method);
      if (request.method === 'risky') {
        throw new Error('boom');
      }
      return (request.params as any).v;
    });
    const executor = new FlowExecutor(flow, failing, { logger: testLogger() });
    await executor.execute();

    const restored = JSON.parse(JSON.stringify(executor.exportState()));
    const neverCalled = jest.fn(async () => {
      throw new Error('should not run: recovered steps are skipped on resume');
    });
    const executor2 = new FlowExecutor(flow, neverCalled, { logger: testLogger() });
    executor2.importState(restored);
    const results = await executor2.execute();

    // The recovered value survived the round trip; nothing re-ran.
    expect(results.get('risky')!.result).toBe('fb');
    expect((results.get('risky')!.error as StepErrorInfo).message).toContain('boom');
    expect(results.get('after')!.result).toBe('fb');
    expect(neverCalled).not.toHaveBeenCalled();
    expect(calls).toEqual(['risky', 'after']);
  });

  it('replays the recorded failure so recovery reproduces the recovered value', async () => {
    const networkCalls: string[] = [];
    const network = jest.fn(async (request: JsonRpcRequest) => {
      networkCalls.push(request.method);
      if (request.method === 'risky') {
        throw new Error('recorded boom');
      }
      return (request.params as any).v;
    });
    const { handler: recorder, getTrace } = createRecordingHandler(network);
    const recordExecutor = new FlowExecutor(flow, recorder, { logger: testLogger() });
    const recorded = await recordExecutor.execute();
    expect(recorded.get('risky')!.result).toBe('fb');

    const replay = createReplayHandler(getTrace('onError-replay'));
    const replayCalls: string[] = [];
    const watching = jest.fn(async (request: JsonRpcRequest) => {
      replayCalls.push(request.method);
      return replay(request);
    });
    const replayExecutor = new FlowExecutor(flow, watching, { logger: testLogger() });
    const replayed = await replayExecutor.execute();

    // The replayed failure replays, recovery runs again, same recovered value.
    expect(replayed.get('risky')!.result).toBe('fb');
    expect(replayed.get('risky')!.error).toMatchObject({ message: 'recorded boom' });
    expect(replayed.get('after')!.result).toBe('fb');
    expect(networkCalls).toHaveLength(2); // replay never touched the network
    expect(replayCalls).toEqual(['risky', 'after']);
  });
});

describe('onError resume and skip interplay (issue #193)', () => {
  it('clears lastFailedStepName when a resumed run recovers the failed step', async () => {
    const flow: Flow = {
      name: 'resume-recover',
      description: 'resume recover',
      steps: [
        {
          name: 'risky',
          request: { method: 'risky', params: {} },
          onError: { step: { name: 'recover', request: { method: 'recover', params: {} } } },
        },
      ],
    };
    let recoverAttempts = 0;
    const handler = jest.fn(async (request: JsonRpcRequest) => {
      if (request.method === 'risky') {
        throw new Error('risky boom');
      }
      recoverAttempts += 1;
      if (recoverAttempts === 1) {
        throw new Error('recover boom');
      }
      return 'recovered';
    });
    const testLogger = () => new TestLogger('OnErrorResumeTest');

    const executor = new FlowExecutor(flow, handler, { logger: testLogger() });
    await expect(executor.execute()).rejects.toThrow('recover boom');
    expect(executor.exportState().lastFailedStepName).toBe('risky');

    const executor2 = new FlowExecutor(flow, handler, { logger: testLogger() });
    executor2.importState(JSON.parse(JSON.stringify(executor.exportState())));
    const results = await executor2.execute();

    expect(results.get('risky')!.result).toBe('recovered');
    expect(executor2.exportState().lastFailedStepName).toBeNull();
  });

  it('does not reschedule a dependent already skipped by another failure', async () => {
    const calls: string[] = [];
    const flow: Flow = {
      name: 'skipped-dependent',
      description: 'skipped dependent',
      policies: { global: { execution: { maxConcurrency: 1 } } },
      steps: [
        { name: 'doomed', request: { method: 'doomed', params: {} } },
        { name: 'risky', request: { method: 'risky', params: {} }, onError: { fallback: 'fb' } },
        {
          name: 'downstream',
          request: {
            method: 'downstream',
            params: { r: '${risky.result}', d: '${doomed.result}' },
          },
        },
      ],
    };
    const handler = jest.fn(async (request: JsonRpcRequest) => {
      calls.push(request.method);
      if (request.method === 'doomed' || request.method === 'risky') {
        throw new Error(`${request.method} boom`);
      }
      return 'downstream-ok';
    });
    const executor = new FlowExecutor(flow, handler, {
      logger: new TestLogger('OnErrorSkipTest'),
    });
    // doomed fails for real, so the flow rejects — but risky still recovers
    // and the skipped downstream is never scheduled.
    await expect(executor.execute()).rejects.toThrow('doomed boom');
    const stepResults = executor.exportState().stepResults as Record<string, { result: unknown }>;

    expect(stepResults['risky'].result).toBe('fb');
    expect(stepResults['downstream']).toBeUndefined();
    expect(calls).not.toContain('downstream');
  });
});
