import { FlowExecutor } from '../flow-executor';
import { Flow, FlowInput } from '../types';
import { noLogger } from '../util/logger';
import { PauseError } from '../errors/base';
import { ValidationError } from '../errors';
import { DependencyResolver } from '../dependency-resolver';
import { SafeExpressionEvaluator } from '../expression-evaluator/safe-evaluator';
import { ReferenceResolver } from '../reference-resolver';
import { validateFlow, OpenRpcDocument } from '../flow-doctor';
import { validateCheckpoint } from '../checkpoint';

/**
 * Tests for issue #194: runtime flow inputs.
 *
 * `execute(input)` supplies per-run values addressable as `${input.<key>}`
 * in any reference or expression. `execute()` with no arguments keeps working
 * with empty input, and the pre-input `execute({ signal })` options form is
 * preserved for backward compatibility.
 */
describe('FlowExecutor runtime input (#194)', () => {
  const inputFlow: Flow = {
    name: 'input-flow',
    description: 'flow exercising runtime input',
    steps: [
      {
        name: 'greet',
        request: {
          method: 'greet',
          params: { user: '${input.userId}', city: '${input.profile.city}' },
        },
      },
      {
        name: 'followUp',
        request: { method: 'followUp', params: { user: '${input.userId}' } },
      },
    ],
  };

  const makeHandler = () => {
    const seen: Array<{ method: string; params: unknown }> = [];
    const handler = jest.fn(async (request: { method: string; params?: unknown }) => {
      seen.push({ method: request.method, params: request.params });
      return { ok: true };
    });
    return { handler, seen };
  };

  it('resolves ${input.*} references in step params', async () => {
    const { handler, seen } = makeHandler();
    const executor = new FlowExecutor(inputFlow, handler as never, { logger: noLogger });

    await executor.execute({ userId: 'u-42', profile: { city: 'Chilliwack' } });

    expect(seen).toHaveLength(2);
    expect(seen[0].params).toEqual({ user: 'u-42', city: 'Chilliwack' });
    expect(seen[1].params).toEqual({ user: 'u-42' });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('resolves input inside conditions, loops, and switch branches', async () => {
    const flow: Flow = {
      name: 'input-everywhere',
      description: 'input in condition/loop/switch',
      steps: [
        {
          name: 'check',
          condition: {
            if: '${input.count} > 5',
            then: {
              name: 'big',
              request: { method: 'big', params: { n: '${input.count}' } },
            },
            else: {
              name: 'small',
              request: { method: 'small', params: {} },
            },
          },
        },
        {
          name: 'route',
          condition: {
            switch: '${input.tier}',
            cases: {
              gold: [
                {
                  name: 'goldStep',
                  request: { method: 'gold', params: { tier: '${input.tier}' } },
                },
              ],
            },
          },
        },
        {
          name: 'looped',
          loop: {
            over: '${input.items}',
            as: 'item',
            step: {
              name: 'each',
              request: { method: 'each', params: { v: '${item}', tag: '${input.tag}' } },
            },
          },
        },
      ],
    };
    const { handler, seen } = makeHandler();
    const executor = new FlowExecutor(flow, handler as never, { logger: noLogger });

    await executor.execute({ count: 21, tier: 'gold', items: ['a', 'b'], tag: 't' });

    const methods = seen.map((s) => s.method);
    expect(methods).toContain('big');
    expect(methods).not.toContain('small');
    expect(methods).toContain('gold');
    expect(seen.filter((s) => s.method === 'each')).toHaveLength(2);
    expect(seen.find((s) => s.method === 'big')?.params).toEqual({ n: 21 });
    expect(seen.find((s) => s.method === 'gold')?.params).toEqual({ tier: 'gold' });
    expect(seen.find((s) => s.method === 'each')?.params).toEqual({ v: 'a', tag: 't' });
  });

  it('treats input references as non-step dependencies', () => {
    const referenceResolver = new ReferenceResolver(new Map(), {}, noLogger);
    const expressionEvaluator = new SafeExpressionEvaluator(noLogger, referenceResolver);
    const resolver = new DependencyResolver(inputFlow, expressionEvaluator, noLogger);

    expect(resolver.getDependencies('greet')).toEqual([]);
    expect(resolver.getDependencies('followUp')).toEqual([]);
    expect(() => resolver.getExecutionOrder()).not.toThrow();
  });

  it('fails loudly when input is missing a referenced key', async () => {
    const { handler } = makeHandler();
    const executor = new FlowExecutor(inputFlow, handler as never, { logger: noLogger });

    await expect(executor.execute()).rejects.toThrow();
    await expect(executor.execute({})).rejects.toThrow();
  });

  it('deep-clones input so later caller mutations cannot affect the run', async () => {
    const { seen } = makeHandler();
    const handler = jest.fn(async (request: { method: string; params?: unknown }) => {
      seen.push({ method: request.method, params: request.params });
      return { ok: true };
    });
    const executor = new FlowExecutor(inputFlow, handler as never, { logger: noLogger });

    const input: FlowInput = { userId: 'u-1', profile: { city: 'Hope' } };
    const promise = executor.execute(input);
    input.userId = 'mutated';
    (input.profile as Record<string, unknown>).city = 'mutated';
    await promise;

    expect(seen[0].params).toEqual({ user: 'u-1', city: 'Hope' });
  });

  it('rejects non-object and non-serializable input', async () => {
    const { handler } = makeHandler();
    const executor = new FlowExecutor(inputFlow, handler as never, { logger: noLogger });

    await expect(executor.execute([1, 2] as unknown as FlowInput)).rejects.toThrow(ValidationError);
    await expect(executor.execute('nope' as unknown as FlowInput)).rejects.toThrow(ValidationError);
    await expect(executor.execute(null)).rejects.toThrow(ValidationError);

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(executor.execute(circular)).rejects.toThrow(ValidationError);
  });

  it('keeps the legacy execute({ signal }) options form working', async () => {
    const { handler } = makeHandler();
    const executor = new FlowExecutor(inputFlow, handler as never, { logger: noLogger });
    const controller = new AbortController();
    controller.abort('paused');

    await expect(executor.execute({ signal: controller.signal })).rejects.toThrow(PauseError);
  });

  it('does not mistake an input object with a non-signal "signal" key for options', async () => {
    const flow: Flow = {
      name: 'signal-key-flow',
      description: 'input containing a plain "signal" key',
      steps: [
        {
          name: 'only',
          request: { method: 'only', params: { s: '${input.signal}' } },
        },
      ],
    };
    const { seen } = makeHandler();
    const handler = jest.fn(async (request: { method: string; params?: unknown }) => {
      seen.push({ method: request.method, params: request.params });
      return { ok: true };
    });
    const executor = new FlowExecutor(flow, handler as never, { logger: noLogger });

    await executor.execute({ signal: 'not-an-abort-signal' });

    expect(seen[0].params).toEqual({ s: 'not-an-abort-signal' });
  });

  it('combines positional input with run options', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: unknown[] = [];
    const handler = jest.fn(async (request: { method: string; params?: unknown }) => {
      seen.push(request.params);
      await gate;
      return { ok: true };
    });
    const executor = new FlowExecutor(inputFlow, handler as never, { logger: noLogger });
    const controller = new AbortController();
    const promise = executor.execute(
      { userId: 'u-9', profile: { city: 'B' } },
      { signal: controller.signal },
    );
    // Wait until the first step is in flight, then cancel (not 'paused').
    for (let i = 0; i < 100 && handler.mock.calls.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 10));
    }
    controller.abort('cancelled');
    release();

    // The signal was honored as run options (a cancel, not a pause)...
    await expect(promise).rejects.toThrow('cancelled');
    // ...and the positional input was still applied to the in-flight step.
    expect(seen[0]).toEqual({ user: 'u-9', city: 'B' });
  });

  it('carries input through exportState/importState so resumes see the same values', async () => {
    const flow: Flow = {
      name: 'input-checkpoint-flow',
      description: 'checkpoint with input',
      steps: [
        { name: 'first', request: { method: 'first', params: { v: 1 } } },
        {
          name: 'second',
          request: { method: 'second', params: { user: '${input.userId}' } },
        },
      ],
    };
    const seen: unknown[] = [];
    const failingHandler = jest.fn(async (request: { method: string; params?: unknown }) => {
      if (request.method === 'second') {
        throw new Error('boom');
      }
      return { ok: true };
    });
    const succeedingHandler = jest.fn(async (request: { method: string; params?: unknown }) => {
      seen.push(request.params);
      return { ok: true };
    });

    const first = new FlowExecutor(flow, failingHandler as never, { logger: noLogger });
    await expect(first.execute({ userId: 'u-7' })).rejects.toThrow();
    const checkpoint = first.exportState();
    expect(checkpoint.input).toEqual({ userId: 'u-7' });

    // A fresh executor resumes from the checkpoint without being given input:
    // 'first' is skipped, 'second' re-runs and still resolves ${input.userId}.
    const second = new FlowExecutor(flow, succeedingHandler as never, { logger: noLogger });
    second.importState(checkpoint);
    await second.execute();

    expect(succeedingHandler).toHaveBeenCalledTimes(1);
    expect(succeedingHandler.mock.calls[0][0].method).toBe('second');
    expect(seen[0]).toEqual({ user: 'u-7' });
  });

  it('lets an explicit execute(input) override checkpoint-restored input', async () => {
    const flow: Flow = {
      name: 'input-override-flow',
      description: 'explicit input wins over checkpoint input',
      steps: [
        { name: 'first', request: { method: 'first', params: { v: 1 } } },
        {
          name: 'second',
          request: { method: 'second', params: { user: '${input.userId}' } },
        },
      ],
    };
    const seen: unknown[] = [];
    const failingHandler = jest.fn(async (request: { method: string; params?: unknown }) => {
      if (request.method === 'second') {
        throw new Error('boom');
      }
      return { ok: true };
    });
    const succeedingHandler = jest.fn(async (request: { method: string; params?: unknown }) => {
      seen.push(request.params);
      return { ok: true };
    });

    const first = new FlowExecutor(flow, failingHandler as never, { logger: noLogger });
    await expect(first.execute({ userId: 'old' })).rejects.toThrow();

    const second = new FlowExecutor(flow, succeedingHandler as never, { logger: noLogger });
    second.importState(first.exportState());
    // The resumed run re-runs the failed 'second' step with the new input.
    await second.execute({ userId: 'new' });

    expect(seen[seen.length - 1]).toEqual({ user: 'new' });
  });

  it('imports pre-input checkpoints with empty input', () => {
    const flow: Flow = {
      name: 'old-checkpoint-flow',
      description: 'checkpoint without an input field',
      steps: [{ name: 'only', request: { method: 'only', params: { v: 1 } } }],
    };
    const first = new FlowExecutor(flow, jest.fn(async () => ({ ok: true })) as never, {
      logger: noLogger,
    });
    const checkpoint = first.exportState();
    delete (checkpoint as unknown as Record<string, unknown>).input;

    // Old checkpoints stay valid...
    expect(() => validateCheckpoint(checkpoint)).not.toThrow();

    // ...and import cleanly, resuming with empty input.
    const second = new FlowExecutor(flow, jest.fn(async () => ({ ok: true })) as never, {
      logger: noLogger,
    });
    expect(() => second.importState(checkpoint)).not.toThrow();
  });

  it('rejects a checkpoint whose input is not an object', () => {
    const flow: Flow = {
      name: 'bad-input-checkpoint-flow',
      description: 'checkpoint with malformed input',
      steps: [{ name: 'only', request: { method: 'only', params: { v: 1 } } }],
    };
    const first = new FlowExecutor(flow, jest.fn(async () => ({ ok: true })) as never, {
      logger: noLogger,
    });
    const checkpoint = first.exportState();
    (checkpoint as unknown as Record<string, unknown>).input = ['not', 'an', 'object'];

    expect(() => validateCheckpoint(checkpoint)).toThrow(ValidationError);
  });

  it('clears input on reset()', async () => {
    const { handler, seen } = makeHandler();
    const executor = new FlowExecutor(inputFlow, handler as never, { logger: noLogger });

    await executor.execute({ userId: 'u-1', profile: { city: 'A' } });
    expect(seen[0].params).toEqual({ user: 'u-1', city: 'A' });

    executor.reset();
    await expect(executor.execute()).rejects.toThrow();
  });

  it('is accepted by Flow Doctor as a known reference namespace', () => {
    const testDocument: OpenRpcDocument = {
      openrpc: '1.2.6',
      info: { title: 'Input API', version: '1.0.0' },
      methods: [
        { name: 'greet', params: [], result: { schema: {} } },
        { name: 'followUp', params: [], result: { schema: {} } },
      ],
    };
    const diagnostics = validateFlow(inputFlow, testDocument);
    const referenceDiagnostics = diagnostics.filter(
      (d) => d.code === 'UNKNOWN_STEP_REFERENCE' || d.message.includes('input'),
    );
    expect(referenceDiagnostics).toEqual([]);
  });

  it('resolves ${input} (the whole object) as a reference root', () => {
    const resolver = new ReferenceResolver(new Map(), {}, noLogger, {
      userId: 'u-3',
    });
    expect(resolver.resolvePath('input')).toEqual({ userId: 'u-3' });
    expect(resolver.resolvePath('input.userId')).toBe('u-3');
  });

  it('lists input among available references in unknown-reference errors', () => {
    const resolver = new ReferenceResolver(new Map(), {}, noLogger);
    try {
      resolver.resolvePath('nope.value');
      fail('expected resolvePath to throw');
    } catch (error) {
      expect((error as Error).message).toContain('input');
    }
  });
});
