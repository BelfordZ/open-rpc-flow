## Project: Enhanced Error Handling for Flow Execution Engine

### Goal

Improve the Flow Execution Engine’s error handling by introducing a clear, type-safe error class hierarchy. Define tests first to shape the error structure, then implement specific error classes that users can catch and handle intuitively, with a focus on developer experience (DX) for AI agent workflows.

### Approach

- **Test-First Development**: Write tests for key error scenarios to define the expected error structure and behavior.
- **Error Classes**: Create a hierarchy of error classes extending a base `FlowError`, with step-specific errors under `StepExecutionError`.
- **Type Safety**: Export all error classes so users can use `instanceof` checks and leverage TypeScript’s type system.
- **Documentation**: Provide clear examples for catching and handling errors.

---

### Step 1: Define the Tests

We’ll spec out tests for the main error scenarios, focusing on what users (especially AI agent workflows) would expect when things go wrong.

#### Test Scenarios and Expected Errors

1. **Invalid Flow Definition**
   - **Test**: Pass a flow missing `name` or `steps`.
   - **Expected**: Throws `ValidationError` with details (e.g., `"Missing required field: steps"`).

2. **Unresolved Dependencies**
   - **Test**: Reference a non-existent step (e.g., `${step1.id}` when `step1` isn’t defined).
   - **Expected**: Throws `DependencyError` with the missing step name.

3. **Expression Evaluation Failure**
   - **Test**: Use an invalid expression (e.g., `${oops}` or a syntax error).
   - **Expected**: Throws `ExpressionError` with the bad expression and reason.

4. **JSON-RPC Request Failure**
   - **Test**: Simulate a network error or JSON-RPC failure.
   - **Expected**: Throws `RequestError` with request details and failure reason.

5. **Step Execution Failures**
   - **Loop Step**: Pass a flow where a loop step lacks `step` or `steps`, or iterates over a non-array.
     - **Expected**: Throws `LoopError` (e.g., `"Loop must have either step or steps defined"` or `"Expected array for loop"`).
   - **Transform Step**: Use an invalid operation type or incompatible input.
     - **Expected**: Throws `TransformError` (e.g., `"Invalid transform operation: 'invalid'"`).
   - **Condition Step**: Pass a non-boolean condition result.
     - **Expected**: Throws `ConditionError` (e.g., `"Condition must evaluate to boolean"`).

#### Test Specs

Here’s the test suite to drop into your `src/__tests__/flow-executor.test.ts` (or wherever you keep your tests):

```typescript
import { FlowExecutor, ValidationError, DependencyError, ExpressionError, RequestError, LoopError, TransformError, ConditionError } from '../src';

describe('FlowExecutor Error Handling', () => {
  let jsonRpcHandler = jest.fn();

  beforeEach(() => {
    jsonRpcHandler.mockReset();
  });

  test('throws ValidationError for invalid flow definition', () => {
    const invalidFlow = { steps: [{ name: 'step1' }] }; // Missing 'name'
    const executor = new FlowExecutor(invalidFlow as any, jsonRpcHandler);
    expect(() => executor.execute()).toThrow(ValidationError);
    expect(() => executor.execute()).toThrow(/Missing required field: name/);
  });

  test('throws DependencyError for unresolved dependencies', () => {
    const flow = {
      name: 'DepFlow',
      steps: [{ name: 'step2', request: { method: 'test', params: { id: '${step1.id}' } } }],
    };
    const executor = new FlowExecutor(flow, jsonRpcHandler);
    expect(() => executor.execute()).toThrow(DependencyError);
    expect(() => executor.execute()).toThrow(/Missing step: step1/);
  });

  test('throws ExpressionError for invalid expressions', () => {
    const flow = {
      name: 'ExprFlow',
      steps: [{ name: 'step1', request: { method: 'test', params: { id: '${oops}' } } }],
    };
    const executor = new FlowExecutor(flow, jsonRpcHandler);
    expect(() => executor.execute()).toThrow(ExpressionError);
    expect(() => executor.execute()).toThrow(/Undefined variable: oops/);
  });

  test('throws RequestError for failed JSON-RPC requests', async () => {
    const flow = {
      name: 'ReqFlow',
      steps: [{ name: 'step1', request: { method: 'fail', params: {} } }],
    };
    jsonRpcHandler.mockRejectedValue(new Error('Network error'));
    const executor = new FlowExecutor(flow, jsonRpcHandler);
    await expect(executor.execute()).rejects.toThrow(RequestError);
    await expect(executor.execute()).rejects.toThrow(/Network error/);
  });

  test('throws LoopError for missing step/steps in loop', async () => {
    const flow = {
      name: 'LoopFlow',
      steps: [{ name: 'loop1', loop: { over: '${data}', as: 'item' } }],
    };
    const executor = new FlowExecutor(flow, jsonRpcHandler);
    await expect(executor.execute()).rejects.toThrow(LoopError);
    await expect(executor.execute()).rejects.toThrow(/Loop must have either step or steps defined/);
  });

  test('throws LoopError for non-array loop input', async () => {
    const flow = {
      name: 'LoopFlow',
      steps: [{ name: 'loop1', loop: { over: '${notAnArray}', as: 'item', step: { name: 'inner' } } }],
    };
    jsonRpcHandler.mockResolvedValue({ result: 'string' });
    const executor = new FlowExecutor(flow, jsonRpcHandler);
    await expect(executor.execute()).rejects.toThrow(LoopError);
    await expect(executor.execute()).rejects.toThrow(/Expected array/);
  });

  test('throws TransformError for invalid operation', async () => {
    const flow = {
      name: 'TransformFlow',
      steps: [{ name: 'transform1', transform: { input: '${data}', operations: [{ type: 'invalid' }] } }],
    };
    jsonRpcHandler.mockResolvedValue({ result: [1, 2, 3] });
    const executor = new FlowExecutor(flow, jsonRpcHandler);
    await expect(executor.execute()).rejects.toThrow(TransformError);
    await expect(executor.execute()).rejects.toThrow(/Invalid transform operation/);
  });

  test('throws ConditionError for non-boolean condition', async () => {
    const flow = {
      name: 'ConditionFlow',
      steps: [{ name: 'condition1', condition: { if: '${nonBoolean}', then: {}, else: {} } }],
    };
    jsonRpcHandler.mockResolvedValue({ result: 'not a boolean' });
    const executor = new FlowExecutor(flow, jsonRpcHandler);
    await expect(executor.execute()).rejects.toThrow(ConditionError);
    await expect(executor.execute()).rejects.toThrow(/Condition must evaluate to boolean/);
  });
});
```

