import { SafeExpressionEvaluator, _UnknownReferenceError } from '../../expression-evaluator/safe-evaluator';
import { ExpressionError } from '../../expression-evaluator/errors';
import { TestLogger } from '../../util/logger';
import { ReferenceResolver } from '../../reference-resolver';
import { PropertyAccessError, PathSyntaxError } from '../../path-accessor';

describe('SafeExpressionEvaluator - Reference Error Handling', () => {
  let evaluator: SafeExpressionEvaluator;
  let stepResults: Map<string, any>;
  let context: Record<string, any>;
  let referenceResolver: ReferenceResolver;
  const logger = new TestLogger('SafeEvaluatorReferenceErrorTest');

  beforeEach(() => {
    stepResults = new Map();
    context = {};
    referenceResolver = new ReferenceResolver(stepResults, context, logger);
    evaluator = new SafeExpressionEvaluator(logger, referenceResolver);
  });

  afterEach(() => {
    logger.clear();
  });

  describe('handleReferenceError method', () => {
    it('should handle PropertyAccessError correctly', () => {
      // We need to access the private handleReferenceError method
      const evaluatorAny = evaluator as any;
      
      // Create a PropertyAccessError with all required parameters
      const propertyError = new PropertyAccessError(
        "Cannot access property 'test' of null", 
        'path.to.property', 
        { type: 'property', value: 'test', raw: 'test' }, 
        null
      );
      
      // Call the method and expect it to throw an ExpressionError with the same message
      expect(() => {
        evaluatorAny.handleReferenceError(propertyError, "Error resolving reference");
      }).toThrow(ExpressionError);
      
      expect(() => {
        evaluatorAny.handleReferenceError(propertyError, "Error resolving reference");
      }).toThrow("Cannot access property 'test' of null");
    });

    it('should handle PathSyntaxError correctly', () => {
      const evaluatorAny = evaluator as any;
      const syntaxError = new PathSyntaxError(
        "Invalid path syntax", 
        'invalid..path', 
        2 // position
      );
      
      expect(() => {
        evaluatorAny.handleReferenceError(syntaxError, "Error resolving reference");
      }).toThrow(ExpressionError);
      
      expect(() => {
        evaluatorAny.handleReferenceError(syntaxError, "Error resolving reference");
      }).toThrow("Invalid path syntax: Invalid path syntax");
    });

    it('should handle generic Error correctly', () => {
      const evaluatorAny = evaluator as any;
      const genericError = new Error("Generic error message");
      
      expect(() => {
        evaluatorAny.handleReferenceError(genericError, "Error resolving reference");
      }).toThrow(ExpressionError);
      
      expect(() => {
        evaluatorAny.handleReferenceError(genericError, "Custom prefix");
      }).toThrow("Custom prefix: Generic error message");
    });

    it('should handle non-Error objects correctly', () => {
      const evaluatorAny = evaluator as any;
      const nonError = "This is not an error object";
      
      expect(() => {
        evaluatorAny.handleReferenceError(nonError, "Error resolving reference");
      }).toThrow(ExpressionError);
      
      expect(() => {
        evaluatorAny.handleReferenceError(nonError, "Error resolving reference");
      }).toThrow("Error resolving reference: This is not an error object");
    });

    // Test the interactions with evaluateAst for reference resolution errors
    it('should properly transform reference errors during evaluation', () => {
      // Create a mock ReferenceResolver that throws specific errors
      const mockResolver = {
        resolvePath: jest.fn().mockImplementation(() => {
          throw new PropertyAccessError(
            "Test property access error", 
            'test.path', 
            { type: 'property', value: 'path', raw: 'path' }, 
            {}
          );
        })
      };
      
      // Replace the reference resolver
      (evaluator as any).referenceResolver = mockResolver;
      
      // Create a reference node
      const referenceNode = {
        type: 'reference',
        path: 'test.path'
      };
      
      // Access the evaluateAst method
      const evaluatorAny = evaluator as any;
      const evaluateAst = evaluatorAny.evaluateAst.bind(evaluator);
      
      // Should throw a properly formatted ExpressionError
      expect(() => {
        evaluateAst(referenceNode, {}, Date.now());
      }).toThrow(ExpressionError);
      
      expect(() => {
        evaluateAst(referenceNode, {}, Date.now());
      }).toThrow("Test property access error");
    });
  });

  describe('integration tests for reference error handling', () => {
    it('should handle null property access errors in expressions', () => {
      context.nullObj = null;
      
      expect(() => 
        evaluator.evaluate('${context.nullObj.property}', {})
      ).toThrow(ExpressionError);
      
      expect(() => 
        evaluator.evaluate('${context.nullObj.property}', {})
      ).toThrow("Cannot access property 'property' of null");
    });

    it('should handle undefined property access errors in expressions', () => {
      context.undefinedObj = undefined;
      
      expect(() => 
        evaluator.evaluate('${context.undefinedObj.property}', {})
      ).toThrow(ExpressionError);
      
      expect(() => 
        evaluator.evaluate('${context.undefinedObj.property}', {})
      ).toThrow("Cannot access property 'property' of undefined");
    });

    it('should handle missing reference errors in expressions', () => {
      expect(() => 
        evaluator.evaluate('${nonExistentRef.property}', {})
      ).toThrow(ExpressionError);
    });

    it('should handle invalid path syntax in expressions', () => {
      expect(() => 
        evaluator.evaluate('${context..invalidSyntax}', {})
      ).toThrow(ExpressionError);
    });

    it('should handle reference errors in template literals', () => {
      expect(() => 
        evaluator.evaluate('`Value: ${nonExistentRef.property}`', {})
      ).toThrow(ExpressionError);
    });

    it('should handle reference errors in complex expressions', () => {
      context.obj = { value: 5 };
      
      expect(() => 
        evaluator.evaluate('${context.obj.value} + ${nonExistentRef.property}', {})
      ).toThrow(ExpressionError);
    });
  });
}); 