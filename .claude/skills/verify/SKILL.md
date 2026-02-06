---
name: verify
description: Verify a completed issue by comparing implementation against acceptance criteria, running tests, and critiquing the work. Adds review notes as a comment on the ticket. Supports both Linear and Jira backends via progressive disclosure. Use as the final step in the issue workflow after execute, when the user mentions "verify", "review", or "check" an issue.
invocation: /verify
---

<objective>
Perform thorough verification of a completed issue implementation. Compare what was built against acceptance criteria, identify gaps, run validation checks, and document the review on the ticket.

Workflow: define → refine → execute → **verify** (this skill)
</objective>

<backend_detection>
Read `metadata.backend` from context file (`cat "$MOBIUS_CONTEXT_FILE" | jq '.metadata.backend'`). Values: `linear` or `jira` (default: `linear`). Backend affects status naming conventions but not workflow.
</backend_detection>

<verification_config>
Read from `mobius.config.yaml` (defaults in parentheses):

```yaml
execution:
  verification:
    coverage_threshold: 80
    require_all_tests_pass: true
    performance_check: true
    security_check: true
    max_rework_iterations: 3
```
</verification_config>

<autonomous_actions>
**CRITICAL**: These actions MUST be performed AUTONOMOUSLY without asking the user:

1. **Reopen failing sub-tasks** - On FAIL/NEEDS_WORK: add feedback comments with file:line references, transition back to "To Do" immediately
2. **Post verification report** - Always post review comment to ticket
3. **Mark verification sub-task Done** - On PASS/PASS_WITH_NOTES, automatically mark Done

User interaction only for: escalation after max_rework_iterations, ambiguous requirements (DISCUSS status).

**Note**: The verification sub-task is created by refine. When mobius executes a "Verification Gate" sub-task, it routes to this skill.
</autonomous_actions>

<context_input>
Context provided via `MOBIUS_CONTEXT_FILE` env var and `.mobius/issues/{parentId}/` local files.

```json
{
  "parent": { "id": "uuid", "identifier": "MOB-161", "title": "...", "description": "...", "gitBranchName": "...", "status": "In Progress", "labels": [], "url": "..." },
  "subTasks": [{ "id": "uuid", "identifier": "MOB-177", "title": "...", "description": "...", "status": "done", "blockedBy": [], "blocks": [] }],
  "verificationTask": { "id": "uuid", "identifier": "MOB-186", "title": "[MOB-161] Verification Gate", "status": "in_progress" },
  "metadata": { "fetchedAt": "...", "updatedAt": "...", "backend": "linear" }
}
```

Read with: `cat "$MOBIUS_CONTEXT_FILE"` or `cat .mobius/issues/{parentId}/parent.json`

Sub-task status values: `pending`, `in_progress`, `done`. Implementation sub-tasks are in `subTasks`; verification sub-task in `verificationTask`.
</context_input>

<structured_output>
**This skill MUST output structured YAML at the END of your response.**

```yaml
---
status: PASS  # Required: PASS | PASS_WITH_NOTES | NEEDS_WORK | FAIL | ALL_BLOCKED
timestamp: "2026-01-28T12:00:00Z"  # Required
parentId: "MOB-161"  # Required
verificationTaskId: "MOB-186"  # Required
durationSeconds: 45  # Required

projectInfo:
  projectType: "node"
  buildSystem: "just"
  platformTargets: []

subtaskVerifyResults:
  - subtaskId: "MOB-177"
    title: "Define types"
    command: "bun run typecheck"
    exitCode: 0
    passed: true

# PASS / PASS_WITH_NOTES:
criteriaResults:
  met: 5
  total: 5
  details:
    - criterion: "Feature X implemented"
      status: PASS
      evidence: "src/feature.ts:42"
verificationChecks:
  tests: { status: PASS, command: "just test" }
  typecheck: { status: PASS, command: "just typecheck" }
  lint: { status: PASS, command: "just lint" }
  cicd: PASS
reviewComment: |
  ## Verification Review
  **Status**: PASS
  ...full review content...
notes:  # PASS_WITH_NOTES only
  - "Consider refactoring X for clarity"

# NEEDS_WORK / FAIL:
failingSubtasks:
  - id: "uuid"
    identifier: "MOB-177"
    issues:
      - type: "critical"
        description: "Missing error handling"
        file: "src/feature.ts"
        line: 42
reworkIteration: 1
feedbackComments:
  - subtaskId: "MOB-177"
    comment: |
      ## Verification Feedback: NEEDS_REWORK
      ...feedback content...

# Escalation (max iterations reached):
escalation:
  reason: "Max rework iterations (3) exceeded"
  history:
    - iteration: 1
      issues: ["Missing tests"]
---
```

