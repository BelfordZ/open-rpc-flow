import { ValidationError } from '../../errors';
import { FlowExecutor } from '../../flow-executor';
import { Flow, Step } from '../../types';

// Mock JSON-RPC handler for testing
const mockJsonRpcHandler = jest.fn();

describe('ValidationError scenarios', () => {
  beforeEach(() => {
    mockJsonRpcHandler.mockReset();
  });

  it('should throw ValidationError for flow missing name', () => {
    // Create an invalid flow missing the required name field
    const invalidFlow = {
      // name is missing
      description: 'A flow with missing name',
      steps: [
        {
          name: 'step1',
          request: {
            method: 'test',
            params: {},
          },
        },
      ],
    } as Flow;

    // Now expected to throw ValidationError
    expect(() => {
      new FlowExecutor(invalidFlow, mockJsonRpcHandler);
    }).toThrow(ValidationError);
    expect(() => {
      new FlowExecutor(invalidFlow, mockJsonRpcHandler);
    }).toThrow('Missing required field: name');
  });

  it('should throw ValidationError for flow missing steps', () => {
    // Create an invalid flow missing the required steps field
    const invalidFlow = {
      name: 'missingStepsFlow',
      description: 'A flow with missing steps',
      // steps is missing
    } as Flow;

    // Now expected to throw ValidationError
    expect(() => {
      new FlowExecutor(invalidFlow, mockJsonRpcHandler);
    }).toThrow(ValidationError);
    expect(() => {
      new FlowExecutor(invalidFlow, mockJsonRpcHandler);
    }).toThrow('Missing required field: steps');
  });

  it('should throw ValidationError for flow with empty steps array', () => {
    // Create an invalid flow with empty steps array
    const invalidFlow = {
      name: 'emptyStepsFlow',
      description: 'A flow with empty steps',
      steps: [], // Empty array
    } as Flow;

    expect(() => {
      new FlowExecutor(invalidFlow, mockJsonRpcHandler);
    }).toThrow(ValidationError);
    expect(() => {
      new FlowExecutor(invalidFlow, mockJsonRpcHandler);
    }).toThrow('Flow must have at least one step');
  });

  it('should throw ValidationError for flow with a step missing name', () => {
    // Create an invalid flow with a step missing name
    const invalidFlow = {
      name: 'stepMissingNameFlow',
      description: 'A flow with a step missing name',
      steps: [
        {
          // name is missing
          request: {
            method: 'test',
            params: {},
          },
        } as Step,
      ],
    } as Flow;

    expect(() => {
      new FlowExecutor(invalidFlow, mockJsonRpcHandler);
    }).toThrow(ValidationError);
    expect(() => {
      new FlowExecutor(invalidFlow, mockJsonRpcHandler);
    }).toThrow('Step at index 0 is missing required field: name');
  });
}); 