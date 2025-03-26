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
        request: 10000
      };
      
      const expected = {
        ...DEFAULT_TIMEOUTS,
        ...customTimeouts
      };
      
      const result = TimeoutValidator.validateTimeoutOptions(customTimeouts);
      expect(result).toEqual(expected);
    });

    it('should validate each property in the timeout options', () => {
      expect(() => {
        TimeoutValidator.validateTimeoutOptions({
          global: -1 // Invalid
        });
      }).toThrow(ValidationError);
      
      expect(() => {
        TimeoutValidator.validateTimeoutOptions({
          request: 'invalid' as any // Invalid
        });
      }).toThrow(ValidationError);
      
      expect(() => {
        TimeoutValidator.validateTimeoutOptions({
          transform: MAX_TIMEOUT_MS + 1000 // Invalid
        });
      }).toThrow(ValidationError);
    });

    it('should accept custom default timeouts', () => {
      const customDefaults = {
        global: 2000,
        request: 3000,
        transform: 1500
      };
      
      const input = {
        condition: 1000
      };
      
      const expected = {
        ...customDefaults,
        condition: 1000,
        loop: DEFAULT_TIMEOUTS.loop,
        expression: DEFAULT_TIMEOUTS.expression
      };
      
      const result = TimeoutValidator.validateTimeoutOptions(input, customDefaults);
      expect(result).toEqual(expected);
    });
  });
}); 