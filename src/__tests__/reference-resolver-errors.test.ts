import { ReferenceResolver } from '../reference-resolver';
import {
  UnknownReferenceError,
  InvalidReferenceError,
  ReferenceResolutionError,
  CircularReferenceError,
} from '../reference-resolver/errors';
import { TestLogger } from '../util/logger';

describe('ReferenceResolver Error Classes', () => {
  let testLogger: TestLogger;
  let stepResults: Map<string, any>;

  beforeEach(() => {
    testLogger = new TestLogger('ReferenceResolverTest');
    stepResults = new Map();
    stepResults.set('user', { id: 1, name: 'John Doe' });
  });

  afterEach(() => {
    testLogger.clear();
  });

  describe('UnknownReferenceError', () => {
    it('throws UnknownReferenceError when reference is not found', () => {
      const resolver = new ReferenceResolver(stepResults, {}, testLogger);
      
      try {
        resolver.resolveReference('${nonExistentRef}');
        fail('Expected UnknownReferenceError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(UnknownReferenceError);
        if (error instanceof UnknownReferenceError) {
          expect(error.reference).toBe('nonExistentRef');
          expect(error.availableReferences).toContain('user');
          expect(error.availableReferences).toContain('context');
          expect(error.message).toContain('Reference \'nonExistentRef\' not found');
        }
      }
    });
  });

  describe('InvalidReferenceError', () => {
    it('throws InvalidReferenceError when reference syntax is invalid', () => {
      const resolver = new ReferenceResolver(stepResults, {}, testLogger);
      
      try {
        // Creating a reference with invalid syntax - the path syntax is invalid 
        resolver.resolveReference('${user.[}');
        fail('Expected InvalidReferenceError to be thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidReferenceError);
        if (error instanceof InvalidReferenceError) {
          expect(error.reference).toBe('user.[');
          expect(error.message).toBeTruthy();
        }
      }
    });
  });

  describe('ReferenceResolutionError', () => {
    it('correctly creates a ReferenceResolutionError instance', () => {
      // Manually create the error - we can't easily trigger it in normal flow
      const error = new ReferenceResolutionError(
        'Failed to resolve references in string',
        'path.to.something',
        ['${ref1}', '${ref2}'],
        new Error('Original error')
      );
      
      expect(error).toBeInstanceOf(ReferenceResolutionError);
      expect(error.path).toBe('path.to.something');
      expect(error.value).toEqual(['${ref1}', '${ref2}']);
      expect(error.cause).toBeInstanceOf(Error);
      expect(error.message).toBe('Failed to resolve references in string');
    });
  });

  describe('CircularReferenceError', () => {
    it('can create CircularReferenceError with references array', () => {
      const error = new CircularReferenceError(
        'Circular reference detected: a -> b -> a',
        ['a', 'b', 'a']
      );
      
      expect(error).toBeInstanceOf(CircularReferenceError);
      expect(error.references).toEqual(['a', 'b', 'a']);
      expect(error.message).toBe('Circular reference detected: a -> b -> a');
    });
  });
}); 