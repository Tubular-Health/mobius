# AGENTS.md

Operational guide for autonomous Mobius execution. This file is loaded each iteration to provide project-specific context to Claude.

**Copy this template to your project root and customize for your codebase.**

## Build & Validation

Run these commands after implementing changes to get immediate feedback:

- **Tests:** `npm test` or `pytest` or `go test ./...`
- **Single test:** `npm test -- path/to/test.spec.ts`
- **Typecheck:** `npm run typecheck` or `mypy .`
- **Lint:** `npm run lint` or `ruff check .`
- **Build:** `npm run build` or `go build ./...`

## Operational Notes

Guidelines for autonomous execution:

- Always run validation commands after making changes
- Commit frequently with descriptive messages
- If tests fail, fix them before moving to the next sub-task
- When blocked, add a comment to the issue explaining the blocker
- Prefer small, focused changes over large refactors
- **After completing a sub-task:** Mark it as "Done" once the commit is pushed and expected work is complete

## Codebase Patterns

Document your project's conventions here:

- **Components:** `src/components/` - React components, PascalCase naming
- **Services:** `src/services/` - Business logic, singleton pattern
- **API:** `src/api/` - REST endpoints, OpenAPI documented
- **Tests:** `__tests__/` directories, `.spec.ts` suffix
- **Types:** `src/types/` - Shared TypeScript interfaces

## Common Issues

Known gotchas and their solutions:

- **Mock setup:** Always reset mocks in `beforeEach`
- **Async tests:** Use `await` with all async operations
- **Import paths:** Use absolute imports from `@/`
- **Environment:** Test env vars are in `.env.test`

## Project Structure

```
your-project/
├── src/
│   ├── components/     # UI components
│   ├── services/       # Business logic
│   ├── api/            # API routes
│   ├── types/          # TypeScript types
│   └── utils/          # Shared utilities
├── tests/
│   ├── unit/           # Unit tests
│   └── integration/    # Integration tests
├── docs/               # Documentation
└── scripts/            # Build/deploy scripts
```

## Mobius-Specific Instructions

Add any special instructions for the autonomous Mobius loop:

- Priority order for sub-tasks (if not using blockedBy)
- Files that should never be modified
- Required reviewers for certain changes
- Branch naming conventions
