# Opencode Decoupling Plan: Skill Compatibility

## Completion Notes (2026-02-06)

- SC-2 has started: runtime adapter now routes core execution command generation for loop executor and submit flows.
- Runtime config selection (`claude` default, `opencode` optional) and `MOBIUS_RUNTIME` override are implemented.
- Remaining compatibility work in this document (runtime-aware install paths, hook behavior, packaging, skill doc portability) is still pending.

## Objective
Ensure Mobius skills (`/define`, `/refine`, `/execute`, `/verify`) run correctly when runtime is `opencode`, not only Claude Code.

## Scope
This document focuses on **skill execution compatibility**, not broader backend behavior.

In scope:
- runtime-aware skill discovery and invocation
- runtime-aware skills/commands install paths
- runtime-aware hooks for todo/status capture
- compatibility updates to skill documents where wording/assumptions are Claude-only
- release packaging for runtime-specific skill bundles

Out of scope:
- full universal skill schema redesign
- adding support for every runtime provider in this phase

---

## Current Coupling Inventory (to resolve)

- Skill command execution hardcoded to Claude CLI:
  - `rust/mobius/src/executor.rs`
  - `scripts/mobius.sh`
  - `scripts/shortcuts.sh`
- Skill storage/install assumes `.claude`:
  - `rust/mobius/src/config/paths.rs`
  - `rust/mobius/src/commands/setup.rs`
  - `rust/mobius/src/config/setup.rs`
- Hook behavior assumes Claude settings/hook model:
  - `.claude/settings.json`
  - `scripts/capture-agent-todos.sh`
- Skill docs include Claude-specific assumptions:
  - `.claude/skills/define/SKILL.md`
  - `.claude/skills/refine/SKILL.md`
  - `.claude/skills/execute/SKILL.md`
  - `.claude/skills/verify/SKILL.md`

---

## Phase Plan

## Phase 1: Runtime Skill Registry
### Task SC-1 - Add runtime skill registry abstraction
Define a runtime-aware mapping for:
- skill root dir
- command root dir
- settings/hook file locations
- invocation style for skill commands (`/define`, `/refine`, etc.)

Acceptance criteria:
- registry resolves valid paths for `claude` and `opencode`
- all call sites use registry instead of hardcoded `.claude`

---

## Phase 2: Runtime Invocation Compatibility
### Task SC-2 - Route skill invocations through runtime adapter
Ensure `/define`, `/refine`, `/execute`, `/verify` dispatch through runtime-specific command builder.

Acceptance criteria:
- `mobius loop`, `mobius run`, `mobius submit`, and shortcuts use runtime adapter
- no direct `claude` binary calls in these paths when runtime is `opencode`
- Claude default path remains unchanged

---

## Phase 3: Setup/Install/Packaging
### Task SC-3 - Runtime-aware setup/install for skills
Update setup flows to install skills/commands in runtime-specific locations.

Acceptance criteria:
- `mobius setup` installs skills for selected runtime
- `--update-skills` updates selected runtime only
- `mobius doctor` validates selected runtime skill installation

### Task SC-4 - Release artifact packaging for opencode skills
Include runtime-compatible skill bundle in release pipeline.

Acceptance criteria:
- release artifacts include required skill files for opencode flow
- packaging remains backward-compatible for Claude users

---

## Phase 4: Hook Compatibility
### Task SC-5 - Runtime-aware task/todo hook integration
Decouple status/todo capture from Claude-only hook format.

Acceptance criteria:
- in opencode mode, equivalent status/todo data is captured OR graceful fallback is used
- loop/status parsing remains stable
- no hard failure if runtime-specific hooks are absent

---

## Phase 5: Skill Content Portability
### Task SC-6 - Skill document portability pass
Audit and update SKILL.md text where it hard-requires Claude-specific behavior unless truly required.

Acceptance criteria:
- `/define` and `/refine` instructions are runtime-neutral where possible
- runtime-specific caveats are explicit and isolated
- `/execute` and `/verify` still produce parseable outputs expected by Mobius

---

## Minimal Done Criteria for Skill Compatibility
- `/define` works in opencode mode from shortcut + direct runtime invocation
- `/refine` works in opencode mode and writes local task files correctly
- `/execute` and `/verify` routes function from loop in opencode mode
- setup/doctor accurately reflect selected runtime
- no regressions in Claude default flow
