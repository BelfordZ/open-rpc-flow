# Ticket 2: Update getDependencyGraph Method

## Description

Update the `getDependencyGraph()` method to use the cached dependency graph instead of rebuilding it on every call.

## Current Implementation

```typescript
public getDependencyGraph(): DependencyGraph {
  const logger = this.logger.createNested('getDependencyGraph');
  const graph = this.buildDependencyGraph(logger);
  // ... rest of the implementation
}
```

## Tasks

1. Modify `getDependencyGraph()` to use cached graph:

   ```typescript
   public getDependencyGraph(): DependencyGraph {
     const logger = this.logger.createNested('getDependencyGraph');
     this.buildGraphIfNeeded();

     if (!this.dependencyGraph) {
       throw new Error('Dependency graph not initialized');
     }

     const nodes: DependencyNode[] = [];
     const edges: Array<{ from: string; to: string }> = [];

     // Create nodes using this.dependencyGraph instead of building new one
     for (const step of this.flow.steps) {
       const deps = this.dependencyGraph.get(step.name);
       // ... rest of the implementation using cached graph
     }

     return { nodes, edges };
   }
   ```

2. Update error handling to work with cached graph:

   - Add new error type for uninitialized graph
   - Update existing error handling to use cached graph
   - Add debug logging for cache hits/misses

3. Add performance logging:
   - Log when graph is built vs reused
   - Add timing information for graph operations

## Test Cases

1. Test cache usage:

   ```typescript
   it('uses cached graph on subsequent calls', () => {
     const resolver = new DependencyResolver(flow, expressionEvaluator, logger);
     const spy = jest.spyOn(resolver as any, 'buildDependencyGraph');

     resolver.getDependencyGraph(); // First call
     expect(spy).toHaveBeenCalledTimes(1);

     resolver.getDependencyGraph(); // Second call
     expect(spy).toHaveBeenCalledTimes(1); // Should not rebuild
   });
   ```

2. Test error handling:

   ```typescript
   it('throws error if graph is not initialized', () => {
     const resolver = new DependencyResolver(flow, expressionEvaluator, logger);
     resolver['dependencyGraph'] = null;
     resolver['isGraphBuilt'] = false;

     expect(() => resolver.getDependencyGraph()).toThrow('Dependency graph not initialized');
   });
   ```

3. Test graph correctness:
   ```typescript
   it('returns same graph on subsequent calls', () => {
     const resolver = new DependencyResolver(flow, expressionEvaluator, logger);
     const graph1 = resolver.getDependencyGraph();
     const graph2 = resolver.getDependencyGraph();

     expect(graph2).toEqual(graph1);
   });
   ```

## Dependencies

- Ticket 1: Add Graph Cache to DependencyResolver

## Acceptance Criteria

1. `getDependencyGraph()` uses cached graph when available
2. Graph is built only once across multiple calls
3. Error handling works correctly with cached graph
4. Performance logging is implemented
5. All tests pass
6. No regressions in existing functionality
7. Code is properly documented

## Implementation Notes

1. Keep graph structure unchanged for compatibility
2. Add debug logging for cache operations
3. Consider adding graph validation on cache hit
4. Update documentation to reflect caching behavior

## Estimated Effort

- Implementation: 3 hours
- Testing: 2 hours
- Documentation: 1 hour
- Code review: 1 hour

## Related Files

- `src/dependency-resolver/resolver.ts`
- `src/__tests__/dependency-resolver.test.ts`
- `src/dependency-resolver/errors.ts` (for new error type)