**Requirements**: Output valid YAML at END of response. Must include `status`, `timestamp`, `parentId`, `verificationTaskId`. The `reviewComment` field contains the full review to post to parent issue.
</structured_output>

<context>
Verification catches incomplete implementations, scope drift, technical debt, missing tests, and regressions. The review comment documents findings on the ticket for team visibility.
</context>

<quick_start>
<invocation>
```
/verify PROJ-123
```
</invocation>

<workflow>
1. **Detect backend** - Read from config
2. **Identify parent issue** - From verification sub-task
3. **Fetch issue context** - Title, description, acceptance criteria, sub-tasks
4. **Aggregate implementation context** - Files modified, comments, status from all sub-tasks
5. **Analyze implementation** - Review commits, changed files, code
6. **Run verification checks** - Tests, typecheck, lint
7. **Compare against criteria** - Evaluate each acceptance criterion
8. **Multi-agent critique** - Spawn 4 parallel review agents
9. **Generate review report** - Structured analysis
10. **Handle outcome** - FAIL/NEEDS_WORK: reopen failing sub-tasks. PASS: mark VG Done
11. **Post to ticket** - Add review as comment on parent issue
12. **Report status** - Output STATUS for mobius loop
</workflow>
</quick_start>

<parent_story_mode>
When verify runs on a verification sub-task (via mobius loop):

1. **Identify parent issue** from verification sub-task
2. **Collect all sibling sub-tasks** from context file
3. **Separate implementation vs verification sub-tasks**
4. **Verify all implementation sub-tasks "Done"** - If not, output `status: ALL_BLOCKED` and exit
5. **Aggregate context**: acceptance criteria from parent + each sub-task, implementation notes, files modified, coverage data
</parent_story_mode>

<verification_subtask_context>
The verification sub-task is created by **refine** during issue breakdown.

When mobius loop encounters a "Verification Gate" sub-task (detected by title), it routes to `/verify` instead of `/execute`.

**Expected format**: Title `[{parent-id}] Verification Gate`, blocked by all implementation sub-tasks.

**Flow**: refine creates VG → execute completes implementation tasks → VG unblocks → mobius routes to verify → on FAIL: reopens failing sub-tasks → on PASS: marks VG Done
</verification_subtask_context>

<issue_context_phase>
<load_context>
Load from `MOBIUS_CONTEXT_FILE`:
```bash
cat "$MOBIUS_CONTEXT_FILE" | jq '.parent'
cat "$MOBIUS_CONTEXT_FILE" | jq '.subTasks'
cat "$MOBIUS_CONTEXT_FILE" | jq '.verificationTask'
```

Extract: title/description, acceptance criteria (checkbox patterns), labels, priority.
</load_context>

<load_subtasks>
Read sub-tasks from context file or `.mobius/issues/{parentId}/tasks/`. Verify all implementation sub-tasks have status "done" — if any not "done", output `status: ALL_BLOCKED` and stop.
</load_subtasks>

<subtask_verify_commands>
Execute `subTaskVerifyCommands` from context file (`jq '.subTaskVerifyCommands // []'`).

Each entry: `{ subtaskId, title, command }`. Execute ALL commands (even if some fail), capture exit code/output, record results. Apply safety checks (block `rm -rf`, `sudo`, `curl|bash`, etc.). Include failures in overall assessment.

If `subTaskVerifyCommands` is missing/empty, skip silently.
</subtask_verify_commands>

<context_summary>
Build verification context combining: parent issue details, acceptance criteria, sub-tasks table (ID/title/status/target file), and implementation notes from sub-task descriptions.
</context_summary>
</issue_context_phase>

<implementation_analysis_phase>
<git_analysis>
Analyze commits related to the issue:
```bash
git log --oneline --all --grep="{issue-id}" | head -20
git log --oneline --name-only -10
```
Extract: commit messages/hashes, files created/modified, authors, dates.
</git_analysis>

<code_review>
For each modified file: read the file, check codebase convention adherence, verify acceptance criteria coverage, identify bugs/edge cases/concerns. Focus: error handling, input validation, edge cases, type safety, test coverage.
</code_review>

