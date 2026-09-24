import { FlowExecutor } from '../flow-executor';
import { CHECKPOINT_VERSION, CheckpointError, FlowCheckpoint, hashStep } from '../checkpoint';
import { ValidationError } from '../errors';
import { ErrorCode } from '../errors/codes';
import { PauseError } from '../errors/base';
import { TestLogger } from '../util/logger';
import type { Flow } from '../types';

function makeFlow(name = 'checkpoint-flow'): Flow {
  return {
    name,
    description: 'durable checkpoint test flow',
    steps: [
      { name: 'step1', request: { method: 'one', params: {} } },
      { name: 'step2', request: { method: 'two', params: { v: '${step1.result}' } } },
      { name: 'step3', request: { method: 'three', params: { v: '${step2.result}' } } },
    ],
  };
}

interface CallLog {
  methods: string[];
}

/**
 * Handler that fails `two` while `failuresLeft.two > 0`, records every call,
 * and returns a JSON-shaped result.
 */
function makeHandler(log: CallLog, failuresLeft: Record<string, number> = {}) {
  return jest.fn(async (request: { method: string; params?: unknown }) => {
    log.methods.push(request.method);
    if ((failuresLeft[request.method] ?? 0) > 0) {
      failuresLeft[request.method] -= 1;
      throw new Error(`boom-${request.method}`);
    }
    return { result: `ok-${request.method}` };
  });
}

function newExecutor(flow: Flow, handler: jest.Mock) {
  return new FlowExecutor(flow, handler, { logger: new TestLogger('checkpoint') });
}

