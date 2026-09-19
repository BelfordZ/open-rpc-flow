import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TokenizerError } from '../../expression-evaluator/tokenizer';
import { TimeoutError } from '../../errors/timeout-error';
import { ValidationError } from '../../errors/base';
import { ErrorCode } from '../../errors/codes';
import { ReferenceResolver } from '../../reference-resolver';
import { TestLogger } from '../../util/logger';
import type { PolicyResolver } from '../../util/policy-resolver';
import type { Step } from '../../types';

/**
 * Fuzzing tests for the expression evaluator (issue #164, carved out of #46).
 *
 * The evaluator is the main untrusted-input surface: expressions come from
 * flow definitions. These tests feed thousands of seeded, repeatable random
 * expressions into `SafeExpressionEvaluator.evaluate()` and assert the safety
 * invariants:
 *   1. never throws outside the known error families
 *      (ValidationError, ExpressionError + subclasses, TokenizerError,
 *      TimeoutError),
 *   2. never hangs (every evaluation is bounded by a tiny 50ms expression
 *      timeout so the suite stays fast),
 *   3. never escapes the sandbox (a successful result is never identical to a
 *      dangerous global, and the adversarial corpus below is blocked).
 *
 * Reproducing a failure: the seed is fixed by default. Re-run with a
 * different seed via the FUZZ_SEED env var, e.g.
 *   FUZZ_SEED=12345 npx jest evaluator-fuzzing
 * Any invariant violation fails with the seed and the offending expression,
 * so the exact input can be replayed.
 */
