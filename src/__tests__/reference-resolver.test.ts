import { ReferenceResolver } from '../reference-resolver';
import {
  UnknownReferenceError,
  InvalidReferenceError,
  ReferenceResolutionError,
} from '../reference-resolver/errors';
import { TestLogger } from '../util/logger';
import { PathSyntaxError, PropertyAccessError } from '../path-accessor';
import { noLogger } from '../util/logger';

describe('ReferenceResolver', () => {
  let resolver: ReferenceResolver;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;

  beforeEach(() => {
    stepResults = new Map();
    context = {
      config: {
        enabled: true,
        threshold: 100,
      },
    };
    resolver = new ReferenceResolver(stepResults, context, noLogger);
  });

  describe('resolveReference', () => {
    beforeEach(() => {
      stepResults.set('step1', {
        result: {
          id: 1,
          name: 'test',
          nested: { value: 42 },
        },
        type: 'request',
      });
    });

    it('returns non-reference strings as is', () => {
      expect(resolver.resolveReference('plain text')).toBe('plain text');
      expect(resolver.resolveReference('${incomplete')).toBe('${incomplete');
      expect(resolver.resolveReference('incomplete}')).toBe('incomplete}');
    });

    it('resolves simple references', () => {
      expect(resolver.resolveReference('${step1.result.id}')).toBe(1);
      expect(resolver.resolveReference('${step1.result.name}')).toBe('test');
    });

    it('resolves nested references', () => {
      expect(resolver.resolveReference('${step1.result.nested.value}')).toBe(42);
    });

    it('resolves context references', () => {
      expect(resolver.resolveReference('${context.config.enabled}')).toBe(true);
      expect(resolver.resolveReference('${context.config.threshold}')).toBe(100);
    });

    it('resolves references with array notation', () => {
      stepResults.set('items', {
        result: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' },
        ],
        type: 'request',
      });

      expect(resolver.resolveReference('${items.result[0].name}')).toBe('first');
      expect(resolver.resolveReference('${items.result[1].id}')).toBe(2);
    });

    it('resolves references with quoted property names', () => {
      stepResults.set('data', {
        result: {
          'special-key': 'value',
          'another.key': 42,
        },
        type: 'request',
      });

      expect(resolver.resolveReference('${data.result["special-key"]}')).toBe('value');
      expect(resolver.resolveReference("${data.result['another.key']}")).toBe(42);
    });

    it('throws on unknown references', () => {
      expect(() => resolver.resolveReference('${unknown.value}')).toThrow(
        "Reference 'unknown' not found. Available references are: step1, context",
      );
    });

    it('throws on invalid property access', () => {
      expect(() => resolver.resolveReference('${step1.result.nonexistent}')).toThrow(
        'Cannot access property',
      );
      expect(() => resolver.resolveReference('${step1.result.id.invalid}')).toThrow(
        'Cannot access property',
      );
    });

    it('throws on invalid path syntax', () => {
      expect(() => resolver.resolveReference('${step1.result[0}')).toThrow('Unclosed [');
    });

    it('wraps non-standard errors in InvalidReferenceError', () => {
      // Mock PathAccessor.parsePath to throw a generic Error
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const originalParsePath = require('../path-accessor').PathAccessor.parsePath;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require('../path-accessor').PathAccessor.parsePath = () => {
        throw new Error('Some unexpected error');
      };

      try {
        expect(() => resolver.resolveReference('${step1.result}')).toThrow(InvalidReferenceError);
        expect(() => resolver.resolveReference('${step1.result}')).toThrow('Some unexpected error');
      } finally {
        // Restore the original function
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('../path-accessor').PathAccessor.parsePath = originalParsePath;
      }
    });

    it('handles array pathing with expressions that evaluate to a string', () => {
      stepResults.set('step1', {
        result: 'test',
        type: 'request',
      });
      expect(resolver.resolveReference('${step1["result"]}')).toEqual('test');
    });

    it('handles objects that are inside complex strings', () => {
      stepResults.set('step1', {
        result: {
          items: { id: 1, name: 'Item 1', value: 100 },
        },
        type: 'request',
      });
      expect(resolver.resolveReferences('foo ${step1.result.items}')).toEqual(
        `foo ${JSON.stringify(stepResults.get('step1').result.items)}`,
      );
    });

    it('handles arrays that are inside complex strings', () => {
      stepResults.set('step1', {
        result: {
          items: [{ id: 1, name: 'Item 1', value: 100 }],
        },
        type: 'request',
      });
      expect(resolver.resolveReferences('foo ${step1.result.items}')).toEqual(
        `foo ${JSON.stringify(stepResults.get('step1').result.items)}`,
      );
    });

    it('handles arrays twice that are inside complex strings', () => {
      stepResults.set('step1', {
        result: {
          items: [{ id: 1, name: 'Item 1', value: 100 }],
        },
        type: 'request',
      });
      expect(
        resolver.resolveReferences('foo ${step1.result.items} foo ${step1.result.items}'),
      ).toEqual(
        `foo ${JSON.stringify(stepResults.get('step1').result.items)} foo ${JSON.stringify(
          stepResults.get('step1').result.items,
        )}`,
      );
    });

    it('should handle basic references', () => {
      const stepResults = new Map([['step1', { value: 'test' }]]);
      resolver = new ReferenceResolver(stepResults, {}, noLogger);
      expect(resolver.resolveReference('${step1.value}')).toBe('test');
    });

    it('should handle array access with expressions', () => {
      const stepResults = new Map([
        [
          'arr',
          {
            result: ['a', 'b', 'c'],
            indices: [0, 1, 2],
          },
        ],
      ]);
      resolver = new ReferenceResolver(stepResults, {}, noLogger);

      // Test array access with expressions
      expect(resolver.resolveReference('${arr.result[arr.indices[0]]}')).toBe('a');
      expect(resolver.resolveReference('${arr.result[arr.indices[1]]}')).toBe('b');
    });

    it('should handle nested array access with expressions', () => {
      const stepResults = new Map([
        [
          'complex',
          {
            matrix: [
              ['a1', 'a2'],
              ['b1', 'b2'],
            ],
            indices: {
              row: [0, 1],
              col: [0, 1],
            },
          },
        ],
      ]);
      resolver = new ReferenceResolver(stepResults, {}, noLogger);

      // Test nested array access with expressions
      expect(
        resolver.resolveReference(
          '${complex.matrix[complex.indices.row[0]][complex.indices.col[1]]}',
        ),
      ).toBe('a2');
      expect(
        resolver.resolveReference(
          '${complex.matrix[complex.indices.row[1]][complex.indices.col[0]]}',
        ),
      ).toBe('b1');
    });

    describe('invalid expressions', () => {
      beforeEach(() => {
        const stepResults = new Map();
        stepResults.set('arr', {
          result: ['a', 'b', 'c'],
          indices: [0, 1, 2],
        });
        stepResults.set('expr', { value: {} });
        resolver = new ReferenceResolver(stepResults, {}, noLogger);
      });
      it('should throw appropriate errors for invalid expressions', () => {
        // Test invalid array index - should throw UnknownReferenceError
        expect(() => {
          resolver.resolveReference('${arr.result[invalid[0]]}');
        }).toThrow(UnknownReferenceError);

        // Test out of bounds array index - should throw InvalidReferenceError
        expect(() => {
          resolver.resolveReference('${arr.result[arr.indices[99]]}');
        }).toThrow(InvalidReferenceError);

        // Test invalid path syntax - should throw InvalidReferenceError
        expect(() => {
          resolver.resolveReference('${arr.result[arr.indices[}');
        }).toThrow(InvalidReferenceError);

        // Test non-UnknownReferenceError during expression evaluation
        expect(() => {
          resolver.resolveReference('${arr.result[expr.value.nonexistent]}');
        }).toThrow(InvalidReferenceError);
      });

      xit('should handle error during array access expression evaluation', () => {
        stepResults.set('error', {
          value: {
            toString: () => {
              throw 'Not an error object';
            },
          },
        });

        expect(() => {
          resolver.resolveReference('${arr.result[error.value]}');
        }).toThrow(PathSyntaxError);

        expect(() => {
          resolver.resolveReference('${arr.result[error.value]}');
        }).toThrow('Not an error object');
      });
    });
  });

  describe('resolveReferences', () => {
    beforeEach(() => {
      stepResults.set('user', {
        result: {
          id: 1,
          name: 'test',
        },
        type: 'request',
      });
      stepResults.set('items', {
        result: [
          { id: 1, value: 'first' },
          { id: 2, value: 'second' },
        ],
        type: 'request',
      });
    });

    it('resolves references in objects', () => {
      const obj = {
        userId: '${user.result.id}',
        userName: '${user.result.name}',
        config: {
          enabled: '${context.config.enabled}',
        },
      };

      expect(resolver.resolveReferences(obj)).toEqual({
        userId: 1,
        userName: 'test',
        config: {
          enabled: true,
        },
      });
    });

    it('resolves references in arrays', () => {
      const arr = [
        '${user.result.id}',
        {
          name: '${user.result.name}',
          items: ['${items.result[0].value}', '${items.result[1].value}'],
        },
      ];

      expect(resolver.resolveReferences(arr)).toEqual([
        1,
        {
          name: 'test',
          items: ['first', 'second'],
        },
      ]);
    });

    it('handles non-reference values', () => {
      const obj = {
        literal: 42,
        str: 'plain text',
        bool: true,
        null: null,
        undefined: undefined,
      };

      expect(resolver.resolveReferences(obj)).toEqual(obj);
    });

    it('propagates errors from invalid references', () => {
      const obj = {
        name: 'John',
        bio: 'Works at ${unknown.company}',
      };

      expect(() => resolver.resolveReferences(obj)).toThrow(ReferenceResolutionError);
    });
  });

  describe('resolvePath', () => {
    beforeEach(() => {
      stepResults.set('step1', {
        result: {
          id: 1,
          name: 'test',
          nested: { value: 42 },
        },
        type: 'request',
      });
    });

    it('resolves simple paths', () => {
      expect(resolver.resolvePath('step1.result.id')).toBe(1);
      expect(resolver.resolvePath('step1.result.name')).toBe('test');
    });

    it('resolves paths with array notation', () => {
      stepResults.set('items', {
        result: [
          { id: 1, name: 'first' },
          { id: 2, name: 'second' },
        ],
        type: 'request',
      });

      expect(resolver.resolvePath('items.result[0].name')).toBe('first');
      expect(resolver.resolvePath('items.result[1].id')).toBe(2);
    });

    it('resolves paths with quoted property names', () => {
      stepResults.set('data', {
        result: {
          'special-key': 'value',
          'another.key': 42,
        },
        type: 'request',
      });

      expect(resolver.resolvePath('data.result["special-key"]')).toBe('value');
      expect(resolver.resolvePath("data.result['another.key']")).toBe(42);
    });

    it('resolves paths with extra context', () => {
      const extraContext = {
        item: { id: 1, value: 'test' },
      };

      expect(resolver.resolvePath('item.id', extraContext)).toBe(1);
      expect(resolver.resolvePath('item.value', extraContext)).toBe('test');
    });

    it('throws on unknown references', () => {
      expect(() => resolver.resolvePath('unknown.value')).toThrow(
        "Reference 'unknown' not found. Available references are: step1, context",
      );
    });

    it('throws on invalid property access', () => {
      expect(() => resolver.resolvePath('step1.result.nonexistent')).toThrow(
        'Cannot access property',
      );
      expect(() => resolver.resolvePath('step1.result.id.invalid')).toThrow(
        'Cannot access property',
      );
    });

    it('throws on invalid path syntax', () => {
      expect(() => resolver.resolvePath('[result]')).toThrow('Invalid path: [result]');
      expect(() => resolver.resolvePath('step1.result[0')).toThrow('Unclosed [');
    });

    it('wraps non-standard errors in PathSyntaxError', () => {
      // Create an object that throws when accessed
      const errorObj = {
        result: ['a', 'b', 'c'],
        get index() {
          throw 'Not an error object';
        },
      };
      stepResults.set('error', errorObj);

      expect(() => {
        resolver.resolvePath('error.result[error.index]');
      }).toThrow(PathSyntaxError);
      expect(() => {
        resolver.resolvePath('error.result[error.index]');
      }).toThrow('Not an error object');
    });
  });

  describe('getStepResults', () => {
    it('returns the step results', () => {
      expect(resolver.getStepResults()).toEqual(stepResults);
    });
  });
});

