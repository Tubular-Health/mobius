---
name: execute
description: Execute a single sub-task with context priming. Supports both Linear and Jira backends via progressive disclosure. Use when ready to implement a refined issue, when the user mentions "execute", "implement", or "work on" an issue.
invocation: /execute
---

<objective>
Execute EXACTLY ONE sub-task from a refined issue, then STOP. This skill is designed to run in a loop where each invocation completes one sub-task.

Key behavior:
- Find ONE ready sub-task (no unresolved blockers)
- Implement it completely
- Verify with tests/typecheck/lint
- Commit and push
- Update issue status
- Report completion and STOP IMMEDIATELY

**CRITICAL**: After completing one sub-task (or determining none are ready), you MUST stop and end your response. Do NOT continue to the next sub-task. The calling loop will invoke you again for the next sub-task.
</objective>

<one_subtask_rule>
**THIS SKILL EXECUTES EXACTLY ONE SUB-TASK PER INVOCATION**

The workflow for each invocation:
1. Find the next ready sub-task
2. If none ready -> output STATUS and STOP
3. If found -> implement, verify, commit, push
4. Update issue status
5. Output completion STATUS and STOP

**NEVER**:
- Process multiple sub-tasks in one invocation
- Ask "should I continue to the next task?"
- Loop through remaining sub-tasks
- Suggest running the skill again

The loop script handles iteration. This skill handles ONE task.
</one_subtask_rule>

<context_input>
**The mobius loop provides issue context via environment variable and local files.**

Context sources:
1. `MOBIUS_CONTEXT_FILE` environment variable - path to the context JSON file
2. Local files at `.mobius/issues/{parentId}/`

**Context file structure**: JSON with `parent` (id, identifier, title, description, gitBranchName, status, labels, url), `subTasks[]` (id, identifier, title, description, status, gitBranchName, blockedBy[], blocks[]), and `metadata` (fetchedAt, updatedAt, backend).

**Sub-task status values**: `pending`, `in_progress`, `done`

**Backend detection**: `metadata.backend` field indicates Linear or Jira. Treat context data uniformly.
</context_input>

<structured_output>
**This skill MUST output structured YAML at the END of your response.**

```yaml
---
status: SUBTASK_COMPLETE  # Required: one of the valid status values
timestamp: "2026-01-28T12:00:00Z"  # Required: ISO-8601
subtaskId: "MOB-177"  # Required for subtask statuses
parentId: "MOB-161"  # Required for parent-level statuses

# SUBTASK_COMPLETE fields:
commitHash: "abc1234"
filesModified: ["src/lib/feature.ts"]
verificationResults:
  typecheck: PASS
  tests: PASS
  lint: PASS
  subtaskVerify: PASS  # or N/A

# SUBTASK_PARTIAL fields:
progressMade: ["Implemented core function"]
remainingWork: ["Add unit tests"]

# ALL_BLOCKED fields:
blockedCount: 3
waitingOn: ["MOB-176"]

# VERIFICATION_FAILED fields:
errorType: "tests"  # typecheck | tests | lint | subtask_verify
errorOutput: "Test failed: expected 2 but got 3"
attemptedFixes: ["Updated expected value"]
uncommittedFiles: ["src/lib/feature.ts"]
---
```

**Requirements**: Valid YAML, appears at END of response, includes `status` and `timestamp`, includes all required fields for the specific status type.
</structured_output>

<quick_start>
<invocation>
```
/execute PROJ-123    # Parent issue - finds next ready subtask
/execute PROJ-124    # Subtask - executes this specific task
```

In parallel mode, each agent receives a specific subtask ID to prevent race conditions.
</invocation>

<workflow>
1. **Detect backend** - Read backend from config (linear or jira)
2. **Detect issue type** - Check if passed ID is a subtask or parent issue
3. **Load parent issue** - Get high-level context and acceptance criteria
4. **Find ready sub-task** - If parent was passed, find first ready subtask
5. **Mark In Progress** - Move sub-task to "In Progress" immediately
6. **Prime context** - Load completed dependent tasks for implementation context
7. **Implement changes** - Execute the single-file-focused work
8. **Verify standard** - Run tests, typecheck, and lint
9. **Fix if needed** - Attempt automatic fixes on verification failures
10. **Verify sub-task** - Execute `### Verify` command from sub-task if present (with safety checks)
11. **Commit and push** - Create commit with conventional message, push
12. **Update local context** - Update `.mobius/issues/{parentId}/` files with new status
13. **Write iteration data** - Append to `.mobius/issues/{parentId}/execution/iterations.json`
14. **Update status** - Move sub-task to "Done" if all criteria met
15. **Report completion** - Show what was done and what's next
</workflow>
</quick_start>

