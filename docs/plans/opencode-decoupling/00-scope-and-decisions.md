# Opencode Decoupling Plan: Scope and Decisions

## Completion Notes (2026-02-06)

- Initial implementation is underway and follows the documented decisions:
  - default remains `claude`
  - `opencode` support is opt-in
  - command construction is isolated behind a minimal runtime adapter
- Status protocol parsing remains unchanged (`STATUS:` / `EXECUTION_COMPLETE:`).

## Objective
Enable Mobius to run with `opencode` (not only Claude Code) via a fast, low-risk, backward-compatible implementation.

## Why This Plan
Mobius currently has hard runtime coupling to:
- CLI command invocation (`claude -p ...`)
- model assumptions (`opus|sonnet|haiku`)
- path assumptions (`.claude/...`)
- setup/doctor/install UX copy and checks

This plan introduces a minimal runtime abstraction to support `opencode` quickly without destabilizing current users.

## In Scope
- Add runtime selector to config (`claude` default, `opencode` optional)
- Route execution/submit command construction through runtime adapter
- Make setup/path/worktree behavior runtime-aware
- Make doctor/install/shortcuts runtime-aware
- Update docs and CLI copy to runtime-neutral language where applicable

## Out of Scope (This Pass)
- Full provider/plugin architecture
- Full skill schema redesign for all runtimes
- Rewriting all existing skills for complete runtime neutrality
- New backend integrations beyond existing Linear/Jira/Local

## Key Decisions
1. **Backward compatibility first**
   - Default runtime remains `claude`
   - Existing configs continue to work unchanged
2. **Opencode is opt-in**
   - User must explicitly set runtime to `opencode`
3. **Minimal abstraction**
   - Single runtime command adapter layer (not a large plugin system)
4. **Status protocol unchanged**
   - Keep `STATUS: ...` and `EXECUTION_COMPLETE: ...` parsing as-is
5. **Incremental hardening**
   - First enable `opencode` path, then iterate toward broader decoupling

## Risks and Mitigations
- **Risk**: Runtime command mismatch / flags differ
  - **Mitigation**: isolate command construction in adapter + unit tests
- **Risk**: Path assumptions break setup/worktrees
  - **Mitigation**: runtime-based path resolution and symlink tests
- **Risk**: Model parsing blocks opencode models
  - **Mitigation**: allow runtime-specific model passthrough in opencode mode
- **Risk**: User confusion on runtime selection
  - **Mitigation**: clear setup prompts + docs + doctor output

## Non-Goals for Acceptance
This phase is successful even if:
- Skills remain Claude-authored in style/content
- Some advanced opencode-specific features are not implemented
- There is no generic support for "any runtime" yet
