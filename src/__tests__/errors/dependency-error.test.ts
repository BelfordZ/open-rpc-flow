import { DependencyError } from '../../errors';
import { FlowExecutor } from '../../flow-executor';
import { Flow } from '../../types';

// Mock JSON-RPC handler for testing
const mockJsonRpcHandler = jest.fn();

describe('DependencyError scenarios', () => {
  beforeEach(() => {
    mockJsonRpcHandler.mockReset();
  });

  it('should throw DependencyError for unresolved step dependencies', async () => {
    // Create a flow with a dependency on a non-existent step
    const flowWithMissingDependency = {
      name: 'dependencyErrorFlow',
      description: 'A flow with missing dependencies',
      steps: [
        {
          name: 'step2',
          request: {
            method: 'test',
            params: {
              id: '${step1.result}', // step1 doesn't exist
            },
          },
        },
      ],
    };

    const executor = new FlowExecutor(flowWithMissingDependency, mockJsonRpcHandler);
    
    // Now expected to throw DependencyError
    await expect(executor.execute()).rejects.toThrow(DependencyError);
    await expect(executor.execute()).rejects.toThrow(/depends on unknown step/);
  });

  it('should throw DependencyError for circular dependencies', async () => {
    // Create a flow with circular dependencies
    const flowWithCircularDependency = {
      name: 'circularDependencyFlow',
      description: 'A flow with circular dependencies',
      steps: [
        {
          name: 'step1',
          request: {
            method: 'test',
            params: {
              id: '${step2.result}', // Depends on step2
            },
          },
        },
        {
          name: 'step2',
          request: {
            method: 'test',
            params: {
              id: '${step1.result}', // Depends on step1, creating a circular dependency
            },
          },
        },
      ],
    };

    const executor = new FlowExecutor(flowWithCircularDependency, mockJsonRpcHandler);
    
    // Now expected to throw DependencyError
    await expect(executor.execute()).rejects.toThrow(DependencyError);
    await expect(executor.execute()).rejects.toThrow(/Circular dependency detected/);
  });
}); 