<test_file_review>
Review test files for: existence, edge case coverage, meaningfulness (not coverage padding), clear behavior-describing names.
</test_file_review>
</implementation_analysis_phase>

<verification_checks_phase>
<run_dynamic_checks>
Use `projectInfo.availableCommands` from context file. Resolution order: context commands → `just {check}` fallback → hardcoded default with warning.

Run **typecheck**, **lint**, **tests** using resolved commands. Run **platform builds** if `platformTargets` includes android/ios.

If `projectInfo` missing entirely, warn and use `just typecheck`, `just lint`, `just test`.
</run_dynamic_checks>

<check_cicd_status>
Check CI/CD via: `gh pr view --json number,state,statusCheckRollup` or `gh run list --branch $(git branch --show-current) --limit 5`.

- PR exists: use `statusCheckRollup` (all pass=PASS, any fail=FAIL, any pending=PENDING)
- No PR: check latest workflow run conclusion
- No CI configured: N/A

**Failing CI blocks PASS** — implementation may be correct but not ready to merge.
</check_cicd_status>

<verification_summary>
Compile results table: Tests, Typecheck, Lint, CI/CD with status and details. CI/CD FAIL prevents overall PASS.
</verification_summary>
</verification_checks_phase>

<criteria_comparison_phase>
For each acceptance criterion, evaluate: addressed? complete? testable? correct?

