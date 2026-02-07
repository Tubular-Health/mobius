# Opencode Decoupling Plan: Skill Compatibility Test Matrix

## Completion Notes (2026-02-06)

- Runtime command adapter unit tests are passing for both `claude` and `opencode` command generation paths.
- Matrix items below are still the release-gate targets; end-to-end skill flow validation is not yet complete.

## Test Objective
Verify that skills behave equivalently across `claude` and `opencode` runtimes for key Mobius workflows.

## Runtime Matrix
- Runtime A: `claude` (baseline/regression)
- Runtime B: `opencode` (new support)

---

## A. Setup + Discovery

### A1. Setup installs skills and commands
- [ ] Runtime A: `mobius setup` installs expected skill paths
- [ ] Runtime B: `mobius setup` installs expected skill paths

Expected:
- `mobius doctor` reports skills found for selected runtime

### A2. Update skills command
- [ ] Runtime A: `mobius setup --update-skills` updates runtime A paths only
- [ ] Runtime B: `mobius setup --update-skills` updates runtime B paths only

---

## B. Skill Entry Points

### B1. `/define` entry
- [ ] Shortcut path works (`md`) for runtime A
- [ ] Shortcut path works (`md`) for runtime B
- [ ] Direct invocation works in runtime adapter path for both

Expected:
- issue definition flow starts and completes without runtime mismatch

### B2. `/refine` entry
- [ ] Shortcut path works (`mr`) for runtime A
- [ ] Shortcut path works (`mr`) for runtime B
- [ ] Produces local task files in `.mobius/issues/<id>/tasks/`

Expected:
- generated tasks include expected schema and dependency fields

---

## C. Loop Skill Routing

### C1. `/execute` routing
- [ ] Runtime A: loop invokes execute skill correctly
- [ ] Runtime B: loop invokes execute skill correctly

Expected:
- parseable status output emitted and consumed by Mobius

### C2. `/verify` routing for Verification Gate
- [ ] Runtime A: VG routes to `/verify`
- [ ] Runtime B: VG routes to `/verify`

Expected:
- PASS/NEEDS_WORK statuses processed correctly

---

## D. Hook/State Capture

### D1. Todo/status capture
- [ ] Runtime A: todo/status capture unchanged
- [ ] Runtime B: todo/status capture works or degrades gracefully

Expected:
- no loop crash when runtime-specific hooks differ

### D2. State file updates
- [ ] active/completed/failed states update as expected in both runtimes

---

## E. Regression + Failure Modes

### E1. Backward compatibility
- [ ] No runtime config specified => Claude behavior unchanged
- [ ] Existing workflows unaffected for current users

### E2. Missing runtime CLI behavior
- [ ] Runtime B selected but CLI missing => clear doctor/setup error message
- [ ] Runtime A selected but CLI missing => current behavior preserved

### E3. Parsing resilience
- [ ] Non-standard runtime output does not hard-crash loop
- [ ] Unknown status handled with safe fallback path

---

## Release Gate Criteria
All must pass:
- [ ] `/define` and `/refine` usable in opencode mode
- [ ] `/execute` and `/verify` routing in loop works in opencode mode
- [ ] setup/doctor are runtime-aware and accurate
- [ ] Claude baseline regression checks all green
