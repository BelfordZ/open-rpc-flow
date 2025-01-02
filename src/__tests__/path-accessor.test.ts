import {
  PathAccessor,
  InvalidPathError,
  PropertyAccessError,
  PathSyntaxError,
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

    it('should handle leading dots', () => {
      const result = PathAccessor.parsePath('.foo.bar');
      expect(result).toEqual([
        { type: 'property', value: 'foo', raw: 'foo' },
        { type: 'property', value: 'bar', raw: 'bar' },
      ]);
    });

    describe('error handling', () => {
      it('should throw PathSyntaxError on invalid bracket syntax', () => {
        expect(() => PathAccessor.parsePath('foo[bar')).toThrow(PathSyntaxError);
        expect(() => PathAccessor.parsePath('foo]')).toThrow(PathSyntaxError);
        expect(() => PathAccessor.parsePath('foo[[bar]]')).toThrow(PathSyntaxError);
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
  });
});
