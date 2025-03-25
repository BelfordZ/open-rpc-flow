# Bug: Dependency Resolver treats steps with empty dependencies as missing

## Description
The dependency resolver incorrectly treats steps with no dependencies as if they were missing from the dependency graph.

In the `getDependencyGraph()` method, there is a check:
```typescript
if (deps?.size === 0) {
  this.logger.error(`Step ${step.name} not found in dependency graph`);
  throw new StepNotFoundError(...);
}
```

This condition incorrectly treats steps with empty dependencies (i.e., steps that don't depend on any other steps) as missing from the graph, which is a logical error.

## Reproduction
Run the test: `src/__tests__/dependency-resolver.test.ts` and observe the error:
```
StepNotFoundError: Step getUser not found in dependency graph
```

This occurs because the `getUser` step has no dependencies (an empty set), but the code is treating an empty dependency set as if the step was not found.

## Fix
Change the condition to only throw if the step is truly missing (undefined):

```typescript
if (deps === undefined) {
  this.logger.error(`Step ${step.name} not found in dependency graph`);
  throw new StepNotFoundError(...);
}
```

## Impact
This bug would cause workflows with independent steps (steps that don't rely on any others) to fail erroneously, incorrectly reporting them as missing from the dependency graph.

## Status
✅ Fixed

## Related Files
- `src/dependency-resolver/resolver.ts` - Contains the bug in `getDependencyGraph()` method
- `src/__tests__/dependency-resolver.test.ts` - Test that exposes the bug 