---

### Step 2: Design the Error Classes

Based on the tests, here’s the updated error class hierarchy. We’re keeping step-specific validation errors under `StepExecutionError` for consistency.

#### Error Class Hierarchy

- **`FlowError`**: Base class for all library errors.
  - **`ValidationError`**: Pre-execution structural issues (e.g., missing flow fields).
  - **`DependencyError`**: Unresolved dependencies.
  - **`ExpressionError`**: Expression evaluation failures.
  - **`RequestError`**: JSON-RPC request failures.
  - **`StepExecutionError`**: General step execution issues (including step-specific validation).
    - **`LoopError`**: Loop-specific errors (e.g., missing `step`/`steps`, non-array input).
    - **`TransformError`**: Transform-specific errors (e.g., invalid operations).
    - **`ConditionError`**: Condition-specific errors (e.g., non-boolean conditions).

#### Implementation

Drop this into `src/errors.ts`:

```typescript
export class FlowError extends Error {
  constructor(message: string, public details: Record<string, any> = {}) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype); // Ensure proper inheritance
  }
}

export class ValidationError extends FlowError {}
export class DependencyError extends FlowError {}
export class ExpressionError extends FlowError {}
export class RequestError extends FlowError {}
export class StepExecutionError extends FlowError {}
export class LoopError extends StepExecutionError {}
export class TransformError extends StepExecutionError {}
export class ConditionError extends StepExecutionError {}
```

---

### Step 3: Integrate Error Handling

Update the `FlowExecutor` and step executors to throw these errors:

- **`FlowExecutor`**: Throw `ValidationError` for invalid flow definitions.
- **`DependencyResolver`**: Throw `DependencyError` for unresolved dependencies.
- **`SafeExpressionEvaluator`**: Throw `ExpressionError` for bad expressions.
- **`RequestStepExecutor`**: Throw `RequestError` for failed requests.
- **`LoopStepExecutor`**: Throw `LoopError` for missing `step`/`steps` or non-array inputs.
- **`TransformStepExecutor`**: Throw `TransformError` for invalid operations.
- **`ConditionStepExecutor`**: Throw `ConditionError` for non-boolean conditions.

Example updates:

```typescript
// src/flow-executor.ts
class FlowExecutor {
  constructor(flow: Flow, jsonRpcHandler: (request: JsonRpcRequest) => Promise<any>) {
    if (!flow.name) throw new ValidationError('Missing required field: name', { field: 'name' });
    if (!flow.steps?.length) throw new ValidationError('Flow must have at least one step', { field: 'steps' });
    // ... rest of constructor
  }
}

// src/step-executors/loop-executor.ts
class LoopStepExecutor {
  async execute(step: Step, context: StepExecutionContext) {
    if (!step.loop.step && !step.loop.steps) {
      throw new LoopError('Loop must have either step or steps defined', { stepName: step.name });
    }
    const overValue = context.expressionEvaluator.evaluate(step.loop.over);
    if (!Array.isArray(overValue)) {
      throw new LoopError('Expected array for loop iteration', { stepName: step.name, value: overValue });
    }
    // ... rest of execution
  }
}
```

---

### Step 4: Update Documentation

Add this to your `README.md`:

```markdown
## Error Handling

The Flow Execution Engine throws specific error classes, all extending `FlowError`. Use `instanceof` to catch and handle them.

### Error Classes

- `ValidationError`: Pre-execution flow structure issues (e.g., missing fields).
- `DependencyError`: Unresolved step dependencies.
- `ExpressionError`: Expression evaluation failures.
- `RequestError`: JSON-RPC request failures.
- `StepExecutionError`: Step execution issues.
  - `LoopError`: Loop-specific errors (e.g., missing configuration, invalid inputs).
  - `TransformError`: Transform-specific errors (e.g., invalid operations).
  - `ConditionError`: Condition-specific errors (e.g., non-boolean conditions).

### Example

```typescript
import { FlowExecutor, ValidationError, LoopError, RequestError } from '@open-rpc/flow';

try {
  const executor = new FlowExecutor(flow, jsonRpcHandler);
  await executor.execute();
} catch (error) {
  if (error instanceof ValidationError) {
    console.error(`Invalid flow: ${error.message}`, error.details);
  } else if (error instanceof LoopError) {
    console.error(`Loop issue in ${error.details.stepName}: ${error.message}`);
  } else if (error instanceof RequestError) {
    console.error(`Request failed: ${error.message}`, error.details);
  } else {
    console.error(`Unexpected error: ${error.message}`);
  }
}
```

---