<context_priming_phase>
<detect_issue_type>
Read from `MOBIUS_CONTEXT_FILE` environment variable.

1. **If context contains a specific subtask to execute** -> Use it directly, skip "find ready subtask"
2. **If context contains parent with multiple subtasks** -> Find ready subtask below

In parallel mode (`mobius loop PROJ-123 --parallel=3`), each agent receives a specific subtask ID. Execute exactly the task given.
</detect_issue_type>

<load_parent_issue>
Read parent from context file. Extract: **Goal** (what the feature/fix achieves), **Acceptance criteria**, **Context** (technical notes/constraints), **Related issues**.
</load_parent_issue>

<find_ready_subtask>
**Skip if executing a specific subtask.**

For each sub-task, check: status is not "done"/"canceled" AND all `blockedBy` issues have status "done". Select the FIRST ready sub-task.

**STOP CONDITIONS** (output structured status and end immediately):
- All sub-tasks Done -> `status: ALL_COMPLETE`
- All remaining blocked -> `status: ALL_BLOCKED`
- No sub-tasks exist -> `status: NO_SUBTASKS`
</find_ready_subtask>

<mark_in_progress>
**IMMEDIATELY** after selecting a sub-task, note it as "In Progress". The mobius loop handles the actual status update via SDK. This prevents parallel agents from picking the same task.
</mark_in_progress>

<load_dependency_context>
For each completed blocker, extract: what was implemented, files modified, patterns used, any notes. Compile into a context brief for implementation.
</load_dependency_context>

<context_brief_format>
```markdown
# Execution Context
## Parent Issue: {ID} - {Title}
{Description and acceptance criteria}
## Current Sub-task: {ID} - {Title}
**Target file**: {path} | **Change type**: {Create/Modify}
{Sub-task description and acceptance criteria}
## Completed Dependencies
### {Dep ID}: {Title}
- Modified: {files} | Summary: {what was done}
## Implementation Notes
- Follow patterns from: {relevant completed tasks}
- Key imports needed: {based on dependency analysis}
```
</context_brief_format>
</context_priming_phase>

<implementation_phase>
Before making changes, read the target file(s). For **Create**: check directory exists, understand sibling patterns. For **Modify**: read current content completely. Also read related type definitions, test files, and imports.

Execute implementation following:
1. **Match existing patterns** - Same style as similar files
2. **Single file focus** - Only modify target file(s) specified
3. **Meet acceptance criteria** - Each criterion addressed
4. **Add/update tests** - Update corresponding test if target is source file

**Stay within scope**: Only modify specified files. Don't refactor unrelated code or add features not in acceptance criteria. Note out-of-scope issues for later.
</implementation_phase>

<tdd_option>
**Use TDD when**: explicitly requested in sub-task, complex business logic, refactoring existing code, bug fixes with reproducible steps, or well-defined input/output contracts. **Skip** for config changes, UI wiring, documentation, or when explicitly told not to.

When TDD applies, follow **red-green-refactor**: write failing tests first (verify they fail for the right reason), implement minimal code to pass, then refactor for quality. Run tests after each phase. Commit all changes together for small sub-tasks.
</tdd_option>

<verification_phase>
<full_validation>
Run all three: `just typecheck`, `just test-file {pattern}` (or `just test`), `just lint` (or `bun run lint`).
</full_validation>

<handle_failures>
If verification fails, attempt automatic fix: read error, identify root cause, apply targeted fix, re-run. Repeat up to 3 times.

If still failing after 3 attempts: stop immediately, do NOT ask user questions, output `STATUS: VERIFICATION_FAILED` with error summary, last error output, attempted fixes, and uncommitted files list. Then STOP.
</handle_failures>

<subtask_verify_command>
After standard verification passes, check for `### Verify` section in sub-task description. Extract the bash code block.

**Safety check** - Block these patterns (do NOT execute): `rm -rf`/`rm -r` with wildcards or root paths, `sudo`, `chmod 777`, `curl|bash`/`wget|sh`, `dd if=`/`mkfs`. If blocked, proceed to commit without sub-task verification.

If safe, execute with 60-second timeout. On success, proceed to commit. On failure, attempt fix and retry up to 3 times. If still failing, output `STATUS: VERIFICATION_FAILED` and STOP.

If no `### Verify` section exists, proceed directly to commit (this is normal for older sub-tasks).
</subtask_verify_command>
</verification_phase>

<commit_phase>
Create conventional commit:

