import {
  PathAccessor,
  InvalidPathError,
  PropertyAccessError,
  PathSyntaxError,
  UnknownReferenceError,
} from '../path-accessor';

describe('PathAccessor', () => {
  describe('parsePath', () => {
    it('should parse simple dot notation', () => {
      const result = PathAccessor.parsePath('foo.bar.baz');
      expect(result).toEqual([
        { type: 'property', value: 'foo', raw: 'foo' },
        { type: 'property', value: 'bar', raw: 'bar' },
        { type: 'property', value: 'baz', raw: 'baz' },
      ]);
    });

    it('should parse array indices', () => {
      const result = PathAccessor.parsePath('foo[0].bar[1]');
      expect(result).toEqual([
        { type: 'property', value: 'foo', raw: 'foo' },
        { type: 'index', value: '0', raw: '[0]' },
        { type: 'property', value: 'bar', raw: 'bar' },
        { type: 'index', value: '1', raw: '[1]' },
      ]);
    });

    it('should parse quoted property names', () => {
      const result = PathAccessor.parsePath('foo["bar-baz"].qux');
      expect(result).toEqual([
        { type: 'property', value: 'foo', raw: 'foo' },
        { type: 'property', value: 'bar-baz', raw: '["bar-baz"]' },
        { type: 'property', value: 'qux', raw: 'qux' },
      ]);
    });

    it('should handle single quotes in array notation', () => {
      const result = PathAccessor.parsePath("foo['bar'].baz");
      expect(result).toEqual([
        { type: 'property', value: 'foo', raw: 'foo' },
        { type: 'property', value: 'bar', raw: "['bar']" },
        { type: 'property', value: 'baz', raw: 'baz' },
      ]);
    });

    describe('error handling', () => {
      it('throws on empty path', () => {
        expect(() => PathAccessor.parsePath('')).toThrow(InvalidPathError);
      });

      it('throws on empty brackets', () => {
        expect(() => PathAccessor.parsePath('foo[]')).toThrow('Empty brackets are not allowed');
      });

      it('throws on paths starting with .', () => {
        expect(() => PathAccessor.parsePath('.foo')).toThrow('Path cannot start with .');
      });

      it('throws on inner paths starting with .', () => {
        expect(() => PathAccessor.parsePath('foo[.bar]')).toThrow('Path cannot start with .');
      });

      it('throws on consecutive dots', () => {
        expect(() => PathAccessor.parsePath('foo..bar')).toThrow(
          'Consecutive dots are not allowed',
        );
      });

      it('throws on paths that are just .', () => {
        expect(() => PathAccessor.parsePath('.')).toThrow('Path cannot start with .');
      });

      it('throws on paths that have invalid characters in property names', () => {
        expect(() => PathAccessor.parsePath('foo.~.bar')).toThrow(
          "Invalid character '~' in property name at position 4",
        );
      });

      it('throws unclosed quotes', () => {
        expect(() => PathAccessor.parsePath('foo["bar]')).toThrow('Unclosed quote');
      });

      it('throws unclosed brackets', () => {
        expect(() => PathAccessor.parsePath('foo["bar"')).toThrow('Unclosed [');
      });

      it('throws on invalid bracket syntax', () => {
        let error: PathSyntaxError | undefined;
        try {
          PathAccessor.parsePath('foo[1[2]]');
        } catch (e) {
          error = e as PathSyntaxError;
        }
        expect(error).toBeDefined();
        expect(error!.message).toBe('Invalid path syntax: Invalid bracket syntax at position 5: 1');
        expect(error!.path).toBe('foo[1[2]]');
        expect(error!.position).toBe(5);
      });

      it('should throw PathSyntaxError on invalid array index notation', () => {
        // Using dot notation for array indices should throw
        expect(() => PathAccessor.parsePath('123.foo')).toThrow(
          'Array indices must use bracket notation (e.g. [0] instead of .0)',
        );
        expect(() => PathAccessor.parsePath('foo.0.bar')).toThrow(
          'Array indices must use bracket notation (e.g. [0] instead of .0)',
        );
      });

      it('should include position in PathSyntaxError', () => {
        let error: PathSyntaxError | undefined;
        try {
          PathAccessor.parsePath('foo[[bar]]');
          // If we get here, the test should fail
          expect('should throw PathSyntaxError').toBe(false);
        } catch (e) {
          if (!(e instanceof PathSyntaxError)) {
            throw e;
          }
          error = e;
        }
        expect(error).toBeDefined();
        expect(error!.path).toBe('foo[[bar]]');
        expect(error!.position).toBe(4);
      });

      it('should throw PathSyntaxError on invalid quote syntax', () => {
        expect(() => PathAccessor.parsePath('foo["bar')).toThrow(PathSyntaxError);
        expect(() => PathAccessor.parsePath("foo['bar")).toThrow(PathSyntaxError);
        expect(() => PathAccessor.parsePath("foo.'bar'")).toThrow(PathSyntaxError);
      });

      it('should throw PathSyntaxError on invalid nested brackets', () => {
        let error: PathSyntaxError | undefined;
        try {
          PathAccessor.parsePath('foo[1[2]]');
        } catch (e) {
          error = e as PathSyntaxError;
        }
        expect(error).toBeDefined();
        expect(error!.message).toBe('Invalid path syntax: Invalid bracket syntax at position 5: 1');
        expect(error!.path).toBe('foo[1[2]]');
        expect(error!.position).toBe(5);
      });

      it('should throw PathSyntaxError on consecutive opening brackets', () => {
        let error: PathSyntaxError | undefined;
        try {
          PathAccessor.parsePath('foo[[1]]');
        } catch (e) {
          error = e as PathSyntaxError;
        }
        expect(error).toBeDefined();
        expect(error!.message).toBe(
          'Invalid path syntax: Invalid bracket syntax at position 4: multiple opening brackets at the same level',
        );
        expect(error!.path).toBe('foo[[1]]');
        expect(error!.position).toBe(4);
      });
    });

    describe('expressions in array indices', () => {
      it('should handle expressions in array indices', () => {
        const result = PathAccessor.parsePath('foo[bar[0]].baz');
        expect(result).toEqual([
          { type: 'property', value: 'foo', raw: 'foo' },
          { type: 'expression', value: 'bar[0]', raw: '[bar[0]]' },
          { type: 'property', value: 'baz', raw: 'baz' },
        ]);
      });

      it('should handle nested expressions in array indices', () => {
        const result = PathAccessor.parsePath('foo[bar[baz[0]]].qux');
        expect(result).toEqual([
          { type: 'property', value: 'foo', raw: 'foo' },
          { type: 'expression', value: 'bar[baz[0]]', raw: '[bar[baz[0]]]' },
          { type: 'property', value: 'qux', raw: 'qux' },
        ]);
      });

      it('should handle dot notation in expressions', () => {
        const result = PathAccessor.parsePath('foo[bar.baz].qux');
        expect(result).toEqual([
          { type: 'property', value: 'foo', raw: 'foo' },
          { type: 'expression', value: 'bar.baz', raw: '[bar.baz]' },
          { type: 'property', value: 'qux', raw: 'qux' },
        ]);
      });

      it('should handle mixed expressions and literals', () => {
        const result = PathAccessor.parsePath('foo[bar[0]]["qux"][2]');
        expect(result).toEqual([
          { type: 'property', value: 'foo', raw: 'foo' },
          { type: 'expression', value: 'bar[0]', raw: '[bar[0]]' },
          { type: 'property', value: 'qux', raw: '["qux"]' },
          { type: 'index', value: '2', raw: '[2]' },
        ]);
      });
    });

    describe('nested array notation', () => {
      it('should parse consecutive array notation', () => {
        const result = PathAccessor.parsePath('foo["bar"]["baz"]');
        expect(result).toEqual([
          { type: 'property', value: 'foo', raw: 'foo' },
          { type: 'property', value: 'bar', raw: '["bar"]' },
          { type: 'property', value: 'baz', raw: '["baz"]' },
        ]);
      });

      it('should parse mixed array and dot notation', () => {
        const result = PathAccessor.parsePath('foo["bar"].baz["qux"]');
        expect(result).toEqual([
          { type: 'property', value: 'foo', raw: 'foo' },
          { type: 'property', value: 'bar', raw: '["bar"]' },
          { type: 'property', value: 'baz', raw: 'baz' },
          { type: 'property', value: 'qux', raw: '["qux"]' },
        ]);
      });

      it('should parse array notation with single and double quotes', () => {
        const result = PathAccessor.parsePath('foo["bar"][\'baz\']');
        expect(result).toEqual([
          { type: 'property', value: 'foo', raw: 'foo' },
          { type: 'property', value: 'bar', raw: '["bar"]' },
          { type: 'property', value: 'baz', raw: "['baz']" },
        ]);
      });

      it('should parse array notation with numeric indices', () => {
        const result = PathAccessor.parsePath('foo["bar"][0]["baz"][1]');
        expect(result).toEqual([
          { type: 'property', value: 'foo', raw: 'foo' },
          { type: 'property', value: 'bar', raw: '["bar"]' },
          { type: 'index', value: '0', raw: '[0]' },
          { type: 'property', value: 'baz', raw: '["baz"]' },
          { type: 'index', value: '1', raw: '[1]' },
        ]);
      });
    });

    describe('get with nested array notation', () => {
      const obj = {
        foo: {
          bar: {
            baz: {
              qux: 'value',
            },
            'special-key': {
              'nested-key': 'nested-value',
            },
          },
        },
      };

      it('should get values using consecutive array notation', () => {
        expect(PathAccessor.get(obj, 'foo["bar"]["baz"]["qux"]')).toBe('value');
      });

      it('should get values using mixed array and dot notation', () => {
        expect(PathAccessor.get(obj, 'foo["bar"].baz["qux"]')).toBe('value');
      });

      it('should get values with special characters in keys', () => {
        expect(PathAccessor.get(obj, 'foo["bar"]["special-key"]["nested-key"]')).toBe(
          'nested-value',
        );
      });

      it('should handle array notation at root', () => {
        const arrayObj = { '0': { foo: 'bar' } };
        expect(PathAccessor.get(arrayObj, '[0]["foo"]')).toBe('bar');
      });
    });

    it('should handle unexpected closing brackets properly', () => {
      // This test specifically covers line 79 in accessor.ts
      // Test where a closing bracket is outside a quote
      expect(() => PathAccessor.parsePath('foo]')).toThrow('Unexpected ] at position 3');

      // Test with different position
      expect(() => PathAccessor.parsePath('foo.bar]')).toThrow('Unexpected ] at position 7');
    });
  });

  describe('get', () => {
    const obj = {
      foo: {
        bar: [{ baz: 'qux' }, { 'special-key': 'value' }],
      },
    };

    it('should get nested properties using dot notation', () => {
      expect(PathAccessor.get(obj, 'foo.bar[0].baz')).toBe('qux');
    });

    it('should get array indices', () => {
      expect(PathAccessor.get(obj, 'foo.bar[1]["special-key"]')).toBe('value');
    });

    describe('error handling', () => {
      it('should throw PropertyAccessError on non-existent properties', () => {
        try {
          PathAccessor.get(obj, 'foo.nonexistent');
          fail('Expected PropertyAccessError');
        } catch (error) {
          if (!(error instanceof PropertyAccessError)) {
            throw error;
          }
          expect(error.path).toBe('foo.nonexistent');
          expect(error.segment).toEqual({
            type: 'property',
            value: 'nonexistent',
            raw: 'nonexistent',
          });
          expect(error.target).toEqual(obj.foo);
        }
      });

      it('should throw PropertyAccessError on null/undefined access', () => {
        try {
          PathAccessor.get(obj, 'foo.bar[0].baz.invalid');
          fail('Expected PropertyAccessError');
        } catch (error) {
          if (!(error instanceof PropertyAccessError)) {
            throw error;
          }
          expect(error.path).toBe('foo.bar[0].baz.invalid');
          expect(error.segment).toEqual({
            type: 'property',
            value: 'invalid',
            raw: 'invalid',
          });
          expect(error.target).toBe('qux');
        }
      });

      it('should propagate PathSyntaxError from parsePath', () => {
        expect(() => PathAccessor.get(obj, 'foo[bar')).toThrow(PathSyntaxError);
      });

      it('should throw PropertyAccessError when accessing property of undefined', () => {
        const obj = { foo: { bar: undefined } };
        expect(() => PathAccessor.get(obj, 'foo.bar.baz')).toThrow(
          new PropertyAccessError(
            "Cannot access property 'baz' of undefined",
            'foo.bar.baz',
            { type: 'property', value: 'baz', raw: 'baz' },
            undefined,
          ),
        );
      });
    });

    it('should handle basic property access', () => {
      const obj = { foo: { bar: 'baz' } };
      expect(PathAccessor.get(obj, 'foo.bar')).toBe('baz');
    });

    it('should handle array access', () => {
      const obj = { arr: ['a', 'b', 'c'] };
      expect(PathAccessor.get(obj, 'arr[0]')).toBe('a');
      expect(PathAccessor.get(obj, 'arr[1]')).toBe('b');
    });

    it('should handle expression evaluation in array brackets', () => {
      const obj = {
        arr: ['a', 'b', 'c'],
        indices: [0, 1, 2],
      };

      // Mock expression evaluator that resolves paths
      const evaluateExpression = (expr: string) => {
        if (expr === 'indices[0]') return 0;
        if (expr === 'indices[1]') return 1;
        throw new Error(`Unknown expression: ${expr}`);
      };

      expect(PathAccessor.get(obj, 'arr[indices[0]]', evaluateExpression)).toBe('a');
      expect(PathAccessor.get(obj, 'arr[indices[1]]', evaluateExpression)).toBe('b');
    });

    it('should throw appropriate errors for invalid expressions', () => {
      const obj = { arr: ['a', 'b', 'c'] };

      // No expression evaluator provided
      expect(() => {
        PathAccessor.get(obj, 'arr[foo.bar]');
      }).toThrow(PathSyntaxError);

      // Expression evaluator returns invalid type
      expect(() => {
        PathAccessor.get(obj, 'arr[foo.bar]', () => ({}));
      }).toThrow(PathSyntaxError);

      // Expression evaluator throws
      expect(() => {
        PathAccessor.get(obj, 'arr[foo.bar]', () => {
          throw new Error('Invalid expression');
        });
      }).toThrow(PathSyntaxError);
    });
  });

  describe('has', () => {
    const obj = {
      foo: {
        bar: [{ baz: 'qux' }, { 'special-key': 'value' }],
      },
    };

    it('should return true for existing paths', () => {
      expect(PathAccessor.has(obj, 'foo.bar[0].baz')).toBe(true);
      expect(PathAccessor.has(obj, 'foo.bar[1]["special-key"]')).toBe(true);
    });

    it('should return false for non-existent paths', () => {
      expect(PathAccessor.has(obj, 'foo.nonexistent')).toBe(false);
      expect(PathAccessor.has(obj, 'foo.bar[0].baz.invalid')).toBe(false);
    });

    it('should propagate PathSyntaxError', () => {
      expect(() => PathAccessor.has(obj, 'foo[bar')).toThrow(PathSyntaxError);
    });
  });

  describe('getRoot', () => {
    it('should get the root segment', () => {
      expect(PathAccessor.getRoot('foo.bar.baz')).toBe('foo');
      expect(PathAccessor.getRoot('foo[0].bar')).toBe('foo');
    });

    it('should throw InvalidPathError on invalid paths', () => {
      expect(() => PathAccessor.getRoot('')).toThrow(InvalidPathError);
      expect(() => PathAccessor.getRoot('.')).toThrow(InvalidPathError);
      expect(() => PathAccessor.getRoot('[0]')).toThrow(InvalidPathError);
    });
  });

  describe('formatSegment and formatPath', () => {
    it('should format simple property segments', () => {
      const segment = { type: 'property' as const, value: 'foo', raw: 'foo' };
      expect(PathAccessor.formatSegment(segment)).toBe('foo');
    });

    it('should format index segments', () => {
      const segment = { type: 'index' as const, value: '0', raw: '0' };
      expect(PathAccessor.formatSegment(segment)).toBe('[0]');
    });

    it('should format special property segments', () => {
      const segment = { type: 'property' as const, value: 'foo-bar', raw: '"foo-bar"' };
      expect(PathAccessor.formatSegment(segment)).toBe('["foo-bar"]');
    });

    it('should format full paths', () => {
      const segments = [
        { type: 'property' as const, value: 'foo', raw: 'foo' },
        { type: 'index' as const, value: '0', raw: '0' },
        { type: 'property' as const, value: 'bar-baz', raw: '"bar-baz"' },
      ];
      expect(PathAccessor.formatPath(segments)).toBe('foo[0]["bar-baz"]');
    });

    it('should format paths with valid identifiers after first segment', () => {
      const segments = [
        { type: 'property' as const, value: 'foo', raw: 'foo' },
        { type: 'property' as const, value: 'bar', raw: 'bar' },
        { type: 'property' as const, value: 'baz', raw: 'baz' },
      ];
      expect(PathAccessor.formatPath(segments)).toBe('foo.bar.baz');
    });
  });
});

