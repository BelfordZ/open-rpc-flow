# TKT-TIMEOUT-020: Timeout Feature Integration and Final Testing

## Description
Integrate all timeout-related components and conduct comprehensive testing to ensure they work together seamlessly. This final ticket ensures that all timeout functionality is properly integrated, tested, and documented before release.

## Acceptance Criteria
- Integrate all timeout-related components into the main codebase
- Ensure proper interaction between timeout resolution, context propagation, and error handling
- Verify correct timeout behavior across complex flow scenarios
- Validate error messages and metadata for timeout errors
- Update all relevant documentation with final implementation details
- Create comprehensive end-to-end examples
- Conduct final review of all timeout-related code
- Address any issues found during integration testing

## Integration and Testing Strategy

### Component Integration
1. Update base interfaces and types with timeout-related fields
2. Implement timeout resolution logic and default values
3. Integrate TimeoutContext into all step executors
4. Update FlowExecutor to handle timeout propagation
5. Connect timeout monitoring and metrics collection
6. Implement timeout retry handling

### Testing Strategy
1. Unit tests for individual components
2. Integration tests for timeout resolution and propagation
3. End-to-end tests with complex flows including all step types
4. Performance testing to verify timeout enforcement
5. Error handling validation

### Specific Test Cases
- Verify timeout hierarchy (step, flow, global) works correctly
- Test timeout propagation through nested structures
- Validate timeout errors contain correct metadata
- Ensure retry policies work correctly with timeout errors
- Test timeout monitoring and metrics collection
- Verify timeout handling in all step executors

## Final Documentation and Examples

Once integration is complete, update the following documentation:

1. README.md with final timeout documentation
2. API documentation for all timeout-related interfaces and classes
3. Create example flows demonstrating:
   - Basic timeout configuration
   - Timeout hierarchies
   - Timeout monitoring and metrics
   - Timeout error handling with retries
   - Complex nested timeouts

## Example Integration Test

```typescript
/**
 * End-to-end integration test for timeout functionality
 */
describe('Timeout Feature Integration', () => {
  it('should correctly apply timeout hierarchy in complex flows', async () => {
    // Create a complex flow with various timeout configurations
    const flow = new Flow()
      .id('complex-timeout-test')
      .setTimeout(5000) // 5 second global timeout
      .setTimeouts({
        [StepType.Request]: 2000,    // 2 seconds for requests
        [StepType.Transform]: 1000,   // 1 second for transformations
      })
      .addStep(
        new Step()
          .name('sequence')
          .type(StepType.Sequence)
          .steps([
            // Fast request step
            new Step()
              .name('fastRequest')
              .type(StepType.Request)
              .request({ method: 'test', params: [] }),
              
            // Transform step with custom timeout
            new Step()
              .name('transformWithTimeout')
              .type(StepType.Transform)
              .expression('context.flowResults.sequence.result[0]')
              .timeout(3000), // Override flow-level timeout
              
            // Nested branch step
            new Step()
              .name('conditionalBranch')
              .type(StepType.Branch)
              .condition('true')
              .then(
                new Step()
                  .name('nestedLoop')
                  .type(StepType.Loop)
                  .over('[1, 2, 3]')
                  .as('item')
                  .do(
                    new Step()
                      .name('loopRequest')
                      .type(StepType.Request)
                      .request({ 
                        method: 'echo', 
                        params: ['${context.item}'] 
                      })
                      .timeout(500) // Very short timeout for loop items
                  )
              )
          ])
      );
      
    // Mock handler for testing
    const mockHandler = jest.fn().mockImplementation(async (request, options) => {
      // Simulate varying response times based on method
      if (request.method === 'echo' && request.params[0] === 3) {
        // Third loop iteration is slow (should timeout)
        await new Promise(resolve => setTimeout(resolve, 1000));
      } else {
        // Other requests are fast
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      // Return success for fast requests
      return { 
        jsonrpc: '2.0', 
        id: request.id, 
        result: request.params[0] || 'success' 
      };
    });
    
    // Create executor with monitoring
    const nearTimeoutEvents: any[] = [];
    const executor = new FlowExecutor({
      transport: {
        type: 'custom',
        handler: mockHandler,
      },
      timeoutMonitorOptions: {
        nearTimeoutThreshold: 50,
        onNearTimeout: (event) => {
          nearTimeoutEvents.push(event);
        },
      },
      logging: true,
    });
    
    // Execute flow, should fail with timeout in loop
    try {
      await executor.execute(flow);
      fail('Should have thrown TimeoutError');
    } catch (error) {
      // Verify error details
      expect(error).toBeInstanceOf(TimeoutError);
      expect(error.stepName).toBe('loopRequest');
      expect(error.timeout).toBe(500);
      
      // Verify we got the right iteration
      const metadata = error.metadata as TimeoutErrorMetadata;
      expect(metadata.currentIteration).toBe(2); // Third iteration (index 2)
    }
    
    // Verify near-timeout events were captured
    expect(nearTimeoutEvents.length).toBeGreaterThan(0);
    
    // Fix the timeout and retry
    flow.setStepTimeout('loopRequest', 2000);
    
    // Should succeed now
    const result = await executor.execute(flow);
    expect(result).toBeDefined();
    
    // Check metrics
    const metrics = result.metadata.timeoutMetrics;
    expect(metrics.executionTimes[StepType.Request].length).toBeGreaterThan(0);
  });
});
```

## Dependencies
All previous timeout-related tickets must be completed:
- TKT-TIMEOUT-001 through TKT-TIMEOUT-019

## Estimation
5 story points (10-15 hours) 