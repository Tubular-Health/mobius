# AGENTS.md

Operational guide for autonomous Mobius development.

## Build & Validation

Run these commands after implementing changes:

- **Build:** `npm run build`
- **Typecheck:** `npm run typecheck`
- **Tests:** `bun test` or `bun test src/lib/task-graph.test.ts`
- **Run locally:** `bun src/bin/mobius.ts <command>`

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint and husky.

Format: `<type>(<scope>): <description>` or `MOB-<id>: <description>`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`

Examples:
- `feat(loop): add retry logic for failed tasks`
- `fix(worktree): handle spaces in branch names`
- `MOB-30: implement tree visualization command`

## Project Structure

```
mobius/
├── src/
│   ├── bin/              # CLI entry point (mobius.ts)
│   ├── commands/         # Command implementations (run, setup, doctor, loop, tree)
│   ├── lib/              # Core library code
│   │   ├── checks/       # Health check modules (claude, docker, tmux, etc.)
│   │   ├── config.ts     # Configuration loading/copying
│   │   ├── paths.ts      # Path resolution (local vs global install)
│   │   ├── task-graph.ts # Linear task tree parsing
│   │   ├── worktree.ts   # Git worktree management
│   │   └── parallel-executor.ts  # Parallel task execution
│   └── types.ts          # Shared TypeScript interfaces
├── .claude/
│   ├── skills/           # Claude Code skills (execute/refine/verify-linear-issue)
│   └── commands/         # Claude Code slash commands
├── scripts/              # Shell scripts (mobius.sh)
├── templates/            # User templates (AGENTS.md template)
└── dist/                 # Compiled output (git-ignored)
```

## Codebase Patterns

- **ES Modules:** All imports use `.js` extension (e.g., `import { foo } from './bar.js'`)
- **Async/Await:** Prefer async/await over raw promises
- **Chalk for output:** Use `chalk` for colored terminal output
- **Commander for CLI:** Commands defined via `commander` in `src/bin/mobius.ts`
- **Types in types.ts:** Shared interfaces live in `src/types.ts`
- **Test files:** Co-located with source as `*.test.ts`

## Key Files

- `src/bin/mobius.ts` - CLI entry point with all command definitions
- `src/commands/loop.ts` - Main loop execution logic
- `src/lib/task-graph.ts` - Parses Linear issues into execution DAG
- `src/lib/parallel-executor.ts` - Runs Claude agents in parallel worktrees
- `src/types.ts` - All shared TypeScript types
- `mobius.config.yaml` - Default configuration template

## Common Issues

- **Import extensions:** Always use `.js` extension for local imports, even for `.ts` files
- **Bun vs Node:** Project uses Bun for development/testing, but must be Node-compatible for npm publishing
- **Path resolution:** Use `getPackageRoot()` from `paths.ts` to reference package files

## Files Not to Modify

- `package-lock.json` - Auto-generated (we use bun.lock primarily)
- `dist/` - Compiled output
- `.release-please-manifest.json` - Managed by release-please