```
{type}({scope}): {description}

{body with details}

Implements: {sub-task-id}
Part-of: {parent-issue-id}
```

**Type mapping**: New file -> `feat`, Bug fix -> `fix`, Enhancement -> `feat`/`refactor`, Test only -> `test`, Types only -> `types`

**Git operations**: Stage only modified files (never `git add -A`), commit, push. Verify commit created and working directory is clean.
</commit_phase>

<status_update_phase>
<update_local_context>
**CRITICAL: Update local context files after successful commit.**

1. **Task file** `.mobius/issues/{parentId}/tasks/{subtaskId}.json`: Change `"status"` to `"done"`
2. **Context file** `.mobius/issues/{parentId}/context.json`: Update subtask status to `"done"` and `metadata.updatedAt` to current timestamp

For partial completion, use `"in_progress"` instead of `"done"`.
</update_local_context>

<iteration_tracking>
Append iteration entry to `.mobius/issues/{parentId}/execution/iterations.json` (create directory with `mkdir -p` if needed).

Entry fields: `subtaskId`, `startedAt`, `completedAt`, `commitHash` (or null), `duration` (ISO-8601), `status` ("complete"/"partial"/"failed"), `filesModified[]`, `verificationResults` (typecheck/tests/lint/subtaskVerify). For failed iterations, include `error` field.
</iteration_tracking>

<update_subtask_status_done>
Move to "Done" only when: all acceptance criteria implemented, all verification passes, changes committed and pushed, local context updated.
</update_subtask_status_done>

<partial_completion_handling>
If wrapping up incomplete, keep "In Progress" with progress comment detailing: progress made, remaining work, current state, blockers discovered, next steps. Do NOT move to "Done" if criteria are unmet, tests fail, or implementation is incomplete.
</partial_completion_handling>
</status_update_phase>

<completion_report>
After successful execution, output and STOP:

```markdown
# Sub-task Completed
STATUS: SUBTASK_COMPLETE
## {Sub-task ID}: {Title}
**Status**: Moved to Done | **Commit**: {hash} on {branch}
### Files Modified
- `{file}` - {change summary}
### Acceptance Criteria
- [x] Criterion 1
### Verification
- Typecheck: PASS | Tests: PASS | Lint: PASS | Sub-task verify: {PASS/N/A}
## Progress
**Completed**: {X of Y} | **Ready next**: {unblocked tasks} | **Blocked**: {count}
---
EXECUTION_COMPLETE: {sub-task-id}
```

**CRITICAL**: After this report, STOP IMMEDIATELY. Do not start next sub-task, ask to continue, or suggest next steps.

For partial completion, output `STATUS: SUBTASK_PARTIAL` with progress made, remaining work, current verification state, reason for stopping, and notes for next loop. This keeps the task "In Progress".
</completion_report>

<anti_patterns>
**Don't continue to next sub-task** (MOST IMPORTANT): Complete ONE sub-task, output STATUS, STOP.

**Don't skip verification**: Full validation (tests, typecheck, lint) before every commit.

**Don't expand scope**: Note out-of-scope issues, stay focused on the sub-task.

**Don't skip local context updates**: Update both task-specific JSON and main context.json after commit.

**Don't commit unrelated files**: Stage only files specified in sub-task, never `git add -A`.

**Don't ask user questions**: Make reasonable decisions or output failure STATUS and stop.
</anti_patterns>

<success_criteria>
- [ ] Parent context loaded and correct ready sub-task selected
- [ ] Implementation addresses all acceptance criteria
- [ ] All verification passes (typecheck, tests, lint, sub-task verify)
- [ ] Committed with conventional message and pushed
- [ ] Local context files updated (`.mobius/issues/` task and context.json)
- [ ] Status updated appropriately (Done or In Progress)
- [ ] Structured output with STATUS marker at end of response
- [ ] STOPPED after one sub-task (no continuation)
</success_criteria>

<termination_signals>
| Status | Meaning | Loop Action |
|--------|---------|-------------|
| `SUBTASK_COMPLETE` | Fully implemented, moved to Done | Continue loop |
| `SUBTASK_PARTIAL` | Partial progress, stays In Progress | Continue loop |
| `ALL_COMPLETE` | All sub-tasks done | Exit loop |
| `ALL_BLOCKED` | Remaining sub-tasks blocked | Exit loop |
| `NO_SUBTASKS` | No sub-tasks exist | Exit loop |
| `VERIFICATION_FAILED` | Tests/typecheck failed after retries | Exit loop |

Each invocation outputs exactly ONE status and then terminates.
</termination_signals>
