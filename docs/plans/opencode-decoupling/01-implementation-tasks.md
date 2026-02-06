# Opencode Decoupling Plan: Implementation Tasks

## Completion Notes (2026-02-06)

- Phase 1 has been started and core runtime wiring is in place.
- Task A is complete.
- Task B is complete for `loop`/executor and `submit` command construction.
- Remaining phases (paths/setup/worktree, doctor/install/shortcuts, model handling pass, docs cleanup) are still pending.

## Current Overall Progress

| Phase | Status | Notes |
| --- | --- | --- |
| Phase 1 - Core Runtime Wiring | Complete | Task A and Task B complete; runtime config + adapter integrated in loop/executor/submit |
| Phase 2 - Runtime-Aware Paths and Environment | Pending | Tasks C-D not started |
| Phase 3 - Operational UX and Workflow | In Progress | Core command abstraction done; Tasks E-H pending |

## Phase 1 - Core Runtime Wiring

### Task A: Add Runtime to Config
**Goal**: Introduce runtime selection with safe default behavior.

**Changes**
- Add `agent_runtime` (or `runtime`) config field with values:
  - `claude` (default)
  - `opencode`
- Add serde + default support
- Add env override (e.g. `MOBIUS_RUNTIME`)
- Surface in `mobius config` output

**Files**
- `rust/mobius/src/types/config.rs`
- `rust/mobius/src/config/loader.rs`
- `mobius.config.yaml`
- `rust/mobius/src/commands/config.rs`

**Acceptance Criteria**
- Old config files parse with no changes
- New config field is optional and defaults to `claude`
- Runtime can be set via config and env override
- `mobius config` displays active runtime

**Completion Notes**
- Added `runtime` to `LoopConfig` with default `claude`.
- Added `AgentRuntime` enum (`claude`, `opencode`) with serde/display/parse support.
- Added environment override via `MOBIUS_RUNTIME`.
- Updated `mobius config` to show active runtime and env override.
- Updated `mobius.config.yaml` with runtime field and comments.

---

### Task B: Create Runtime Command Adapter
**Goal**: Remove hardcoded runtime invocation from execution flow.

**Changes**
- Add runtime adapter module for command construction
- Move runtime-specific flags/formatting into adapter
- Replace direct `claude -p ...` assembly in:
  - parallel executor
  - submit command

**Files**
- `rust/mobius/src/executor.rs`
- `rust/mobius/src/commands/submit.rs`
- (new) `rust/mobius/src/runtime_adapter.rs` (or similar)

**Acceptance Criteria**
- Executor command generation works in both runtime modes
- Submit command generation works in both runtime modes
- Claude mode behavior remains unchanged by default
- Unit tests cover command output for both runtimes

**Completion Notes**
- Added runtime adapter module at `rust/mobius/src/runtime_adapter.rs`.
- Moved runtime-specific command construction into adapter for:
  - parallel executor command generation
  - submit command generation
- Updated loop execution paths to pass selected runtime into executor.
- Added unit tests for runtime adapter command output for `claude` and `opencode`.

---

## Phase 2 - Runtime-Aware Paths and Environment

### Task C: Runtime-Aware Setup and Path Resolution
**Goal**: Eliminate hardcoded `.claude` assumptions for installation/setup paths.

**Changes**
- Resolve skills/commands/settings paths by runtime
- Setup wizard includes runtime choice or respects config
- `--update-skills` applies to active runtime path set

**Files**
- `rust/mobius/src/config/paths.rs`
- `rust/mobius/src/config/setup.rs`
- `rust/mobius/src/commands/setup.rs`

**Acceptance Criteria**
- Local/global setup writes to runtime-appropriate locations
- Existing Claude users keep current path behavior
- Opencode users get valid runtime-specific install paths

---

### Task D: Worktree Runtime Symlink Decoupling
**Goal**: Avoid fixed symlink of `.claude` in worktrees.

**Changes**
- Replace hardcoded symlink dir list with runtime-aware mapping
- Ensure runtime config dir exists in worktree for active runtime

**Files**
- `rust/mobius/src/worktree.rs`

**Acceptance Criteria**
- Claude runtime symlinks current dir as before
- Opencode runtime symlinks runtime-specific dir
- Worktree creation and resume behavior remain stable

---

## Phase 3 - Operational UX and Workflow

### Task E: Doctor and Installer Runtime Checks
**Goal**: Stop requiring Claude CLI when runtime is opencode.

**Changes**
- Doctor checks active runtime CLI presence
- Doctor labels check by runtime name
- Installer messaging warns conditionally by selected/default runtime

**Files**
- `rust/mobius/src/commands/doctor.rs`
- `install.sh`

**Acceptance Criteria**
- No false-required Claude failures in opencode mode
- Clear install hints for selected runtime
- Existing checks for git/tmux/docker unaffected

---

### Task F: Runtime-Aware Shortcuts
**Goal**: Replace hardcoded `claude` calls in shell shortcuts.

**Changes**
- `md` / `mr` invoke runtime-selected CLI
- Keep shortcut behavior same for end users otherwise

**Files**
- `scripts/shortcuts.sh`
- `rust/mobius/src/commands/shortcuts.rs`

**Acceptance Criteria**
- Shortcuts work in claude mode and opencode mode
- No regressions for `me/ms/ml/mc` behavior

---

### Task G: Model Handling for Opencode Quick Path
**Goal**: Avoid blocking opencode model strings.

**Changes**
- Preserve existing enum behavior for Claude mode
- Allow model passthrough/flexible model handling in opencode mode
- Ensure CLI args reflect runtime model format requirements

**Files**
- `rust/mobius/src/types/enums.rs` (if needed)
- `rust/mobius/src/commands/loop_cmd.rs`
- `rust/mobius/src/commands/run.rs`
- `rust/mobius/src/commands/submit.rs`

**Acceptance Criteria**
- Claude mode accepts existing models unchanged
- Opencode mode can use runtime-compatible model identifiers
- No panics/errors on non-Claude model strings in opencode mode

---

### Task H: Docs and Messaging Cleanup
**Goal**: Clarify runtime support without overpromising.

**Changes**
- Replace Claude-only claims where now runtime-aware
- Add opencode setup/usage path in docs
- Keep caveats clear (quick-path scope)

**Files**
- `README.md`
- `templates/AGENTS.md`
- setup/doctor command text where relevant

**Acceptance Criteria**
- Docs mention both runtime options
- Quick-start remains clear and accurate
- Troubleshooting includes runtime-specific guidance