describe('PathAccessor error handling', () => {
  describe('parsePath', () => {
    it('should throw on consecutive opening brackets', () => {
      expect(() => PathAccessor.parsePath('foo[[0]]')).toThrow(PathSyntaxError);
    });

    it('should throw on invalid nested brackets', () => {
      expect(() => PathAccessor.parsePath('foo[[]]')).toThrow(PathSyntaxError);
    });

    it('should throw on unclosed brackets', () => {
      expect(() => PathAccessor.parsePath('foo[0')).toThrow(PathSyntaxError);
    });

    it('should throw on unclosed quotes', () => {
      expect(() => PathAccessor.parsePath('foo["bar')).toThrow(PathSyntaxError);
    });

    it.skip('should throw on empty brackets', () => {
      expect(() => PathAccessor.parsePath('foo[]')).toThrow(PathSyntaxError);
    });

    it('should throw on invalid characters in property names', () => {
      expect(() => PathAccessor.parsePath('foo@bar')).toThrow(PathSyntaxError);
    });

    it('should throw on numeric property names without brackets', () => {
      expect(() => PathAccessor.parsePath('foo.0')).toThrow(PathSyntaxError);
    });

    it('should throw on single quotes outside brackets', () => {
      expect(() => PathAccessor.parsePath("foo.'bar'")).toThrow(PathSyntaxError);
    });

    it('should throw on consecutive dots', () => {
      expect(() => PathAccessor.parsePath('foo..bar')).toThrow(PathSyntaxError);
    });

    it('should throw on empty path', () => {
      expect(() => PathAccessor.parsePath('')).toThrow(InvalidPathError);
    });
  });

  describe('get with expression evaluation', () => {
    const obj = {
      items: ['a', 'b', 'c'],
      indices: { first: 0, second: 1 },
    };

    it('should handle expression evaluation errors', () => {
      const evaluator = () => {
        throw new Error('Evaluation failed');
      };

      expect(() => PathAccessor.get(obj, 'items[indices.first]', evaluator)).toThrow(
        PathSyntaxError,
      );
    });

    it('should handle invalid expression results', () => {
      const evaluator = () => {
        return { invalid: 'type' };
      };

      expect(() => PathAccessor.get(obj, 'items[indices.first]', evaluator)).toThrow(
        PathSyntaxError,
      );
    });

    it('should propagate UnknownReferenceError', () => {
      const evaluator = () => {
        throw new UnknownReferenceError('Reference not found', 'unknown', ['available']);
      };

      expect(() => PathAccessor.get(obj, 'items[indices.first]', evaluator)).toThrow(
        UnknownReferenceError,
      );
    });

    it('should propagate PathSyntaxError', () => {
      const evaluator = (expr: string) => {
        throw new PathSyntaxError('invalid path', expr);
      };

      expect(() => PathAccessor.get(obj, 'items[indices.first]', evaluator)).toThrow(
        PathSyntaxError,
      );
    });
  });

  describe('formatSegment edge cases', () => {
    it('should format property segments with special characters', () => {
      const segment = { type: 'property' as const, value: '@invalid', raw: '@invalid' };
      expect(PathAccessor.formatSegment(segment)).toBe('["@invalid"]');
    });

    it('should format property segments with numbers', () => {
      const segment = { type: 'property' as const, value: '123', raw: '123' };
      expect(PathAccessor.formatSegment(segment)).toBe('["123"]');
    });
  });

  describe('formatPath edge cases', () => {
    it('should format path with all special characters', () => {
      const segments = [
        { type: 'property' as const, value: '@foo', raw: '@foo' },
        { type: 'index' as const, value: '0', raw: '[0]' },
        { type: 'property' as const, value: '123', raw: '123' },
      ];
      expect(PathAccessor.formatPath(segments)).toBe('["@foo"][0]["123"]');
    });

    it('should format path with mixed valid and special characters', () => {
      const segments = [
        { type: 'property' as const, value: 'valid', raw: 'valid' },
        { type: 'property' as const, value: '@invalid', raw: '@invalid' },
        { type: 'property' as const, value: 'alsoValid', raw: 'alsoValid' },
      ];
      expect(PathAccessor.formatPath(segments)).toBe('valid["@invalid"].alsoValid');
    });
  });
});