describe('expression evaluator fuzzing (issue #164)', () => {
  // Seed: override with FUZZ_SEED=<n> to explore a different input space.
  const SEED = process.env.FUZZ_SEED !== undefined ? Number(process.env.FUZZ_SEED) : 0x164;
  const ITERATIONS = 3000;
  const FUZZ_TIMEOUT_MS = 50;

  let evaluator: SafeExpressionEvaluator;
  const logger = new TestLogger('EvaluatorFuzzingTest');

  // Fixed context so valid references resolve; shared across iterations to
  // also shake out cross-evaluation state leaks.
  const FUZZ_CONTEXT: Record<string, any> = {
    user: { name: 'ada', age: 36, tags: ['admin', 'dev'], address: { city: 'Van' } },
    count: 3,
    price: 9.99,
    flag: true,
    nothing: null,
    item: 'loop-item',
    items: [1, 2, 3],
  };

  // Dummy step so the stubbed policy resolver path (50ms timeout) is used.
  const DUMMY_STEP = { name: 'fuzz', request: { method: 'm', params: {} } } as Step;

  beforeEach(() => {
    const stepResults = new Map<string, any>();
    const referenceResolver = new ReferenceResolver(stepResults, FUZZ_CONTEXT, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
    evaluator.setPolicyResolver({
      resolveExpressionTimeout: () => FUZZ_TIMEOUT_MS,
    } as unknown as PolicyResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  // ---------------------------------------------------------------------------
  // Seeded PRNG (mulberry32): deterministic across runs for a fixed seed.
  // ---------------------------------------------------------------------------
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  type Rng = () => number;
  const randInt = (rng: Rng, min: number, max: number): number =>
    min + Math.floor(rng() * (max - min + 1));
  const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];

  // ---------------------------------------------------------------------------
  // Expression generator: composable pieces, weighted toward valid-ish input
  // so AST evaluation paths get exercised, with heavy chaos/adversarial tails.
  // ---------------------------------------------------------------------------
  const BINARY_OPS = [
    '+',
    '-',
    '*',
    '/',
    '%',
    '==',
    '===',
    '!=',
    '!==',
    '>',
    '>=',
    '<',
    '<=',
    '&&',
    '||',
  ] as const;
  const UNARY_OPS = ['!', '-', '+'] as const;
  const ALLOWED_FNS = ['Number', 'String', 'Boolean', 'parseInt', 'parseFloat'] as const;

  const VALID_REF_PATHS = [
    'user.name',
    'user.age',
    'user.tags[0]',
    'user.tags[5]',
    'user.address.city',
    'count',
    'price',
    'flag',
    'nothing',
    'item',
    'items[1]',
    'items[9]',
  ] as const;
  const DANGLING_REF_PATHS = [
    'missing',
    'user.missing',
    'user.name.first',
    'user.tags[-1]',
    '',
    '.',
    'a..b',
  ] as const;

  function genStringLiteral(rng: Rng): string {
    const quote = pick(rng, ["'", '"', '`']);
    const fragments = [
      'hello',
      'with space',
      'escapes \\n \\t \\\\',
      'unicode é 中文 😀',
      'quote"inside',
      "apostrophe's",
      '\\u0041\\u{1F600}',
      '${not-a-reference}',
      '',
    ];
    let body = pick(rng, fragments);
    // Occasionally corrupt: unterminated, stray backslash, raw newline.
    const roll = rng();
    if (roll < 0.12) return quote + body; // unterminated
    if (roll < 0.18) body += '\\'; // trailing backslash
    return quote + body + quote;
  }

  function genNumberLiteral(rng: Rng): string {
    return pick(rng, [
      String(randInt(rng, -100000, 100000)),
      (rng() * 2000 - 1000).toFixed(pick(rng, [1, 2, 6])),
      '1e308',
      '-0',
      '0.1',
      '007',
      '0x1F',
      `${randInt(rng, 0, 9)}`.repeat(randInt(rng, 1, 25)),
    ]);
  }

  function genLiteral(rng: Rng): string {
    const roll = rng();
    if (roll < 0.45) return genNumberLiteral(rng);
    if (roll < 0.75) return genStringLiteral(rng);
    return pick(rng, ['true', 'false', 'null', 'undefined']);
  }

  function genReference(rng: Rng): string {
    const roll = rng();
    let path: string;
    if (roll < 0.55) {
      path = pick(rng, VALID_REF_PATHS);
    } else if (roll < 0.8) {
      path = pick(rng, DANGLING_REF_PATHS);
    } else if (roll < 0.9) {
      // Malformed reference syntax.
      path = pick(rng, ['a[', 'a[1', '"a"', "'a'", 'a b', 'a-b', '1a']);
    } else {
      // Nested reference.
      path = `${pick(rng, VALID_REF_PATHS)}.\${${pick(rng, ['count', 'missing'])}}`;
    }
    // Occasionally leave the reference unterminated.
    return rng() < 0.1 ? '${' + path : '${' + path + '}';
  }

  function genOperand(rng: Rng, depth: number): string {
    const roll = rng();
    if (roll < 0.35 || depth <= 0) return genLiteral(rng);
    if (roll < 0.55) return genReference(rng);
    if (roll < 0.65) return `(${genExpression(rng, depth - 1)})`;
    if (roll < 0.72) {
      const elements = Array.from({ length: randInt(rng, 0, 4) }, () => genOperand(rng, depth - 1));
      if (rng() < 0.15 && elements.length > 0) elements[0] = '...' + elements[0];
      return `[${elements.join(', ')}]`;
    }
    if (roll < 0.79) {
      const keys = ['a', 'b', 'key', '"kebab-key"', "'q'"];
      const props = Array.from({ length: randInt(rng, 0, 3) }, () => {
        const spread = rng() < 0.12 ? '...' : '';
        return `${spread}${pick(rng, keys)}: ${genOperand(rng, depth - 1)}`;
      });
      return `{${props.join(', ')}}`;
    }
    if (roll < 0.86) {
      // Template literal with embedded references.
      const parts = Array.from({ length: randInt(rng, 1, 4) }, () =>
        rng() < 0.5 ? 'text' : genReference(rng),
      );
      return '`' + parts.join(' ') + (rng() < 0.1 ? '' : '`');
    }
    // Function call: allowed fns plus hostile names.
    const name =
      rng() < 0.6 ? pick(rng, ALLOWED_FNS) : pick(rng, ['eval', 'Function', 'nope', 'parseInt']);
    const args = Array.from({ length: randInt(rng, 0, 3) }, () => genOperand(rng, depth - 1));
    return `${name}(${args.join(', ')})`;
  }

  function genExpression(rng: Rng, depth: number): string {
    const roll = rng();
    if (roll < 0.25 || depth <= 0) return genOperand(rng, depth);
    if (roll < 0.35) return `${pick(rng, UNARY_OPS)}${genOperand(rng, depth - 1)}`;
    const left = genOperand(rng, depth - 1);
    const op = pick(rng, BINARY_OPS);
    const right = genOperand(rng, depth - 1);
    // Occasionally drop whitespace or jam tokens together.
    const gap = rng() < 0.2 ? '' : ' ';
    return `${left}${gap}${op}${gap}${right}`;
  }

  function genDeepNesting(rng: Rng): string {
    // Shapes that actually recurse in the evaluator (plain parens are
    // handled iteratively by the shunting-yard parser, so they don't probe
    // the depth guard; nested arrays/objects/calls/templates/chains do).
    const n = randInt(rng, 120, 400);
    const kind = rng();
    if (kind < 0.3) {
      const half = Math.floor(n / 2);
      return '['.repeat(half) + '1' + ']'.repeat(half);
    }
    if (kind < 0.5) {
      const third = Math.floor(n / 3);
      return 'Number('.repeat(third) + '1' + ')'.repeat(third);
    }
    if (kind < 0.65) return '1 + '.repeat(n) + '1';
    if (kind < 0.8) {
      const third = Math.floor(n / 3);
      return '`' + '${'.repeat(third) + 'count' + '}'.repeat(third) + '`';
    }
    const half = Math.floor(n / 2);
    return '{a: '.repeat(half) + '1' + '}'.repeat(half);
  }

  const CHAOS_ALPHABET = '()[]{}$\'"`,.,:;!?@#%^&*-+=<>/|~_ abcXYZ019\n\t\\é中' + '${' + '`';

  function genChaos(rng: Rng): string {
    const len = randInt(rng, 1, 80);
    let out = '';
    for (let i = 0; i < len; i++) {
      out += CHAOS_ALPHABET[Math.floor(rng() * CHAOS_ALPHABET.length)];
    }
    return out;
  }

  const DANGEROUS_WORDS = [
    'eval',
    'Function',
    'constructor',
    '__proto__',
    'prototype',
    'process',
    'globalThis',
    'require',
    'module',
  ] as const;

  function genAdversarial(rng: Rng): string {
    const word = pick(rng, DANGEROUS_WORDS);
    const shape = rng();
    if (shape < 0.25) return word;
    if (shape < 0.45) return '${' + word + '}';
    if (shape < 0.6) return '${' + word + pick(rng, ['.env', '.x', '[0]', "['a']"]) + '}';
    if (shape < 0.75) return `${word}(${genLiteral(rng)})`;
    if (shape < 0.9) return `'${word}'`;
    // Obfuscated: split the word across a string concat.
    const cut = randInt(rng, 1, word.length - 1);
    return `'${word.slice(0, cut)}' + '${word.slice(cut)}'`;
  }

  function generateExpression(rng: Rng): string {
    const roll = rng();
    if (roll < 0.5) return genExpression(rng, 3);
    if (roll < 0.62) return genReference(rng);
    if (roll < 0.7) return genDeepNesting(rng);
    if (roll < 0.85) return genChaos(rng);
    if (roll < 0.93) return genStringLiteral(rng);
    return genAdversarial(rng);
  }

  // ---------------------------------------------------------------------------
  // Invariant checkers.
  // ---------------------------------------------------------------------------
  function isKnownErrorFamily(error: unknown): boolean {
    return (
      error instanceof ValidationError ||
      error instanceof ExpressionError ||
      error instanceof TokenizerError ||
      error instanceof TimeoutError
    );
  }

  const DANGEROUS_VALUES: ReadonlySet<unknown> = new Set<unknown>([
    globalThis,
    (globalThis as Record<string, unknown>).process,
    (globalThis as Record<string, unknown>).eval,
    (globalThis as Record<string, unknown>).Function,
    (globalThis as Record<string, unknown>).Object,
    (globalThis as Record<string, unknown>).Reflect,
  ]);

  /** True if the evaluated result is (or contains) a dangerous global. */
  function isSandboxEscape(value: unknown): boolean {
    const seen = new Set<unknown>();
    const stack: unknown[] = [value];
    let guard = 0;
    try {
      while (stack.length > 0 && guard++ < 1000) {
        const current = stack.pop();
        if (current === null || (typeof current !== 'object' && typeof current !== 'function')) {
          continue;
        }
        if (DANGEROUS_VALUES.has(current)) return true;
        if (seen.has(current)) continue;
        seen.add(current);
        if (Array.isArray(current)) {
          stack.push(...current);
        } else {
          stack.push(...Object.values(current));
        }
      }
    } catch {
      // Introspection of the result failed; not an escape by itself.
      return false;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // The fuzz run.
  // ---------------------------------------------------------------------------
  it('random expressions never violate the safety invariants', () => {
    const rng = mulberry32(SEED);
    const violations: string[] = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const expr = generateExpression(rng);
      try {
        const result = evaluator.evaluate(expr, FUZZ_CONTEXT, DUMMY_STEP);
        if (isSandboxEscape(result)) {
          violations.push(`SANDBOX ESCAPE seed=${SEED} iter=${i} expr=${JSON.stringify(expr)}`);
        }
      } catch (error) {
        if (!isKnownErrorFamily(error)) {
          const name = error instanceof Error ? error.constructor.name : typeof error;
          const message = error instanceof Error ? error.message : String(error);
          violations.push(
            `UNEXPECTED THROW seed=${SEED} iter=${i} expr=${JSON.stringify(expr)} -> ${name}: ${message}`,
          );
        }
      }
      if (violations.length >= 5) break;
    }
    expect(violations).toEqual([]);
  }, 120000);

  it('deep nesting is rejected with EXPRESSION_TOO_DEEP, not a stack overflow', () => {
    // Nested array literals recurse in evaluateAst, tripping the depth guard.
    const half = SafeExpressionEvaluator.MAX_RECURSION_DEPTH + 50;
    const deep = '['.repeat(half) + '1' + ']'.repeat(half);
    let caught: unknown;
    try {
      evaluator.evaluate(deep, FUZZ_CONTEXT, DUMMY_STEP);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).code).toBe(ErrorCode.EXPRESSION_TOO_DEEP);
  });

  it('adversarial sandbox-escape attempts are blocked', () => {
    const attempts = [
      `eval('2 + 2')`,
      `Function('return 1')()`,
      'constructor',
      '__proto__',
      'prototype',
      'process',
      'globalThis',
      '${process}',
      '${globalThis}',
      '${process.env}',
      '${globalThis.eval}',
      '${constructor}',
      "${''.__proto__}",
      '`${eval}`',
      "'eval'",
    ];
    for (const expr of attempts) {
      let result: unknown;
      let threw: unknown = null;
      try {
        result = evaluator.evaluate(expr, FUZZ_CONTEXT, DUMMY_STEP);
      } catch (error) {
        threw = error;
      }
      if (threw !== null) {
        expect(isKnownErrorFamily(threw)).toBe(true);
      } else {
        // Did not throw: the result must not be a dangerous object.
        expect(isSandboxEscape(result)).toBe(false);
      }
    }
  });
});