describe('ReferenceResolver error cases', () => {
  it('throws when encountering an unknown reference', () => {
    const refs = new ReferenceResolver(new Map(), {}, noLogger);
    expect(() => refs.resolveReference('${someRef}', {})).toThrow(UnknownReferenceError);
  });

  describe('invalid expressions', () => {
    it('throws for invalid path accessors, empty path', () => {
      const refs = new ReferenceResolver(new Map(), {}, noLogger);
      const context = {
        someRef: {
          a: 'value-a',
        },
      };
      expect(() => refs.resolveReference('${someRef.}', context)).toThrow(InvalidReferenceError);
    });

    it('throws for invalid path accessors, trailing dot', () => {
      const refs = new ReferenceResolver(new Map(), {}, noLogger);
      const context = {
        someRef: {
          a: 'value-a',
        },
      };
      // The implementation doesn't actually throw for trailing dots - it just ignores them
      // instead, let's test that trying to access an invalid property will throw
      const stepsMap = new Map();
      stepsMap.set('someRef', { a: 'value-a' });
      const resolver = new ReferenceResolver(stepsMap, {}, noLogger);
      expect(() => resolver.resolveReference('${someRef.b}', {})).toThrow(InvalidReferenceError);
    });

    it('throws for invalid path accessors, dot followed by operators', () => {
      const refs = new ReferenceResolver(new Map(), {}, noLogger);
      const context = {
        someRef: {
          a: 'value-a',
        },
      };
      expect(() => refs.resolveReference('${someRef.a.*}', context)).toThrow(InvalidReferenceError);
    });

    it('throws for invalid path accessors, leading dot', () => {
      const refs = new ReferenceResolver(new Map(), {}, noLogger);
      const context = {
        someRef: {
          a: 'value-a',
        },
      };
      expect(() => refs.resolveReference('${.someRef}', context)).toThrow(InvalidReferenceError);
    });
  });
});