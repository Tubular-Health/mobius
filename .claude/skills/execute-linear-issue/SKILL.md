---
name: execute-linear-issue
description: Execute the next ready sub-task from a Linear issue. Primes context from parent issue and completed dependencies, implements the change, verifies with tests/typecheck/lint, commits, pushes, and updates Linear status. Use when ready to implement a refined Linear issue, when the user mentions "execute", "implement", or "work on" a Linear issue.
---

<objective>
Execute EXACTLY ONE sub-task from a refined Linear issue, then STOP. This skill is designed to run in a loop where each invocation completes one sub-task.

Key behavior:
- Find ONE ready sub-task (no unresolved blockers)
- Implement it completely
- Verify with tests/typecheck/lint
- Commit and push
- Update Linear status
- Report completion and STOP IMMEDIATELY

**CRITICAL**: After completing one sub-task (or determining none are ready), you MUST stop and end your response. Do NOT continue to the next sub-task. The calling loop will invoke you again for the next sub-task.
</objective>

<one_subtask_rule>
**THIS SKILL EXECUTES EXACTLY ONE SUB-TASK PER INVOCATION**

The workflow for each invocation:
1. Find the next ready sub-task
2. If none ready → output STATUS and STOP
3. If found → implement, verify, commit, push
4. Update Linear status
5. Output completion STATUS and STOP

**NEVER**:
- Process multiple sub-tasks in one invocation
- Ask "should I continue to the next task?"
- Loop through remaining sub-tasks
- Suggest running the skill again

The loop script handles iteration. This skill handles ONE task.
</one_subtask_rule>

<context>
This skill is the execution phase of the Linear workflow:

1. **define-linear-issue** - Creates well-defined issues with acceptance criteria
2. **refine-linear-issue** - Breaks issues into single-file-focused sub-tasks with dependencies
3. **execute-linear-issue** (this skill) - Implements ONE sub-task, then stops

**Loop-Based Execution Model**:
This skill is designed to be called repeatedly by a loop script (e.g., `linear-loop.sh`). Each invocation:
1. Finds the NEXT ready sub-task
2. Executes it completely
3. Reports completion
4. STOPS (does not continue to next sub-task)

The loop script will call this skill again for the next sub-task. This ensures:
- Fresh context for each sub-task
- Clear boundaries between tasks
- Predictable execution behavior
- Easy progress monitoring

Each sub-task is designed to:
- Target a single file (or source + test pair)
- Fit within one context window
- Have clear acceptance criteria
- Have explicit blocking relationships
</context>

<quick_start>
<invocation>
Pass the parent issue ID:

```
/execute-linear-issue VRZ-123
```

The skill will find the next ready sub-task automatically.
</invocation>

<workflow>
1. **Load parent issue** - Get high-level context and acceptance criteria
2. **Find ready sub-task** - Identify sub-task with no unresolved blockers
3. **Prime context** - Load completed dependent tasks for implementation context
4. **Implement changes** - Execute the single-file-focused work
5. **Verify** - Run tests, typecheck, and lint
6. **Fix if needed** - Attempt automatic fixes on verification failures
7. **Commit and push** - Create commit with conventional message, push
8. **Update Linear** - Move sub-task to "In Progress" (ready for review)
9. **Report completion** - Show what was done and what's next
</workflow>
</quick_start>

<context_priming_phase>
<load_parent_issue>
First, fetch the parent issue for high-level context:

```
mcp__plugin_linear_linear__get_issue
  id: "{parent-issue-id}"
  includeRelations: true
```

Extract and retain:
- **Goal**: What the overall feature/fix achieves
- **Acceptance criteria**: High-level success conditions
- **Context**: Any technical notes or constraints
- **Related issues**: For broader understanding
</load_parent_issue>

<find_ready_subtask>
List all sub-tasks of the parent:

```
mcp__plugin_linear_linear__list_issues
  parentId: "{parent-issue-id}"
  includeArchived: false
```

For each sub-task, check:
1. State is not "Done" or "Canceled"
2. All `blockedBy` issues are in "Done" state

Select the FIRST sub-task where all blockers are resolved.

**STOP CONDITIONS** (report and end immediately):

1. **All sub-tasks are Done**:
   ```
   STATUS: ALL_COMPLETE
   All N sub-tasks of {parent-id} are complete.
   Parent issue is ready for review.
   ```

