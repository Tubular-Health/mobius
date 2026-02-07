# Opencode Decoupling Plan: Test and Rollout Checklist

## Completion Notes (2026-02-06)

- Core runtime config + runtime adapter implementation has landed.
- Unit tests were added and run for runtime parsing, config override, and runtime command adapter generation.
- Full integration validation and rollout steps are not complete yet.

## 1) Unit Test Checklist

### Runtime Config
- [x] Config deserializes with no runtime field (defaults to `claude`)
- [x] Config deserializes with `runtime: opencode`
- [x] Env override (`MOBIUS_RUNTIME`) is applied correctly
- [x] Config round-trip preserves runtime value

### Runtime Adapter
- [x] Executor command string test for `claude`
- [x] Executor command string test for `opencode`
- [x] Submit command string test for `claude`
- [x] Submit command string test for `opencode`
- [x] Context/disallowed-tools/model args handled correctly by runtime mode

### Paths/Setup
- [ ] Runtime-aware skills path resolves correctly (local/global)
- [ ] Runtime-aware commands path resolves correctly (local/global)
- [ ] Setup path logic preserves old Claude behavior

### Worktree
- [ ] Runtime-specific symlink dirs chosen correctly
- [ ] Existing worktree resume logic unaffected

---

## 2) Integration Validation Checklist

### Setup/Config
- [ ] `mobius setup` works in local mode with default runtime
- [ ] `mobius setup` works in global mode with default runtime
- [ ] `mobius config` shows runtime setting
- [ ] `mobius setup --update-skills` updates active runtime paths

### Execution Paths
- [ ] `mobius loop <TASK-ID>` builds and executes runtime command in claude mode
- [ ] `mobius loop <TASK-ID>` builds and executes runtime command in opencode mode
- [ ] `mobius submit <TASK-ID>` works in claude mode
- [ ] `mobius submit <TASK-ID>` works in opencode mode

### Ops Commands
- [ ] `mobius doctor` checks selected runtime CLI
- [ ] Installer output reflects runtime expectations
- [ ] Shell shortcuts invoke selected runtime for `/define` and `/refine`

---

## 3) Regression Checklist

- [ ] Default (no runtime configured) behaves exactly like current release
- [ ] Existing Claude model flags continue to work
- [ ] No breakage in status parsing (`STATUS:` / `EXECUTION_COMPLETE`)
- [ ] TUI/runtime state updates still function
- [ ] Parallel loop behavior remains stable with tmux

---

## 4) Rollout Plan

### Rollout Steps
1. Merge runtime adapter + config support behind default Claude behavior
2. Merge setup/path/worktree runtime-awareness
3. Merge doctor/install/shortcuts/docs updates
4. Run full validation (`just validate`)
5. Cut release notes with migration guidance

### Release Notes Content
- [ ] New runtime config field (`claude` default, `opencode` supported)
- [ ] How to switch runtime
- [ ] Backward compatibility guarantee
- [ ] Known limitations of opencode quick-path
- [ ] Troubleshooting section for runtime CLI installation

---

## 5) Definition of Done (Overall)

- [ ] Opencode runtime can be selected and used for loop/submit flows
- [ ] Claude users see no required migration and no behavior regressions
- [ ] Setup/doctor/install/shortcuts are runtime-aware
- [ ] Docs accurately describe current supported runtime behavior
- [ ] Tests cover runtime split in core command generation paths
