import { tokenize } from '../../expression-evaluator/tokenizer';
import { TimeoutError } from '../../errors/timeout-error';
import { SafeExpressionEvaluator } from '../../expression-evaluator/safe-evaluator';
import { ReferenceResolver } from '../../reference-resolver';
import { StepType } from '../../step-executors/types';
import { TestLogger } from '../../util/logger';
import type { Step } from '../../types';

/**
 * Regression tests for issue #163: the expression timeout was checked once
 * before tokenization but never inside the tokenizer, so a pathological
 * tokenization pass could run past the deadline.
 */
describe('tokenizer timeout enforcement (issue #163)', () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = new TestLogger('TokenizerTimeoutTest');
  });

  afterEach(() => {
    logger.clear();
  });

  describe('tokenize() with TokenizeOptions', () => {
    it('throws TimeoutError when the deadline has already passed', () => {
      expect(() =>
        tokenize('1 + 1', logger, { startTime: Date.now() - 10_000, timeoutMs: 1 }),
      ).toThrow(TimeoutError);
    });

    it('reports the configured timeout and marks it as an expression timeout', () => {
      let caught: unknown;
      try {
        tokenize('1 + 1', logger, { startTime: Date.now() - 10_000, timeoutMs: 250 });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TimeoutError);
      const timeoutError = caught as TimeoutError;
      expect(timeoutError.timeout).toBe(250);
      expect(timeoutError.isExpressionTimeout).toBe(true);
      expect(timeoutError.message).toContain('Expression evaluation timed out');
    });

    it('passes step context through to the TimeoutError', () => {
      const step: Step = { name: 'timeout-step' };
      let caught: unknown;
      try {
        tokenize('1 + 1', logger, {
          startTime: Date.now() - 10_000,
          timeoutMs: 250,
          step,
          stepType: StepType.Request,
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TimeoutError);
      expect((caught as TimeoutError).step).toBe(step);
      expect((caught as TimeoutError).stepType).toBe(StepType.Request);
    });

    it('succeeds when the deadline has not passed', () => {
      const tokens = tokenize('1 + 1', logger, { startTime: Date.now(), timeoutMs: 60_000 });
      expect(tokens).toEqual([
        { type: 'number', value: 1, raw: '1' },
        { type: 'operator', value: '+', raw: '+' },
        { type: 'number', value: 1, raw: '1' },
      ]);
    });

    it('ignores a partial timeout configuration without a timeout value', () => {
      // startTime alone is not enough to enforce a timeout.
      const tokens = tokenize('1 + 1', logger, { startTime: Date.now() - 10_000 });
      expect(tokens).toHaveLength(3);
    });

    it('aborts a long tokenization mid-stream once the deadline passes', () => {
      const originalDateNow = Date.now;
      const start = 1_000_000;
      let calls = 0;
      // The first clock sample looks healthy; the second jumps past the
      // deadline, simulating a tokenization that outruns its budget
      // partway through (the check fires at index 1024).
      Date.now = jest.fn(() => {
        calls++;
        return calls <= 1 ? start : start + 5_000;
      });
      try {
        expect(() =>
          tokenize('a'.repeat(3000), logger, { startTime: start, timeoutMs: 100 }),
        ).toThrow(TimeoutError);
      } finally {
        Date.now = originalDateNow;
      }
    });

    it('aborts inside nested reference scanning, not just the top-level loop', () => {
      const originalDateNow = Date.now;
      const start = 1_000_000;
      let calls = 0;
      // All the work happens inside handleReference's loop here; the check
      // at index 2048 must fire there rather than only in the main loop.
      Date.now = jest.fn(() => {
        calls++;
        return calls <= 1 ? start : start + 5_000;
      });
      try {
        expect(() =>
          tokenize('${' + 'a'.repeat(3000), logger, { startTime: start, timeoutMs: 100 }),
        ).toThrow(TimeoutError);
      } finally {
        Date.now = originalDateNow;
      }
    });
  });

  describe('SafeExpressionEvaluator.evaluate()', () => {
    const buildEvaluator = (): SafeExpressionEvaluator => {
      const referenceResolver = new ReferenceResolver(new Map<string, any>(), {}, logger);
      return new SafeExpressionEvaluator(logger, referenceResolver);
    };

    it('surfaces TimeoutError from tokenization instead of hanging', () => {
      const evaluator = buildEvaluator();
      const step: Step = { name: 'timeout-step' };

      const originalDateNow = Date.now;
      let calls = 0;
      // First call is evaluate()'s startTime; everything after is past the
      // 1000ms default expression timeout.
      Date.now = jest.fn(() => {
        calls++;
        return calls === 1 ? 1000 : 2001;
      });
      try {
        expect(() => evaluator.evaluate('1 + 1', {}, step)).toThrow(TimeoutError);
      } finally {
        Date.now = originalDateNow;
      }
    });

    it('does not swallow the tokenization TimeoutError in validateExpression', () => {
      const evaluator = buildEvaluator();
      const step: Step = { name: 'timeout-step' };

      const originalDateNow = Date.now;
      let calls = 0;
      Date.now = jest.fn(() => {
        calls++;
        return calls === 1 ? 1000 : 2001;
      });
      let caught: unknown;
      try {
        evaluator.evaluate('1 + 1', {}, step);
      } catch (error) {
        caught = error;
      } finally {
        Date.now = originalDateNow;
      }
      // validateExpression() tokenizes first: the TimeoutError must propagate
      // out of it (it is not a TokenizerError) with the step attached.
      expect(caught).toBeInstanceOf(TimeoutError);
      expect((caught as TimeoutError).step).toBe(step);
      expect((caught as TimeoutError).isExpressionTimeout).toBe(true);
    });

    it('still evaluates normally when the timeout is not exceeded', () => {
      const evaluator = buildEvaluator();
      expect(evaluator.evaluate('1 + 1', {})).toBe(2);
    });
  });
});