2. **All remaining sub-tasks are blocked**:
   ```
   STATUS: ALL_BLOCKED
   N sub-tasks remain, but all are blocked.
   Waiting on: {list of blocking issues}
   ```

3. **No sub-tasks exist**:
   ```
   STATUS: NO_SUBTASKS
   Issue {parent-id} has no sub-tasks.
   Consider running /refine-linear-issue first.
   ```

If any stop condition is met, output the status message and STOP. Do not continue.
</find_ready_subtask>

<load_dependency_context>
For each completed blocker of the selected sub-task:

```
mcp__plugin_linear_linear__get_issue
  id: "{blocker-id}"
  includeRelations: false
```

Extract from each completed dependency:
- **What was implemented**: Summary of changes
- **Files modified**: To understand current state
- **Patterns used**: To maintain consistency
- **Any notes**: Implementation decisions or gotchas

Compile into a context brief for the current task.
</load_dependency_context>

<context_brief_format>
Build context brief for implementation:

```markdown
# Execution Context

## Parent Issue: {ID} - {Title}
{Parent description and acceptance criteria}

## Current Sub-task: {ID} - {Title}
**Target file**: {file path}
**Change type**: {Create/Modify}
{Sub-task description and acceptance criteria}

## Completed Dependencies
### {Dep-1 ID}: {Title}
- Modified: {files}
- Summary: {what was done}

### {Dep-2 ID}: {Title}
- Modified: {files}
- Summary: {what was done}

## Implementation Notes
- Follow patterns from: {relevant completed tasks}
- Key imports needed: {based on dependency analysis}
- Test file: {expected test location}
```
</context_brief_format>
</context_priming_phase>

<implementation_phase>
<read_target_file>
Before making changes, read the target file(s):

- If **Create**: Check directory exists, understand sibling file patterns
- If **Modify**: Read current file content completely

Also read:
- Related type definitions (from completed dependencies)
- Test file if it exists
- Any files imported by the target
</read_target_file>

<implement_changes>
Execute the implementation following:

1. **Match existing patterns** - Use same style as similar files
2. **Single file focus** - Only modify the target file(s) specified
3. **Meet acceptance criteria** - Each criterion should be addressed
4. **Add/update tests** - If target is source file, update corresponding test

Use Edit tool for modifications, Write tool for new files.

**Implementation checklist**:
- [ ] All acceptance criteria addressed
- [ ] Follows existing code patterns
- [ ] Proper imports added
- [ ] Types are correct
- [ ] Test coverage for new code
</implement_changes>

<scope_discipline>
**Stay within scope**:
- Only modify files specified in the sub-task
- Don't refactor unrelated code
- Don't add features not in acceptance criteria
- Don't fix unrelated issues discovered during work

If you discover issues outside scope:
- Note them for later
- Don't fix them now
- Can mention in completion report
</scope_discipline>
</implementation_phase>

<verification_phase>
<full_validation>
Run all three verification steps:

**1. Type checking**:
```bash
just typecheck
```

**2. Tests**:
```bash
just test-file {pattern matching target file}
```

Or if new functionality spans multiple test files:
```bash
just test
```

**3. Lint** (if available):
```bash
just lint
# or
bun run lint
```
</full_validation>

<handle_failures>
If any verification fails:

**Attempt automatic fix**:
1. Read the error output carefully
2. Identify the root cause
3. Apply targeted fix to resolve the issue
4. Re-run the failing verification
5. Repeat up to 3 times

**Common fixes**:
- Type errors: Add missing types, fix type mismatches
- Test failures: Update test expectations, fix logic errors
- Lint errors: Apply auto-fix if available, manual fix otherwise

**If fix attempts fail after 3 tries**:
- Stop execution immediately
- Do NOT ask user questions (this skill runs in an automated loop)
- Output failure status and terminate:

```markdown
STATUS: VERIFICATION_FAILED

## Sub-task Failed: {sub-task-id}

### Error Summary
{type of failure: typecheck/tests/lint}

### Last Error Output
```
{truncated error output, last 50 lines}
```

### Attempted Fixes
1. {fix attempt 1}
2. {fix attempt 2}
3. {fix attempt 3}

### Files Modified (uncommitted)
- {file1}
- {file2}

The loop will stop. Review the errors and either:
- Fix manually and run `/execute-linear-issue {parent-id}` again
- Or rollback with `git checkout -- .`
```

