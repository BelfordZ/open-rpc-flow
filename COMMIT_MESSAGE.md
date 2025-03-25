refactor(errors): remove duplicated error classes from index.ts

Fixed the duplication of error classes between src/errors/index.ts and src/errors/base.ts by:
- Removing the duplicate implementations from index.ts
- Keeping only the re-export statements in index.ts
- Adding clarifying comments about where the actual error class definitions live

This change eliminates confusion and potential bugs from having duplicate implementations
while preserving the more robust implementation in base.ts that includes:
- Better prototype chain handling
- Proper stack trace capture
- More flexible error code handling
- Better type safety with ErrorCode enum 