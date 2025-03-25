# Ticket 1: Add Graph Cache to DependencyResolver

## Description

Implement caching mechanism in the `DependencyResolver` class to store and reuse the dependency graph, avoiding redundant rebuilding.

## Tasks

1. Add private fields to `DependencyResolver`:

   ```typescript
   private dependencyGraph: Map<string, Set<string>> | null = null;
   private isGraphBuilt: boolean = false;
   ```

2. Add private method to manage graph building:

   ```typescript
   private buildGraphIfNeeded(): void {
     if (!this.isGraphBuilt) {
       this.dependencyGraph = this.buildDependencyGraph();
       this.isGraphBuilt = true;
     }
   }
   ```

3. Update constructor to initialize cache-related fields:
   ```typescript
   constructor(flow: Flow, expressionEvaluator: ExpressionEvaluator, logger: Logger) {
     this.flow = flow;
     this.expressionEvaluator = expressionEvaluator;
     this.logger = logger;
     this.dependencyGraph = null;
     this.isGraphBuilt = false;
   }
   ```

## Test Cases

1. Verify cache initialization:

   ```typescript
   it('initializes cache fields correctly', () => {
     const resolver = new DependencyResolver(flow, expressionEvaluator, logger);
     expect(resolver['dependencyGraph']).toBeNull();
     expect(resolver['isGraphBuilt']).toBeFalse();
   });
   ```

2. Verify buildGraphIfNeeded behavior:
   ```typescript
   it('builds graph only when needed', () => {
     const resolver = new DependencyResolver(flow, expressionEvaluator, logger);
     const spy = jest.spyOn(resolver as any, 'buildDependencyGraph');

     resolver['buildGraphIfNeeded']();
     expect(spy).toHaveBeenCalledTimes(1);

     resolver['buildGraphIfNeeded']();
     expect(spy).toHaveBeenCalledTimes(1); // Should not rebuild
   });
   ```

## Dependencies

None

## Acceptance Criteria

1. Cache fields are properly initialized in constructor
2. `buildGraphIfNeeded()` builds graph only when not already built
3. All tests pass
4. No regressions in existing functionality
5. Code is properly documented

## Implementation Notes

1. Keep existing `buildDependencyGraph()` method unchanged
2. Use TypeScript's private field notation for cache fields
3. Add JSDoc comments for new methods
4. Consider adding debug logging for cache operations

## Estimated Effort

- Implementation: 2 hours
- Testing: 1 hour
- Documentation: 30 minutes
- Code review: 30 minutes

## Related Files

- `src/dependency-resolver/resolver.ts`
- `src/__tests__/dependency-resolver.test.ts`