**CRITICAL**: After outputting this failure report, STOP. Do not continue trying.
</handle_failures>

<verification_success>
All checks must pass before proceeding:

```markdown
## Verification Results
- Typecheck: PASS
- Tests: PASS (X tests, Y assertions)
- Lint: PASS

Ready to commit.
```
</verification_success>
</verification_phase>

<commit_phase>
<commit_message>
Create conventional commit message:

Format:
```
{type}({scope}): {description}

{body with details}

Implements: {sub-task-id}
Part-of: {parent-issue-id}
```

**Type mapping**:
- New file created → `feat`
- Bug fix → `fix`
- Modification/enhancement → `feat` or `refactor`
- Test only → `test`
- Types only → `types`

**Example**:
```
feat(theme): add ThemeContext provider

- Create ThemeProvider with light/dark/system modes
- Persist theme preference to localStorage
- Add useTheme hook for consuming context

Implements: VRZ-125
Part-of: VRZ-100
```
</commit_message>

<git_operations>
Execute git operations:

```bash
# Stage only the files we modified
git add {target-file} {test-file-if-applicable}

# Commit with conventional message
git commit -m "{commit message}"

# Push to current branch
git push
```

**Important**:
- Only stage files explicitly modified for this sub-task
- Don't use `git add -A` or `git add .`
- Verify staged files match expected scope before commit
</git_operations>

<commit_verification>
After push, verify:

```bash
git log -1 --oneline
git status
```

Confirm:
- Commit created successfully
- Push completed without errors
- Working directory is clean
</commit_verification>
</commit_phase>

<linear_update_phase>
<update_subtask_status>
Move sub-task to "In Progress" (ready for review):

```
mcp__plugin_linear_linear__update_issue
  id: "{sub-task-id}"
  state: "In Progress"
```

**Note**: Using "In Progress" as the review state. Adjust if workspace has a dedicated review state.
</update_subtask_status>

<add_completion_comment>
Add comment documenting the implementation:

```
mcp__plugin_linear_linear__create_comment
  issueId: "{sub-task-id}"
  body: |
    ## Implementation Complete

    **Commit**: {commit-hash}
    **Files modified**:
    - {file1}
    - {file2}

    **Changes**:
    {brief summary of what was implemented}

    **Verification**:
    - Typecheck: PASS
    - Tests: PASS
    - Lint: PASS

    Ready for review.
```
</add_completion_comment>
</linear_update_phase>

<completion_report>
<report_format>
After successful execution, report and STOP:

```markdown
# Sub-task Completed

STATUS: SUBTASK_COMPLETE

## {Sub-task ID}: {Title}
**Status**: Moved to In Progress (ready for review)
**Commit**: {hash} on {branch}

### Files Modified
- `{file1}` - {change summary}
- `{file2}` - {change summary}

### Acceptance Criteria
- [x] Criterion 1
- [x] Criterion 2
- [x] Criterion 3

### Verification
- Typecheck: PASS
- Tests: PASS
- Lint: PASS

---

## Progress
**Completed**: {X of Y sub-tasks}
**Ready next**: {list of now-unblocked sub-tasks, or "none" if all blocked/done}
**Still blocked**: {count of sub-tasks still waiting}

---
EXECUTION_COMPLETE: {sub-task-id}
```

**CRITICAL**: After outputting this report, STOP IMMEDIATELY. Do not:
- Start working on the next sub-task
- Ask if the user wants to continue
- Suggest what to do next
- Make any further tool calls

The loop script will invoke this skill again for the next sub-task.
</report_format>

<discovered_issues>
If issues were discovered during implementation but not addressed:

```markdown
### Out-of-Scope Issues Discovered
- {Issue 1}: {brief description} in {file}
- {Issue 2}: {brief description} in {file}

Consider creating separate issues for these.
```
</discovered_issues>
</completion_report>

<examples>
<execution_example>
**Input**: `/execute-linear-issue VRZ-100`

**Flow**:

