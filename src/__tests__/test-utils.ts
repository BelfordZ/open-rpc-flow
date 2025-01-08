import { StepExecutionContext } from '../types';
import { ExpressionEvaluator } from '../expression-evaluator';
import { ReferenceResolver } from '../reference-resolver';
import { TransformExecutor } from '../transform-executor';
import { noLogger } from '../util/logger';

/**
 * Creates a mock execution context for testing
 */
export function createMockContext(
  initialStepResults: Record<string, any> = {},
  initialContext: Record<string, any> = {},
): StepExecutionContext {
  const stepResults = new Map(Object.entries(initialStepResults));
  const context = { ...initialContext };

  const referenceResolver = new ReferenceResolver(stepResults, context, noLogger);
  const expressionEvaluator = new ExpressionEvaluator(referenceResolver, context, noLogger);
  const transformExecutor = new TransformExecutor(
    expressionEvaluator,
    referenceResolver,
    context,
    noLogger,
  );

  return {
    referenceResolver,
    expressionEvaluator,
    transformExecutor,
    stepResults,
    context,
    logger: noLogger,
  };
}

/**
 * Creates a mock JSON-RPC handler for testing
 */
export function createMockJsonRpcHandler(_mockResponses: Record<string, any> = {}) {
  return jest.fn().mockImplementation((request) => {
    const response = _mockResponses[request.method];
    if (response === undefined) {
      throw new Error(`No mock response for method: ${request.method}`);
    }
    return Promise.resolve(response);
  });
}

/**
 * Creates a mock step executor for testing
 */
export function createMockStepExecutor() {
  return jest.fn().mockImplementation((step, context) => {
    return Promise.resolve({
      result: { success: true },
      type: 'mock',
      metadata: { step: step.name },
    });
  });
}

/**
 * Creates a mock expression evaluator for testing
 */
export function createMockExpressionEvaluator() {
  return {
    evaluateExpression: jest.fn().mockImplementation((expr) => expr),
    evaluateCondition: jest.fn().mockReturnValue(true),
  };
}

/**
 * Creates a mock reference resolver for testing
 */
export function createMockReferenceResolver() {
  return {
    resolveReference: jest.fn().mockImplementation((ref) => ref),
    resolveReferences: jest.fn().mockImplementation((obj) => obj),
  };
}

/**
 * Creates a mock transform executor for testing
 */
export function createMockTransformExecutor() {
  return {
    executeTransform: jest.fn().mockImplementation((transform) => transform.input),
  };
}

/**
 * Utility to wait for all promises to resolve
 */
export async function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}