describe('FlowExecutor durable checkpoints (issue #158)', () => {
  it('exports a well-formed, JSON-normalized checkpoint from a fresh executor', () => {
    const flow = makeFlow();
    const executor = newExecutor(flow, makeHandler({ methods: [] }));
    const snapshot = executor.exportState();

    expect(snapshot.version).toBe(CHECKPOINT_VERSION);
    expect(snapshot.flowName).toBe('checkpoint-flow');
    expect(snapshot.stepHashes).toEqual({
      step1: hashStep(flow.steps[0]),
      step2: hashStep(flow.steps[1]),
      step3: hashStep(flow.steps[2]),
    });
    expect(new Date(snapshot.exportedAt).toISOString()).toBe(snapshot.exportedAt);
    expect(snapshot.context).toEqual({});
    expect(snapshot.stepResults).toEqual({});
    expect(snapshot.stepStatus).toEqual({});
    expect(snapshot.lastFailedStepName).toBeNull();
    // JSON-normalized: persist/restore round trip loses nothing.
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('resumes after import without re-running succeeded side-effecting steps', async () => {
    const flow = makeFlow();
    const log: CallLog = { methods: [] };
    const handler = makeHandler(log, { two: 1 });

    const executor = newExecutor(flow, handler);
    await expect(executor.execute()).rejects.toThrow('boom-two');
    expect(log.methods).toEqual(['one', 'two']);

    const snapshot = executor.exportState();
    expect(snapshot.lastFailedStepName).toBe('step2');
    expect(snapshot.stepStatus.step1.status).toBe('success');
    expect(snapshot.stepStatus.step2.status).toBe('failed');
    // Errors are plain data, never Error instances.
    expect(snapshot.stepStatus.step2.error?.message).toContain('boom-two');
    expect(typeof snapshot.stepStatus.step2.error?.stack).toBe('string');

    // Persist as JSON — new process, new machine, hours later…
    const restored = JSON.parse(JSON.stringify(snapshot)) as FlowCheckpoint;

    const executor2 = newExecutor(flow, handler);
    executor2.importState(restored);
    const results = await executor2.execute();

    // step1 (side-effecting) ran exactly once; step2 was retried; step3 ran.
    expect(log.methods).toEqual(['one', 'two', 'two', 'three']);
    expect((results.get('step2') as { result: unknown }).result).toEqual({ result: 'ok-two' });
    expect((results.get('step3') as { result: unknown }).result).toEqual({ result: 'ok-three' });
    expect(executor2.exportState().lastFailedStepName).toBeNull();
  });

  it('skips everything when the checkpoint holds a fully successful run', async () => {
    const flow = makeFlow();
    const log: CallLog = { methods: [] };
    const handler = makeHandler(log);

    const executor = newExecutor(flow, handler);
    await executor.execute();
    expect(log.methods).toEqual(['one', 'two', 'three']);

    const executor2 = newExecutor(flow, handler);
    executor2.importState(JSON.parse(JSON.stringify(executor.exportState())));
    const results = await executor2.execute();

    expect(log.methods).toEqual(['one', 'two', 'three']);
    expect(results.get('step1')).toBeDefined();
  });

  it('restores lastFailedStepName when the resumed run fails again', async () => {
    const flow = makeFlow();
    const log: CallLog = { methods: [] };
    const handler = makeHandler(log, { two: 99 });

    const executor = newExecutor(flow, handler);
    await expect(executor.execute()).rejects.toThrow('boom-two');

    const executor2 = newExecutor(flow, handler);
    executor2.importState(executor.exportState());
    await expect(executor2.execute()).rejects.toThrow('boom-two');

    expect(log.methods).toEqual(['one', 'two', 'two']);
    expect(executor2.exportState().lastFailedStepName).toBe('step2');
  });

  it('goes back to fresh-run semantics after the imported resume is consumed', async () => {
    const flow = makeFlow();
    const log: CallLog = { methods: [] };
    const handler = makeHandler(log, { two: 1 });

    const executor = newExecutor(flow, handler);
    await expect(executor.execute()).rejects.toThrow('boom-two');

    const executor2 = newExecutor(flow, handler);
    executor2.importState(executor.exportState());
    await executor2.execute(); // resume: one, two, two, three
    await executor2.execute(); // fresh again: one, two, three
    expect(log.methods).toEqual(['one', 'two', 'two', 'three', 'one', 'two', 'three']);
  });

  it('accepts a JSON string directly', async () => {
    const flow = makeFlow();
    const log: CallLog = { methods: [] };
    const handler = makeHandler(log, { two: 1 });

    const executor = newExecutor(flow, handler);
    await expect(executor.execute()).rejects.toThrow('boom-two');

    const executor2 = newExecutor(flow, handler);
    executor2.importState(JSON.stringify(executor.exportState()));
    await executor2.execute();
    expect(log.methods).toEqual(['one', 'two', 'two', 'three']);
  });

  it('deep-isolates the snapshot from the executor in both directions', () => {
    const flow: Flow = {
      name: 'isolation-flow',
      description: 'isolation',
      steps: [{ name: 'step1', request: { method: 'one', params: {} } }],
    };
    const executor = newExecutor(flow, makeHandler({ methods: [] }));
    executor.setStepResults({ step1: { result: { items: [1, 2, 3] } } });

    const snapshot = executor.exportState();
    // Mutating the snapshot must not affect the executor…
    (snapshot.stepResults.step1 as { result: { items: number[] } }).result.items.push(999);
    (snapshot.context as Record<string, unknown>).polluted = true;
    expect(executor.exportState().stepResults).not.toEqual(snapshot.stepResults);

    // …and mutating the import source after import must not affect the executor.
    const executor2 = newExecutor(flow, makeHandler({ methods: [] }));
    const source = executor.exportState();
    executor2.importState(source);
    (source.stepResults.step1 as { result: { items: number[] } }).result.items.push(1000);
    expect(executor2.exportState().stepResults).toEqual(executor.exportState().stepResults);
  });

  it('rejects checkpoints with an unsupported version', () => {
    const executor = newExecutor(makeFlow(), makeHandler({ methods: [] }));
    const snapshot = executor.exportState();
    (snapshot as unknown as Record<string, unknown>).version = 999;

    const err = catchError(() => executor.importState(snapshot));
    expect(err).toBeInstanceOf(CheckpointError);
    expect((err as CheckpointError).code).toBe(ErrorCode.CHECKPOINT_VERSION_MISMATCH);
  });

  it('imports a checkpoint into a flow with an added step: new steps run, completed steps stay skipped', async () => {
    const flow = makeFlow();
    const log: CallLog = { methods: [] };
    const executor = newExecutor(flow, makeHandler(log, { two: 1 }));
    await expect(executor.execute()).rejects.toThrow('boom-two');
    expect(log.methods).toEqual(['one', 'two']);

    const snapshot = JSON.parse(JSON.stringify(executor.exportState())) as FlowCheckpoint;

    // Add a step after the failure point and fix nothing else.
    const edited = makeFlow();
    edited.steps.push({ name: 'step4', request: { method: 'four', params: {} } });
    const log2: CallLog = { methods: [] };
    const executor2 = newExecutor(edited, makeHandler(log2));
    executor2.importState(snapshot);
    await executor2.execute();

    // step1 skipped (recorded success), step2 re-run (recorded failure),
    // step3 and the new step4 run fresh (step4 has no dependencies, so its
    // completion order relative to step3 is not deterministic).
    expect(log2.methods[0]).toBe('two');
    expect(new Set(log2.methods)).toEqual(new Set(['two', 'three', 'four']));
  });

  it('re-runs changed steps across a diamond graph without double-processing', async () => {
    // a -> b, a -> c, b -> d, c -> d: d is reachable twice through the graph.
    const flow: Flow = {
      name: 'diamond-flow',
      description: 'diamond invalidation test flow',
      steps: [
        { name: 'a', request: { method: 'ma', params: {} } },
        { name: 'b', request: { method: 'mb', params: { v: '${a.result}' } } },
        { name: 'c', request: { method: 'mc', params: { v: '${a.result}' } } },
        { name: 'd', request: { method: 'md', params: { v: '${b.result}-${c.result}' } } },
      ],
    };
    const log: CallLog = { methods: [] };
    const executor = newExecutor(flow, makeHandler(log, { md: 1 }));
    await expect(executor.execute()).rejects.toThrow('boom-md');

    const snapshot = JSON.parse(JSON.stringify(executor.exportState())) as FlowCheckpoint;

    // "Fix" both a and b: d is a dependent of each, so it is invalidated twice.
    const fixed: Flow = {
      name: 'diamond-flow',
      description: 'diamond invalidation test flow',
      steps: [
        { name: 'a', request: { method: 'ma', params: { fixed: true } } },
        { name: 'b', request: { method: 'mb', params: { v: '${a.result}', fixed: true } } },
        flow.steps[2],
        flow.steps[3],
      ],
    };
    const log2: CallLog = { methods: [] };
    const executor2 = newExecutor(fixed, makeHandler(log2));
    executor2.importState(snapshot);
    await executor2.execute();

    // a and b changed -> re-run; c depended on a -> re-run;
    // d depended on b and c -> re-run exactly once.
    expect(new Set(log2.methods)).toEqual(new Set(['ma', 'mb', 'mc', 'md']));
    expect(log2.methods).toHaveLength(4);
  });

  it('logs which steps are skipped and which failed step is re-run on resume', async () => {
    const flow = makeFlow();
    const log: CallLog = { methods: [] };
    const executor = newExecutor(flow, makeHandler(log, { two: 1 }));
    await expect(executor.execute()).rejects.toThrow('boom-two');
    const snapshot = JSON.parse(JSON.stringify(executor.exportState())) as FlowCheckpoint;

    const logger = new TestLogger('resume-log');
    const executor2 = new FlowExecutor(flow, makeHandler({ methods: [] }), { logger });
    executor2.importState(snapshot);
    await executor2.execute();

    const resumeLines = logger
      .getLogs()
      .filter(
        (entry) => entry.level === 'info' && entry.message.includes('Resuming from checkpoint'),
      );
    expect(resumeLines).toHaveLength(1);
    expect(resumeLines[0].message).toBe(
      "Resuming from checkpoint: skipping completed step(s): step1; re-running failed step 'step2'.",
    );
  });

  it('logs a resume with no failed step and a resume with nothing completed', async () => {
    // Fully successful run: skip recorded successes, no failed step.
    const flow = makeFlow();
    const okSnapshot = JSON.parse(
      JSON.stringify(newExecutor(flow, makeHandler({ methods: [] })).exportState()),
    ) as FlowCheckpoint;
    // Simulate a completed run's recorded progress.
    okSnapshot.stepResults = {
      step1: { result: 'ok-one' },
      step2: { result: 'ok-two' },
      step3: { result: 'ok-three' },
    };
    okSnapshot.stepStatus = {
      step1: { status: 'success' },
      step2: { status: 'success' },
      step3: { status: 'success' },
    };
    const logger = new TestLogger('resume-log-ok');
    const executor = new FlowExecutor(flow, makeHandler({ methods: [] }), { logger });
    executor.importState(okSnapshot);
    await executor.execute();
    const okLines = logger
      .getLogs()
      .filter((entry) => entry.message.includes('Resuming from checkpoint'));
    expect(okLines).toHaveLength(1);
    expect(okLines[0].message).toBe(
      'Resuming from checkpoint: skipping completed step(s): step1, step2, step3; no failed step recorded.',
    );

    // Failed at the first step: nothing to skip.
    const log2: CallLog = { methods: [] };
    const failing = newExecutor(flow, makeHandler(log2, { one: 1 }));
    await expect(failing.execute()).rejects.toThrow('boom-one');
    const failSnapshot = JSON.parse(JSON.stringify(failing.exportState())) as FlowCheckpoint;
    const logger2 = new TestLogger('resume-log-fail');
    const executor2 = new FlowExecutor(flow, makeHandler({ methods: [] }), { logger: logger2 });
    executor2.importState(failSnapshot);
    await executor2.execute();
    const failLines = logger2
      .getLogs()
      .filter((entry) => entry.message.includes('Resuming from checkpoint'));
    expect(failLines).toHaveLength(1);
    expect(failLines[0].message).toBe(
      "Resuming from checkpoint: skipping completed step(s): (none); re-running failed step 'step1'.",
    );
  });

  it('re-runs a fixed step and its dependents, keeps unrelated completed steps skipped', async () => {
    const flow = makeFlow();
    const log: CallLog = { methods: [] };
    const executor = newExecutor(flow, makeHandler(log, { two: 1 }));
    await expect(executor.execute()).rejects.toThrow('boom-two');

    const snapshot = JSON.parse(JSON.stringify(executor.exportState())) as FlowCheckpoint;

    // "Fix" step2 by changing its definition (e.g. corrected params).
    const fixed = makeFlow();
    fixed.steps[1] = {
      name: 'step2',
      request: { method: 'two', params: { v: '${step1.result}', fixed: true } },
    };
    const log2: CallLog = { methods: [] };
    const executor2 = newExecutor(fixed, makeHandler(log2));
    executor2.importState(snapshot);
    await executor2.execute();

    // step1 unchanged and completed -> skipped; step2 changed -> re-run;
    // step3 depends on step2 -> re-run too.
    expect(log2.methods).toEqual(['two', 'three']);
  });

  it('drops recorded progress for a removed step with a warning and imports the rest', async () => {
    const flow: Flow = {
      name: 'trim-flow',
      description: 'removal reconciliation test flow',
      steps: [
        { name: 'gone', request: { method: 'gone', params: {} } },
        { name: 'stays', request: { method: 'stays', params: {} } },
      ],
    };
    const log: CallLog = { methods: [] };
    const executor = newExecutor(flow, makeHandler(log));
    await executor.execute();
    expect(log.methods).toEqual(['gone', 'stays']);

    const snapshot = JSON.parse(JSON.stringify(executor.exportState())) as FlowCheckpoint;

    const trimmed: Flow = {
      name: 'trim-flow',
      description: 'removal reconciliation test flow',
      steps: [{ name: 'stays', request: { method: 'stays', params: {} } }],
    };
    const log2: CallLog = { methods: [] };
    const executor2 = newExecutor(trimmed, makeHandler(log2));
    executor2.importState(snapshot);
    await executor2.execute();

    // 'gone' was removed: its recorded success is dropped (warned, not thrown).
    // 'stays' keeps its recorded success and stays skipped.
    expect(log2.methods).toEqual([]);
  });

  it('keeps recorded progress when an unrun step is edited', async () => {
    const flow = makeFlow();
    const log: CallLog = { methods: [] };
    const executor = newExecutor(flow, makeHandler(log, { two: 1 }));
    await expect(executor.execute()).rejects.toThrow('boom-two');

    const snapshot = JSON.parse(JSON.stringify(executor.exportState())) as FlowCheckpoint;

    // step3 never ran; editing it must not disturb step1's recorded success.
    const edited = makeFlow();
    edited.steps[2] = {
      name: 'step3',
      request: { method: 'three', params: { v: '${step2.result}', extra: 1 } },
    };
    const log2: CallLog = { methods: [] };
    const executor2 = newExecutor(edited, makeHandler(log2));
    executor2.importState(snapshot);
    await executor2.execute();

    expect(log2.methods).toEqual(['two', 'three']);
  });

  it('imports a renamed flow whose step definitions are identical', async () => {
    const flow = makeFlow('original-name');
    const log: CallLog = { methods: [] };
    const handler = makeHandler(log, { two: 1 });

    const executor = newExecutor(flow, handler);
    await expect(executor.execute()).rejects.toThrow('boom-two');

    const renamed = makeFlow('renamed-flow');
    const executor2 = newExecutor(renamed, handler);
    expect(() => executor2.importState(executor.exportState())).not.toThrow();
    await executor2.execute();
    expect(log.methods).toEqual(['one', 'two', 'two', 'three']);
  });

  it('rejects malformed checkpoint input', () => {
    const executor = newExecutor(makeFlow(), makeHandler({ methods: [] }));
    for (const bad of [null, undefined, 42, [], 'not json', '{"a":1}', { version: 1 }]) {
      expect(() => executor.importState(bad)).toThrow(ValidationError);
    }
  });

  it('rejects state that cannot survive JSON persistence', () => {
    const flow: Flow = {
      name: 'unserializable-flow',
      description: 'unserializable',
      steps: [{ name: 'step1', request: { method: 'one', params: {} } }],
    };
    const executor = newExecutor(flow, makeHandler({ methods: [] }));
    executor.setStepResults({ step1: { callback: () => {} } });

    const err = catchError(() => executor.exportState());
    expect(err).toBeInstanceOf(CheckpointError);
    expect((err as CheckpointError).code).toBe(ErrorCode.CHECKPOINT_NOT_SERIALIZABLE);
    expect((err as Error).message).toContain('$.stepResults.step1.callback');

    // Same enforcement on the import side for hand-built checkpoints.
    const snapshot = newExecutor(flow, makeHandler({ methods: [] })).exportState();
    (snapshot.stepResults as Record<string, unknown>).evil = new Map();
    const importer = newExecutor(flow, makeHandler({ methods: [] }));
    expect(() => importer.importState(snapshot)).toThrow(CheckpointError);
  });

  it('rehydrates checkpoint errors that have no stack trace', async () => {
    const flow: Flow = {
      name: 'stackless-flow',
      description: 'stackless',
      steps: [{ name: 'step1', request: { method: 'one', params: {} } }],
    };
    const handler = jest.fn(async () => {
      throw new Error('no-stack-boom');
    });
    const executor = newExecutor(flow, handler);
    await expect(executor.execute()).rejects.toThrow('no-stack-boom');

    // Simulate a checkpoint whose recorded error carries no stack.
    const snapshot = executor.exportState();
    delete snapshot.stepStatus.step1.error?.stack;

    const executor2 = newExecutor(flow, makeHandler({ methods: [] }));
    expect(() => executor2.importState(snapshot)).not.toThrow();
  });

  it('treats results without a status entry as successes', async () => {
    const flow = makeFlow();
    const log: CallLog = { methods: [] };
    const handler = makeHandler(log, { two: 1 });

    const executor = newExecutor(flow, handler);
    await expect(executor.execute()).rejects.toThrow('boom-two');

    const snapshot = executor.exportState();
    delete snapshot.stepStatus.step1;

    const executor2 = newExecutor(flow, handler);
    executor2.importState(snapshot);
    await executor2.execute();
    expect(log.methods).toEqual(['one', 'two', 'two', 'three']);
  });

  it('self-heals an inconsistent lastFailedStepName on import', async () => {
    const flow = makeFlow();
    const log: CallLog = { methods: [] };
    const handler = makeHandler(log, { two: 1 });

    const executor = newExecutor(flow, handler);
    await expect(executor.execute()).rejects.toThrow('boom-two');

    // Hand-built inconsistency: names a succeeded step as the failed one.
    const snapshot = executor.exportState();
    snapshot.lastFailedStepName = 'step1';

    const executor2 = newExecutor(flow, handler);
    executor2.importState(snapshot);
    expect(executor2.exportState().lastFailedStepName).toBeNull();
    // retry() falls back to the recorded 'failed' status and must not re-run
    // the succeeded step1.
    await executor2.retry();
    expect(log.methods).toEqual(['one', 'two', 'two', 'three']);
  });

  it('resumes a flow that was paused mid-run', async () => {
    const flow: Flow = {
      name: 'pause-checkpoint-flow',
      description: 'pause',
      steps: [
        { name: 'step1', request: { method: 'one', params: {} } },
        { name: 'step2', request: { method: 'two', params: {} } },
      ],
    };
    const log: CallLog = { methods: [] };
    let allowStep2 = false;
    let step2Started!: () => void;
    const step2StartedPromise = new Promise<void>((resolve) => {
      step2Started = resolve;
    });
    const handler = jest.fn((request: { method: string }, options?: { signal?: AbortSignal }) => {
      log.methods.push(request.method);
      if (request.method === 'one') {
        return Promise.resolve({ result: 'ok-one' });
      }
      step2Started();
      if (allowStep2) {
        return Promise.resolve({ result: 'ok-two' });
      }
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });

    const executor = newExecutor(flow, handler);
    const executePromise = executor.execute();
    await step2StartedPromise;
    executor.pause();
    await expect(executePromise).rejects.toBeInstanceOf(PauseError);

    // Export the paused progress, import elsewhere, keep going.
    const snapshot = JSON.parse(JSON.stringify(executor.exportState())) as FlowCheckpoint;
    const executor2 = newExecutor(flow, handler);
    executor2.importState(snapshot);
    allowStep2 = true;
    const results = await executor2.execute();

    expect(log.methods).toEqual(['one', 'two', 'two']);
    expect((results.get('step2') as { result: unknown }).result).toEqual({ result: 'ok-two' });
  });

  it('exposes the checkpoint API from the package root', async () => {
    const root = await import('../index');
    expect(root.CHECKPOINT_VERSION).toBe(2);
    expect(root.hashFlow).toBeDefined();
    expect(root.hashStep).toBe(hashStep);
    expect(root.validateCheckpoint).toBeDefined();
    expect(root.CheckpointError).toBe(CheckpointError);
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