1. Load VRZ-100 (parent: "Add dark mode support")
2. Find sub-tasks:
   - VRZ-124: Define types (Done)
   - VRZ-125: Create ThemeProvider (blockedBy: VRZ-124 ✓) ← **Ready**
   - VRZ-126: Add useTheme hook (blockedBy: VRZ-125) - Blocked
   - VRZ-127: Update Header (blockedBy: VRZ-126) - Blocked

3. Select VRZ-125 (first ready task)

4. Load context from VRZ-124:
   - Created `src/types/theme.ts`
   - Exports: `Theme`, `ThemeMode`, `ThemeContextValue`

5. Implement VRZ-125:
   - Create `src/contexts/ThemeContext.tsx`
   - Import types from completed dependency
   - Follow existing context patterns in codebase

6. Verify:
   - `just typecheck` → PASS
   - `just test-file ThemeContext` → PASS
   - `just lint` → PASS

7. Commit and push:
   ```
   feat(theme): create ThemeProvider context

   - Add ThemeProvider component with light/dark/system modes
   - Persist preference to localStorage
   - Detect system preference changes

   Implements: VRZ-125
   Part-of: VRZ-100
   ```

8. Update Linear:
   - VRZ-125 → "In Progress"
   - Add completion comment

9. Report and STOP:
   ```
   STATUS: SUBTASK_COMPLETE

   ## VRZ-125: Create ThemeProvider
   Completed: 2 of 4 sub-tasks
   Ready next: VRZ-126

   EXECUTION_COMPLETE: VRZ-125
   ```

10. **STOP** - Do not continue to VRZ-126. The loop will invoke again.
</execution_example>
</examples>

<anti_patterns>
**Don't continue to next sub-task** (MOST IMPORTANT):
- BAD: "Sub-task A complete. Now let me work on sub-task B..."
- BAD: "Should I continue to the next sub-task?"
- BAD: Processing multiple sub-tasks in one invocation
- GOOD: Complete ONE sub-task, output STATUS, STOP

**Don't skip context priming**:
- BAD: Jump straight into coding without understanding dependencies
- GOOD: Load parent issue and completed blockers first

**Don't expand scope**:
- BAD: Fix unrelated issues discovered during work
- GOOD: Note them and stay focused on the sub-task

**Don't skip verification**:
- BAD: Commit without running tests
- GOOD: Full validation (tests, typecheck, lint) before every commit

**Don't commit unrelated files**:
- BAD: `git add -A` to stage everything
- GOOD: Stage only files specified in sub-task

**Don't ignore failures**:
- BAD: Push despite test failures
- GOOD: Fix issues or output VERIFICATION_FAILED and stop

**Don't forget Linear updates**:
- BAD: Complete work but leave sub-task in Backlog
- GOOD: Update status and add completion comment

**Don't ask user questions**:
- BAD: Using AskUserQuestion during automated loop execution
- GOOD: Make reasonable decisions or output failure STATUS and stop
</anti_patterns>

<success_criteria>
A successful execution achieves:

- [ ] Parent issue context loaded and understood
- [ ] Correct ready sub-task selected (no unresolved blockers)
- [ ] Context from completed dependencies incorporated
- [ ] Implementation addresses all acceptance criteria
- [ ] Only specified files modified (scope discipline)
- [ ] Typecheck passes
- [ ] Tests pass
- [ ] Lint passes
- [ ] Commit created with conventional message
- [ ] Changes pushed to remote
- [ ] Sub-task moved to "In Progress" in Linear
- [ ] Completion comment added to sub-task
- [ ] Completion report output with STATUS marker
- [ ] **STOPPED after one sub-task** (no continuation)
</success_criteria>

<termination_signals>
The skill outputs these status markers for loop script parsing:

| Status | Meaning | Loop Action |
|--------|---------|-------------|
| `STATUS: SUBTASK_COMPLETE` | One sub-task was implemented | Continue loop |
| `STATUS: ALL_COMPLETE` | All sub-tasks are done | Exit loop |
| `STATUS: ALL_BLOCKED` | Remaining sub-tasks are blocked | Exit loop |
| `STATUS: NO_SUBTASKS` | No sub-tasks exist | Exit loop |
| `STATUS: VERIFICATION_FAILED` | Tests/typecheck failed after retries | Exit loop |

Each invocation outputs exactly ONE status and then terminates.
</termination_signals>
