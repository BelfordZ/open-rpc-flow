# Repository Guidelines

This project uses TypeScript and Node.js. Follow these rules when contributing:

## Development Setup

- Use Node.js **22.15.0** as specified in `.node-version` (the CI also tests Node 18+).
- Install dependencies with `npm install`.

## Formatting and Linting

- Format code using Prettier: `npm run format`.
- Lint the project with ESLint: `npm run lint`.
- Fix any lint errors before committing.

## Building and Testing

- Build TypeScript with `npm run build`.
- Run the full test suite with `npm test`.
- Ensure these commands succeed before committing code.
- Ensure any newly added code is covered by tests with **100% line coverage**.

## Commit Messages

- Use **conventional commit** messages (e.g. `feat:`, `fix:`, `chore:`, `docs:`).
- Keep body lines under 100 characters.

## Pull Requests

- Summarize your changes and mention test results in the PR description.
- Do not commit `node_modules` or generated `dist` files.
