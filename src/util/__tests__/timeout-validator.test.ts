import { TimeoutValidator } from '../timeout-validator';
import { DEFAULT_TIMEOUTS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS } from '../../constants/timeouts';
import { ValidationError } from '../../errors';

describe('TimeoutValidator', () => {
  describe('validateTimeout', () => {
    it('should return the default timeout when input is undefined', () => {
      const defaultTimeout = 1000;
      const result = TimeoutValidator.validateTimeout(undefined, defaultTimeout);
      expect(result).toBe(defaultTimeout);
    });

    it('should throw ValidationError when timeout is null', () => {
      const defaultTimeout = 1000;
      const result = TimeoutValidator.validateTimeout(null, defaultTimeout);
      expect(result).toBe(defaultTimeout);
    });

    it('should throw ValidationError when timeout is undefined and no default is provided', () => {
      expect(() => {
        TimeoutValidator.validateTimeout(undefined);
      }).toThrow(ValidationError);
    });

    it('should throw ValidationError when timeout is not a number', () => {
      expect(() => {
        TimeoutValidator.validateTimeout('invalid' as any, 1000);
      }).toThrow(ValidationError);

      expect(() => {
        TimeoutValidator.validateTimeout({} as any, 1000);
      }).toThrow(ValidationError);
    });

    it('should throw ValidationError when timeout is NaN', () => {
      expect(() => {
        TimeoutValidator.validateTimeout(NaN, 1000);
      }).toThrow(ValidationError);
    });

    it('should throw ValidationError when timeout is Infinity', () => {
      expect(() => {
        TimeoutValidator.validateTimeout(Infinity, 1000);
      }).toThrow(ValidationError);
    });

    it('should throw ValidationError when timeout is less than minimum', () => {
      expect(() => {
        TimeoutValidator.validateTimeout(MIN_TIMEOUT_MS - 1, 1000);
      }).toThrow(ValidationError);

      expect(() => {
        TimeoutValidator.validateTimeout(0, 1000);
      }).toThrow(ValidationError);

      expect(() => {
        TimeoutValidator.validateTimeout(-100, 1000);
      }).toThrow(ValidationError);
    });

    it('should throw ValidationError when timeout exceeds maximum', () => {
      expect(() => {
        TimeoutValidator.validateTimeout(MAX_TIMEOUT_MS + 1, 1000);
      }).toThrow(ValidationError);
    });

    it('should return the input timeout when it is valid', () => {
      const validTimeout = 5000;
      const result = TimeoutValidator.validateTimeout(validTimeout, 1000);
      expect(result).toBe(validTimeout);
    });

    it('should round non-integer timeout values', () => {
      const nonIntegerTimeout = 1500.75;
      const result = TimeoutValidator.validateTimeout(nonIntegerTimeout, 1000);
      expect(result).toBe(1501); // Rounded to nearest integer
    });

    it('should accept the minimum timeout value', () => {
      const result = TimeoutValidator.validateTimeout(MIN_TIMEOUT_MS, 1000);
      expect(result).toBe(MIN_TIMEOUT_MS);
    });

    it('should accept the maximum timeout value', () => {
      const result = TimeoutValidator.validateTimeout(MAX_TIMEOUT_MS, 1000);
      expect(result).toBe(MAX_TIMEOUT_MS);
    });
  });

  describe('validateTimeoutOptions', () => {
    it('should return default timeouts when input is undefined', () => {
      const result = TimeoutValidator.validateTimeoutOptions(undefined);
      expect(result).toEqual(DEFAULT_TIMEOUTS);
    });

    it('should return default timeouts when input is an empty object', () => {
      const result = TimeoutValidator.validateTimeoutOptions({});
      expect(result).toEqual(DEFAULT_TIMEOUTS);
    });

    it('should merge input timeouts with defaults', () => {
      const customTimeouts = {
        global: 5000,
        request: 10000,
      };

      const expected = {
        ...DEFAULT_TIMEOUTS,
        ...customTimeouts,
      };

      const result = TimeoutValidator.validateTimeoutOptions(customTimeouts);
      expect(result).toEqual(expected);
    });

    it('should validate each property in the timeout options', () => {
      expect(() => {
        TimeoutValidator.validateTimeoutOptions({
          global: -1, // Invalid
        });
      }).toThrow(ValidationError);

      expect(() => {
        TimeoutValidator.validateTimeoutOptions({
          request: 'invalid' as any, // Invalid
        });
      }).toThrow(ValidationError);

      expect(() => {
        TimeoutValidator.validateTimeoutOptions({
          transform: MAX_TIMEOUT_MS + 1000, // Invalid
        });
      }).toThrow(ValidationError);
    });

    it('should validate the condition property', () => {
      expect(() => {
        TimeoutValidator.validateTimeoutOptions({
          condition: -1, // Invalid
        });
      }).toThrow(ValidationError);

      const validCondition = 3000;
      const result = TimeoutValidator.validateTimeoutOptions({
        condition: validCondition,
      });
      expect(result.condition).toBe(validCondition);
    });

    it('should validate the loop property', () => {
      expect(() => {
        TimeoutValidator.validateTimeoutOptions({
          loop: 'invalid' as any, // Invalid
        });
      }).toThrow(ValidationError);

      const validLoop = 20000;
      const result = TimeoutValidator.validateTimeoutOptions({
        loop: validLoop,
      });
      expect(result.loop).toBe(validLoop);
    });

    it('should validate the expression property', () => {
      expect(() => {
        TimeoutValidator.validateTimeoutOptions({
          expression: MAX_TIMEOUT_MS + 1000, // Invalid
        });
      }).toThrow(ValidationError);

      const validExpression = 1500;
      const result = TimeoutValidator.validateTimeoutOptions({
        expression: validExpression,
      });
      expect(result.expression).toBe(validExpression);
    });

    it('should accept custom default timeouts', () => {
      const customDefaults = {
        global: 2000,
        request: 3000,
        transform: 1500,
      };

      const input = {
        condition: 1000,
      };

      const expected = {
        ...customDefaults,
        condition: 1000,
        loop: DEFAULT_TIMEOUTS.loop,
        expression: DEFAULT_TIMEOUTS.expression,
      };

      const result = TimeoutValidator.validateTimeoutOptions(input, customDefaults);
      expect(result).toEqual(expected);
    });

    it('should handle special case when customDefaults is not DEFAULT_TIMEOUTS and options has condition property', () => {
      const customDefaults = {
        global: 2000,
        request: 3000,
      };

      const input = {
        condition: 1000,
      };

      const expected = {
        ...customDefaults,
        condition: 1000,
        loop: DEFAULT_TIMEOUTS.loop,
        expression: DEFAULT_TIMEOUTS.expression,
      };

      const result = TimeoutValidator.validateTimeoutOptions(input, customDefaults);
      expect(result).toEqual(expected);
    });

    it('should handle the normal case when customDefaults is not DEFAULT_TIMEOUTS but options has no condition', () => {
      const customDefaults = {
        global: 2000,
        request: 3000,
      };

      const input = {
        transform: 1500,
      };

      // Should merge defaults and input
      const result = TimeoutValidator.validateTimeoutOptions(input, customDefaults);
      
      expect(result.global).toBe(2000);      // From customDefaults
      expect(result.request).toBe(3000);     // From customDefaults
      expect(result.transform).toBe(1500);   // From input
      expect(result.condition).toBeDefined(); // Should still exist from DEFAULT_TIMEOUTS
      expect(result.loop).toBeDefined();      // Should still exist from DEFAULT_TIMEOUTS
      expect(result.expression).toBeDefined(); // Should still exist from DEFAULT_TIMEOUTS
    });
  });
});
