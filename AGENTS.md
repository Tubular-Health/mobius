# AGENTS.md

Operational guide for autonomous Mobius development.

## Just Commands

This project uses [just](https://github.com/casey/just) as a command runner. Run `just` to see all available recipes.

**Build & Validation:**
- `just build` - Compile Rust binary (release mode)
- `just typecheck` - Type check with cargo check
- `just test` - Run all unit tests
- `just test-file <pattern>` - Run tests matching pattern
- `just lint` - Run clippy linter
- `just validate` - Full validation (typecheck + test + build)

**Development:**
- `just dev` - Build in debug mode
- `just run <command>` - Run mobius locally (development mode)

**Mobius Loop:**
- `just loop <TASK-ID>` - Execute sub-tasks of a Linear issue
- `just loop-local <TASK-ID>` - Run locally (bypass sandbox)
- `just config` - Show current mobius configuration

**Utilities:**
- `just clean` - Remove build artifacts

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

Format: `<type>(<scope>): <description>` or `MOB-<id>: <description>`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`

Examples:
- `feat(loop): add retry logic for failed tasks`
- `fix(worktree): handle spaces in branch names`
- `MOB-30: implement tree visualization command`

## Project Structure

```
mobius/
├── rust/
│   ├── Cargo.toml           # Workspace root
│   └── mobius/
│       ├── Cargo.toml        # Main binary package
│       └── src/
│           ├── main.rs        # CLI entry point
│           ├── context.rs     # Session and runtime state management
│           ├── executor.rs    # Parallel task execution with tmux
│           ├── local_state.rs # Local filesystem state management
│           ├── output_parser.rs # Skill output parsing (YAML/JSON)
│           ├── debug_logger.rs  # Thread-safe debug logging
│           ├── project_detector.rs # Project type detection
│           ├── status_sync.rs # Backend status synchronization
│           └── types/         # Type definitions
├── .claude/
│   ├── skills/               # Claude Code skills (execute/refine/verify)
│   └── commands/             # Claude Code slash commands
├── scripts/                  # Shell scripts (mobius.sh)
├── templates/                # User templates (AGENTS.md template)
└── install.sh               # Binary installation script
```

## Codebase Patterns

- **Rust workspace:** Cargo workspace at `rust/` with `mobius` binary package
- **Error handling:** Use `anyhow::Result` with `.context()` for descriptive errors
- **Singletons:** Use `std::sync::OnceLock<Mutex<T>>` pattern (not `lazy_static`)
- **Serialization:** `serde` with `serde_json` and `serde_yaml`
- **Test files:** Tests are co-located in `#[cfg(test)] mod tests` blocks within each module
- **Async runtime:** Tokio for async operations

## Key Files

- `rust/mobius/src/main.rs` - CLI entry point with all command definitions
- `rust/mobius/src/executor.rs` - Parallel task execution with tmux panes
- `rust/mobius/src/context.rs` - Session lifecycle and runtime state management
- `rust/mobius/src/local_state.rs` - Local filesystem state (`.mobius/issues/`)
- `rust/mobius/src/types/` - All shared Rust types
- `mobius.config.yaml` - Default configuration template

## Common Issues

- **Workspace paths:** Use `--manifest-path rust/Cargo.toml` or `-p mobius` with cargo commands
- **Test patterns:** Use `cargo test -p mobius --lib <module>::tests` to run module-specific tests
- **Path resolution:** Use `dirs` crate for home directory, `std::env` for runtime paths

## Files Not to Modify

- `.release-please-manifest.json` - Managed by release-please
