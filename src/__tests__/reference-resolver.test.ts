import { 
  PathAccessor, 
  PathSyntaxError, 
  PropertyAccessError, 
  InvalidPathError,
  PathAccessorError
} from '../path-accessor';
import { ReferenceResolver } from '../reference-resolver';

describe('ReferenceResolver', () => {
  let resolver: ReferenceResolver;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;

  beforeEach(() => {
    stepResults = new Map();
    context = {
      config: {
        enabled: true,
        threshold: 100
      }
    };
    resolver = new ReferenceResolver(stepResults, context);
  });

  describe('resolveReference', () => {
    beforeEach(() => {
      stepResults.set('step1', {
        result: {
          id: 1,
          name: 'test',
          nested: { value: 42 }
        },
        type: 'request'
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
          { id: 2, name: 'second' }
        ],
        type: 'request'
      });

      expect(resolver.resolveReference('${items.result[0].name}')).toBe('first');
      expect(resolver.resolveReference('${items.result[1].id}')).toBe(2);
    });

    it('resolves references with quoted property names', () => {
      stepResults.set('data', {
        result: {
          'special-key': 'value',
          'another.key': 42
        },
        type: 'request'
      });

      expect(resolver.resolveReference('${data.result["special-key"]}')).toBe('value');
      expect(resolver.resolveReference("${data.result['another.key']}")).toBe(42);
    });

    it('throws on unknown references', () => {
      expect(() => resolver.resolveReference('${unknown.value}'))
        .toThrow('Unknown reference: unknown');
    });

    it('throws on invalid property access', () => {
      expect(() => resolver.resolveReference('${step1.result.nonexistent}'))
        .toThrow('Cannot access property');
      expect(() => resolver.resolveReference('${step1.result.id.invalid}'))
        .toThrow('Cannot access property');
    });

    it('throws on invalid path syntax', () => {
        expect(() => resolver.resolveReference('${step1[result]}')).toThrow('Property names in brackets must be quoted or numeric at position 12');
        expect(() => resolver.resolveReference('${step1.result[0}')).toThrow('Unclosed [');
    });
  });

  describe('resolveReferences', () => {
    beforeEach(() => {
      stepResults.set('user', {
        result: {
          id: 1,
          name: 'test'
        },
        type: 'request'
      });
      stepResults.set('items', {
        result: [
          { id: 1, value: 'first' },
          { id: 2, value: 'second' }
        ],
        type: 'request'
      });
    });

    it('resolves references in objects', () => {
      const obj = {
        userId: '${user.result.id}',
        userName: '${user.result.name}',
        config: {
          enabled: '${context.config.enabled}'
        }
      };

      expect(resolver.resolveReferences(obj)).toEqual({
        userId: 1,
        userName: 'test',
        config: {
          enabled: true
        }
      });
    });

    it('resolves references in arrays', () => {
      const arr = [
        '${user.result.id}',
        {
          name: '${user.result.name}',
          items: ['${items.result[0].value}', '${items.result[1].value}']
        }
      ];

      expect(resolver.resolveReferences(arr)).toEqual([
        1,
        {
          name: 'test',
          items: ['first', 'second']
        }
      ]);
    });

    it('handles non-reference values', () => {
      const obj = {
        literal: 42,
        str: 'plain text',
        bool: true,
        null: null,
        undefined: undefined
      };

      expect(resolver.resolveReferences(obj)).toEqual(obj);
    });

    it('propagates errors from invalid references', () => {
      const obj = {
        invalid: '${unknown.value}'
      };

      expect(() => resolver.resolveReferences(obj))
        .toThrow('Unknown reference: unknown');
    });
  });

  describe('resolvePath', () => {
    beforeEach(() => {
      stepResults.set('step1', {
        result: {
          id: 1,
          name: 'test',
          nested: { value: 42 }
        },
        type: 'request'
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
          { id: 2, name: 'second' }
        ],
        type: 'request'
      });

      expect(resolver.resolvePath('items.result[0].name')).toBe('first');
      expect(resolver.resolvePath('items.result[1].id')).toBe(2);
    });

    it('resolves paths with quoted property names', () => {
      stepResults.set('data', {
        result: {
          'special-key': 'value',
          'another.key': 42
        },
        type: 'request'
      });

      expect(resolver.resolvePath('data.result["special-key"]')).toBe('value');
      expect(resolver.resolvePath("data.result['another.key']")).toBe(42);
    });

    it('resolves paths with extra context', () => {
      const extraContext = {
        item: { id: 1, value: 'test' }
      };

      expect(resolver.resolvePath('item.id', extraContext)).toBe(1);
      expect(resolver.resolvePath('item.value', extraContext)).toBe('test');
    });

    it('throws on unknown references', () => {
      expect(() => resolver.resolvePath('unknown.value'))
        .toThrow('Unknown reference: unknown');
    });

    it('throws on invalid property access', () => {
      expect(() => resolver.resolvePath('step1.result.nonexistent'))
        .toThrow('Cannot access property');
      expect(() => resolver.resolvePath('step1.result.id.invalid'))
        .toThrow('Cannot access property');
    });

    it('throws on invalid path syntax', () => {
        expect(() => resolver.resolvePath('step1[result]')).toThrow('Path cannot start with [');
        expect(() => resolver.resolvePath('step1.result[0')).toThrow('Unclosed [');
    });
  });
}); 