Mark as: **PASS** (fully implemented+tested), **PARTIAL** (incomplete/missing tests), **FAIL** (not implemented/broken), **UNCLEAR** (can't determine).

Build criteria matrix: `| # | Criterion | Status | Evidence | Notes |`
</criteria_comparison_phase>

<duration_sanity_check>
Record start time at skill initialization. After all checks complete, if elapsed < 5 seconds: warn and re-run all checks with verbose flags. Include `durationSeconds` in structured output.
</duration_sanity_check>

<multi_agent_review>
**ALWAYS spawn all 4 review agents — do NOT skip any.**

If Task tool unavailable (piped mode), perform reviews INLINE sequentially. Wait for ALL results before aggregation.

| Agent | Focus | Output Fields |
|-------|-------|---------------|
| Bug & Logic (code-reviewer) | Logic errors, off-by-one, edge cases, error handling | CRITICAL, IMPORTANT, EDGE_CASES_MISSING, PASS |
| Code Structure (code-reviewer) | Convention adherence, code smells, readability, abstractions | CODE_SMELLS, PATTERN_VIOLATIONS, ARCHITECTURE_CONCERNS, PASS |
| Performance & Security (code-reviewer) | N+1 queries, memory leaks, input validation, auth, sensitive data | PERFORMANCE_ISSUES, SECURITY_VULNERABILITIES, PASS |
| Test Quality (code-reviewer) | Coverage %, test meaningfulness, edge case tests, mock appropriateness | COVERAGE_PERCENT, THRESHOLD_MET, MISSING_TESTS, TEST_QUALITY_ISSUES, PASS |

Each agent receives: issue context, acceptance criteria, modified files list.

### Aggregation

```
if any(CRITICAL or SECURITY_VULNERABILITIES with severity=high):
    overall = FAIL
elif any(IMPORTANT) or not THRESHOLD_MET:
    overall = NEEDS_WORK
elif all(PASS):
    overall = PASS
else:
    overall = PASS_WITH_NOTES
```
</multi_agent_review>

<identify_improvements>
Categorize findings from all agents:

- **Critical** (must fix): bugs, missing criteria, security vulnerabilities (high), logic errors
- **Important** (should fix): missing edge cases, incomplete coverage, code quality, performance issues
- **Suggestions** (nice to have): refactoring, optimizations, documentation
- **Questions** (need clarification): ambiguous requirements, design decisions, unspecified edge cases
</identify_improvements>

<rework_loop>
**AUTONOMOUS ACTION**: On FAIL/NEEDS_WORK, implement immediately without asking the user.

1. **Map findings to sub-tasks**: Match file:line references to responsible sub-tasks via git blame or sub-task comments
2. **Prepare feedback**: Include in `feedbackComments` structured output field (format: `## Verification Feedback: NEEDS_REWORK` with Critical/Important issues and recommended fixes)
3. **Include status transitions**: `failingSubtasks` field tells mobius loop which sub-tasks to reopen
4. **Track iteration**: Include `reworkIteration` count. After `max_rework_iterations` (default 3), include `escalation` in output

### On PASS/PASS_WITH_NOTES
Include `status`, `criteriaResults`, and `reviewComment` in structured output. Mobius loop marks VG Done and posts report to parent.
</rework_loop>

<review_report_phase>
<report_structure>
Generate structured review report:

```markdown
## Verification Report: {Issue ID}

### Summary
**Overall Status**: PASS / PASS_WITH_NOTES / NEEDS_WORK / FAIL
**Criteria Met**: X of Y
**Tests**: PASS / FAIL | **Typecheck**: PASS / FAIL

### Acceptance Criteria Evaluation
| # | Criterion | Status | Notes |
|---|-----------|--------|-------|

### Implementation Review
**Done well**: {positives}
**Critical Issues**: {must fix}
**Important Issues**: {should address}
**Suggestions**: {consider for future}

### Files Reviewed
- `{file}` - {summary}

### Recommendation
{APPROVE / REQUEST_CHANGES / DISCUSS}
```
</report_structure>

<status_definitions>
| Status | Meaning | Action |
|--------|---------|--------|
| PASS | All criteria met, all checks pass | Close issue |
| PASS_WITH_NOTES | Criteria met with minor suggestions | Close, optionally address suggestions |
| NEEDS_WORK | Some criteria not met or tests fail | Keep open, address issues |
| FAIL | Critical issues or many criteria not met | Keep open, major rework needed |
</status_definitions>
</review_report_phase>

<ticket_update_phase>
<post_review_comment>
Include review as `reviewComment` field in structured output. Mobius loop posts it to parent issue via SDK.
</post_review_comment>

<update_issue_status>
Structured output `status` drives mobius loop actions:
- **PASS/PASS_WITH_NOTES**: Loop marks VG Done, posts reviewComment to parent
- **NEEDS_WORK/FAIL**: Loop reopens failing sub-tasks, posts feedback comments, VG stays "In Progress"
</update_issue_status>

<update_local_context>
**CRITICAL: Update local context files after verification.**

On **PASS/PASS_WITH_NOTES**:
- Update `.mobius/issues/{parentId}/tasks/{verificationTaskId}.json`: status → "done"
- Update `context.json`: verificationTask.status → "done", metadata.updatedAt → current timestamp

On **NEEDS_WORK/FAIL**:
- Keep verification task "in_progress"
- Revert failing sub-task files: status "done" → "pending"
- Update `context.json`: failing sub-tasks status → "pending", metadata.updatedAt → current timestamp

Local files must be updated for `mobius sync` to propagate changes to Linear/Jira.
</update_local_context>
</ticket_update_phase>

<completion_report>
<report_format>
```markdown
# Verification Complete

## Issue: {ID} - {Title}
**Status**: {PASS/PASS_WITH_NOTES/NEEDS_WORK/FAIL}
**Recommendation**: {APPROVE/REQUEST_CHANGES/DISCUSS}

### Summary
- Acceptance Criteria: {X of Y} met
- Tests: {status} | Typecheck: {status} | Lint: {status}

### Key Findings
{Top 3-5 findings}

### Actions Taken
- [x] Review comment posted to ticket
- [x] Issue status updated (if PASS)
- [ ] Follow-up issues created (if applicable)

### Next Steps
{Clear recommendations}
```
</report_format>

<follow_up_issues>
Include non-blocking issues in `followUpIssues` structured output field for mobius loop to create via SDK.
</follow_up_issues>

<status_markers>
Structured output `status` field determines outcome: `PASS`, `PASS_WITH_NOTES`, `NEEDS_WORK`, `FAIL`, `ALL_BLOCKED`. Mobius loop parses YAML to take appropriate actions.
</status_markers>
</completion_report>

<anti_patterns>
- **Don't skip code review** — run tests AND read code against each criterion
- **Don't be superficial** — thorough analysis, not just "tests pass, looks good"
- **Don't approve incomplete work** — NEEDS_WORK until all criteria addressed
- **Don't skip ticket comment** — always document verification on ticket
- **Don't forget sub-task checks** — verify all sub-tasks complete before review
- **Don't skip local context updates** — update `.mobius/issues/` files AND context.json
</anti_patterns>

<success_criteria>
- [ ] Context gathered (parent + sub-tasks + files)
- [ ] Quality gates evaluated (tests, typecheck, lint, CI/CD, coverage)
- [ ] Multi-agent review completed (4 agents + aggregation)
- [ ] Rework loop executed on FAIL/NEEDS_WORK (feedback, status transitions, iteration tracking)
- [ ] Completion handled (status updates, comments, local file updates)
</success_criteria>
