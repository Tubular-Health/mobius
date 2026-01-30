---
name: verify
description: Verify a completed issue by comparing implementation against acceptance criteria, running tests, and critiquing the work. Adds review notes as a comment on the ticket. Supports both Linear and Jira backends via progressive disclosure. Use as the final step in the issue workflow after execute-issue, when the user mentions "verify", "review", or "check" an issue.
invocation: /verify
---

<objective>
Perform a thorough verification of a completed issue implementation. This skill compares what was actually built against the intended goal and acceptance criteria, identifies gaps, runs validation checks, and documents the review on the ticket.

This is the fourth and final step in the issue workflow:
1. **define-issue** - Creates well-defined issues with acceptance criteria
2. **refine-issue** - Breaks issues into single-file-focused sub-tasks with dependencies
3. **execute-issue** - Implements sub-tasks one at a time
4. **verify-issue** (this skill) - Validates implementation against acceptance criteria
</objective>

<backend_detection>
**FIRST**: Detect the backend from context file metadata.

Read the `metadata.backend` field from the context file:

```bash
cat "$MOBIUS_CONTEXT_FILE" | jq '.metadata.backend'
```

**Values**: `linear` or `jira`

**Default**: If no backend is specified in metadata, default to `linear`.

The backend information is used for understanding status naming conventions but does not change the workflow - all context is read from local files and outputs are structured data.
</backend_detection>

<verification_config>
Read verification configuration from `mobius.config.yaml`:

```yaml
execution:
  verification:
    coverage_threshold: 80        # Default: 80%
    require_all_tests_pass: true  # Default: true
    performance_check: true       # Default: true
    security_check: true          # Default: true
    max_rework_iterations: 3      # Default: 3
```

If not specified, use defaults. These settings control the multi-agent verification behavior.
</verification_config>

<autonomous_actions>
**CRITICAL**: The following actions MUST be performed AUTONOMOUSLY without asking the user:

1. **Reopen failing sub-tasks** - When verification finds issues (FAIL or NEEDS_WORK), IMMEDIATELY:
   - Add feedback comments to failing sub-tasks with specific file:line references
   - Transition failing sub-tasks back to "To Do" status
   - Do not ask "Should I reopen these sub-tasks?" - just do it

2. **Post verification report** - Always post the review comment to the ticket without asking.

3. **Mark verification sub-task Done** - On PASS or PASS_WITH_NOTES, automatically mark the current verification sub-task as Done.

The verify-issue skill is designed to run end-to-end autonomously. User interaction is only needed for:
- Escalation after max_rework_iterations exceeded
- Ambiguous requirements that need clarification (DISCUSS status)

**Note**: The verification sub-task is created by refine-issue during issue breakdown. When mobius executes a "Verification Gate" sub-task, it routes to this skill instead of execute-issue.
</autonomous_actions>

<context_input>
**The mobius loop provides verification context via environment variable and local files.**

The skill receives context through:
1. `MOBIUS_CONTEXT_FILE` environment variable - path to the context JSON file
2. Local files at `~/.mobius/issues/{parentId}/`

**Context file structure** (at `MOBIUS_CONTEXT_FILE` path):

```json
{
  "parent": {
    "id": "uuid",
    "identifier": "MOB-161",
    "title": "Parent issue title",
    "description": "Full description with acceptance criteria",
    "gitBranchName": "branch-name",
    "status": "In Progress",
    "labels": ["Feature"],
    "url": "https://linear.app/..."
  },
  "subTasks": [
    {
      "id": "uuid",
      "identifier": "MOB-177",
      "title": "Sub-task title",
      "description": "Full description with acceptance criteria",
      "status": "done",
      "gitBranchName": "branch-name",
      "blockedBy": [],
      "blocks": []
    }
  ],
  "verificationTask": {
    "id": "uuid",
    "identifier": "MOB-186",
    "title": "[MOB-161] Verification Gate",
    "status": "in_progress"
  },
  "metadata": {
    "fetchedAt": "2026-01-28T12:00:00Z",
    "updatedAt": "2026-01-28T12:00:00Z",
    "backend": "linear"
  }
}
```

**Reading context**:
```bash
# Context file path from environment
CONTEXT_FILE="$MOBIUS_CONTEXT_FILE"

# Or read directly from local storage
cat ~/.mobius/issues/MOB-161/parent.json
cat ~/.mobius/issues/MOB-161/tasks/MOB-177.json
```

**Sub-task status values**: `pending`, `in_progress`, `done`

**Implementation sub-tasks vs Verification sub-task**:
- Implementation sub-tasks have titles like `[MOB-161] Create feature X`
- Verification sub-task has title containing `Verification Gate`
- The context file separates these: `subTasks` (implementation) and `verificationTask`

**Backend detection**: The `metadata.backend` field indicates whether the issue is from Linear or Jira. This affects status transition names in the structured output but the skill should treat the context data uniformly.
</context_input>

<structured_output>
**This skill MUST output structured data for the mobius loop to parse.**

At the END of your response, output a YAML or JSON block with the verification result. The mobius loop parses this to execute status updates, add comments, and determine next actions.

**Output format** (YAML preferred for readability):

```yaml
---
status: PASS  # Required: one of the valid status values
timestamp: "2026-01-28T12:00:00Z"  # Required: ISO-8601 timestamp
parentId: "MOB-161"  # Required: parent issue identifier
verificationTaskId: "MOB-186"  # Required: verification sub-task identifier

# For PASS or PASS_WITH_NOTES:
criteriaResults:
  met: 5
  total: 5
  details:
    - criterion: "Feature X implemented"
      status: PASS
      evidence: "src/feature.ts:42"
    - criterion: "Tests added"
      status: PASS
      evidence: "src/feature.test.ts"
verificationChecks:
  tests: PASS
  typecheck: PASS
  lint: PASS
  cicd: PASS
reviewComment: |
  ## Verification Review

  **Status**: PASS
  ...full review content...

# For PASS_WITH_NOTES additionally:
notes:
  - "Consider refactoring X for clarity"
  - "Documentation could be improved"

# For NEEDS_WORK or FAIL:
failingSubtasks:
  - id: "MOB-177"
    identifier: "MOB-177"
    issues:
      - type: "critical"
        description: "Missing error handling"
        file: "src/feature.ts"
        line: 42
      - type: "important"
        description: "Test coverage below threshold"
reworkIteration: 1  # Current iteration count
feedbackComments:
  - subtaskId: "MOB-177"
    comment: |
      ## Verification Feedback: NEEDS_REWORK
      ...feedback content...

# For escalation (max iterations reached):
escalation:
  reason: "Max rework iterations (3) exceeded"
  history:
    - iteration: 1
      issues: ["Missing tests"]
    - iteration: 2
      issues: ["Tests still incomplete"]
    - iteration: 3
      issues: ["Coverage threshold not met"]
---
```

**Valid status values**:
| Status | When to use |
|--------|-------------|
| `PASS` | All criteria met, all checks pass, no issues |
| `PASS_WITH_NOTES` | All criteria met with minor suggestions |
| `NEEDS_WORK` | Some criteria not met or important issues found |
| `FAIL` | Critical issues or many criteria not met |
| `ALL_BLOCKED` | Implementation sub-tasks not all complete |

**Critical requirements**:
1. Output MUST be valid YAML or JSON
2. Output MUST appear at the END of your response
3. Output MUST include `status`, `timestamp`, `parentId`, and `verificationTaskId` fields
4. Include all required fields for the specific status type
5. The `reviewComment` field should contain the full verification review to be posted to the parent issue

**Example complete output for PASS**:

```yaml
---
status: PASS
timestamp: "2026-01-28T16:45:00Z"
parentId: "MOB-161"
verificationTaskId: "MOB-186"
criteriaResults:
  met: 5
  total: 5
  details:
    - criterion: "SDK infrastructure replaces all MCP tool operations"
      status: PASS
      evidence: "No MCP tool references in skills"
    - criterion: "Local file system stores issue context"
      status: PASS
      evidence: "~/.mobius/issues/ directory created"
verificationChecks:
  tests: PASS
  typecheck: PASS
  lint: PASS
  cicd: PASS
reviewComment: |
  ## Verification Review

  **Status**: PASS
  **Recommendation**: APPROVE

  ### Acceptance Criteria
  All 5 criteria met.

  ### Checks
  - Tests: PASS
  - Typecheck: PASS
  - Lint: PASS
  - CI/CD: PASS

  All criteria met. Ready to close.
---
```

**Example complete output for NEEDS_WORK**:

```yaml
---
status: NEEDS_WORK
timestamp: "2026-01-28T16:45:00Z"
parentId: "MOB-161"
verificationTaskId: "MOB-186"
criteriaResults:
  met: 3
  total: 5
  details:
    - criterion: "SDK infrastructure replaces MCP"
      status: PASS
      evidence: "src/lib/linear.ts"
    - criterion: "Tests pass"
      status: FAIL
      evidence: "2 tests failing"
verificationChecks:
  tests: FAIL
  typecheck: PASS
  lint: PASS
  cicd: FAIL
failingSubtasks:
  - id: "uuid-here"
    identifier: "MOB-177"
    issues:
      - type: "critical"
        description: "Tests failing in context-generator"
        file: "src/lib/context-generator.test.ts"
        line: 45
reworkIteration: 1
feedbackComments:
  - subtaskId: "MOB-177"
    comment: |
      ## Verification Feedback: NEEDS_REWORK

      ### Issues Found

      **Critical** (must fix):
      - Tests failing at src/lib/context-generator.test.ts:45

      ### Recommended Fixes
      Fix the async/await handling in generateContext()
reviewComment: |
  ## Verification Review

  **Status**: NEEDS_WORK
  **Recommendation**: REQUEST_CHANGES

  ### Acceptance Criteria
  3 of 5 criteria met.

  ### Issues
  - Tests failing in context-generator module

  ### Next Steps
  1. Fix failing tests
  2. Re-verify after changes
---
```
</structured_output>

<context>
Verification is critical for catching:
- **Incomplete implementations**: Acceptance criteria not fully addressed
- **Scope drift**: Changes that don't match the original intent
- **Technical debt**: Shortcuts or workarounds that need follow-up
- **Missing tests**: Functionality without proper test coverage
- **Regressions**: Changes that break existing functionality

The review adds a structured comment to the ticket documenting findings, making the verification visible to the team.
</context>

<quick_start>
<invocation>
Pass the issue identifier:

```
/verify PROJ-123
```

Or invoke programmatically:
```
Skill: verify-issue
Args: PROJ-123
```
</invocation>

<workflow>
1. **Detect backend** - Read backend from config (linear or jira)
2. **Identify parent issue** - Determine the parent issue from the verification sub-task
3. **Fetch issue context** - Get title, description, acceptance criteria, comments, sub-tasks from parent
4. **Aggregate implementation context** - Collect files modified, comments, and status from all implementation sub-tasks
5. **Analyze implementation** - Review recent commits, changed files, code
6. **Run verification checks** - Tests, typecheck, lint
7. **Compare against criteria** - Check each acceptance criterion
8. **Multi-agent critique** - Spawn 4 parallel review agents for comprehensive analysis
9. **Generate review report** - Structured analysis with findings
10. **Handle outcome** - On FAIL/NEEDS_WORK: reopen failing sub-tasks with feedback. On PASS: mark verification sub-task Done
11. **Post to ticket** - Add review as comment on the parent issue
12. **Report status** - Output STATUS marker for mobius loop
</workflow>
</quick_start>

<parent_story_mode>
When verify-issue is called on a verification sub-task (via mobius loop), operate in parent story mode:

1. **Identify parent issue** - Get the parent issue ID from the verification sub-task
2. **Collect all sibling sub-tasks** - Fetch using backend list tool with parentId filter
3. **Separate implementation vs verification sub-tasks** - Filter out the current verification sub-task from the list
4. **Verify all implementation sub-tasks "Done"** - If any implementation sub-task is not complete, output STATUS: ALL_BLOCKED and exit
5. **Aggregate context**:
   - Acceptance criteria from parent + each implementation sub-task
   - Implementation notes from all sub-task comments
   - Files modified across all sub-tasks
   - Coverage data from all test runs

**Note**: The verification sub-task is created by refine-issue during issue breakdown. This skill focuses on EXECUTING verification, not creating the sub-task.

**Context aggregation**:
```markdown
# Aggregated Verification Context

## Parent Issue: {ID} - {Title}
{Parent description and acceptance criteria}

## Sub-Tasks Summary
| ID | Title | Status | Files Modified | Key Changes |
|----|-------|--------|----------------|-------------|
| ... | ... | Done | file1.ts, file2.ts | {summary} |

## Combined Acceptance Criteria
From parent:
- [ ] Parent criterion 1
- [ ] Parent criterion 2

From sub-tasks:
- [ ] {Sub-task 1 ID}: Criterion from sub-task
- [ ] {Sub-task 2 ID}: Criterion from sub-task

## All Modified Files
{Deduplicated list of all files changed across sub-tasks}

## Implementation Notes (aggregated from comments)
{Key decisions, constraints, and context from all sub-task comments}
```
</parent_story_mode>

<verification_subtask_context>
**Note**: The verification sub-task is created by the **refine-issue** skill during issue breakdown, NOT by verify-issue.

When mobius loop encounters a "Verification Gate" sub-task (detected by title pattern), it routes execution to `/verify-issue` instead of `/execute-issue`.

**Expected sub-task format** (created by refine-issue):
- **Title**: `[{parent-id}] Verification Gate` (MUST contain "Verification Gate")
- **Blocked by**: All implementation sub-tasks
- **Labels**: `["verification"]` (optional)

**Execution flow**:
1. refine-issue creates: implementation sub-tasks + Verification Gate sub-task
2. mobius loop executes implementation sub-tasks via `/execute-issue`
3. When all implementation sub-tasks are Done, Verification Gate becomes unblocked
4. mobius detects "Verification Gate" in title → routes to `/verify-issue`
5. verify-issue runs multi-agent review on the parent issue
6. On FAIL: reopens failing implementation sub-tasks → mobius loop continues
7. On PASS: marks Verification Gate Done → parent issue can be completed
</verification_subtask_context>

<issue_context_phase>
<load_context>
Load issue context from the `MOBIUS_CONTEXT_FILE` environment variable:

```bash
# Read full context
cat "$MOBIUS_CONTEXT_FILE"

# Or extract specific parts
cat "$MOBIUS_CONTEXT_FILE" | jq '.parent'
cat "$MOBIUS_CONTEXT_FILE" | jq '.subTasks'
cat "$MOBIUS_CONTEXT_FILE" | jq '.verificationTask'
```

Extract from parent:
- **Title and description**: What was supposed to be built
- **Acceptance criteria**: Checklist of requirements (look for checkbox patterns)
- **Labels**: Bug/Feature/Improvement for context
- **Priority**: Urgency level
</load_context>

<load_subtasks>
Read sub-tasks from the context file:

```bash
cat "$MOBIUS_CONTEXT_FILE" | jq '.subTasks[]'
```

Or from local files:
```bash
ls ~/.mobius/issues/{parentId}/tasks/
cat ~/.mobius/issues/{parentId}/tasks/{taskId}.json
```

Verify:
- All implementation sub-tasks have status "done"
- If any sub-task is not "done", output `status: ALL_BLOCKED` and stop
- Each sub-task has description with acceptance criteria
</load_subtasks>

<context_summary>
Build verification context from local files:

```markdown
# Verification Context

## Issue: {ID} - {Title}
**Type**: {Bug/Feature/Improvement}
**Priority**: {level}

## Description
{Full description from parent.description}

## Acceptance Criteria
- [ ] Criterion 1 (from parent description)
- [ ] Criterion 2
- [ ] Criterion 3

## Sub-tasks (from subTasks array)
| ID | Title | Status | Target File |
|----|-------|--------|-------------|
| ... | ... | done | ... |

## Implementation Notes (from sub-task descriptions)
{Key decisions, constraints, from sub-task descriptions}
```
</context_summary>
</issue_context_phase>

<implementation_analysis_phase>
<git_analysis>
Analyze recent commits related to the issue:

```bash
# Find commits referencing the issue
git log --oneline --all --grep="{issue-id}" | head -20

# Get the branch if working on feature branch
git branch --contains | head -5

# Show files changed in recent commits
git log --oneline --name-only -10
```

Extract:
- Commit messages and hashes
- Files created or modified
- Commit authors and dates
</git_analysis>

<code_review>
For each modified file, perform code review:

1. **Read the file** to understand what was implemented
2. **Check for patterns**: Does it follow codebase conventions?
3. **Verify completeness**: Does the code address the acceptance criteria?
4. **Identify concerns**: Any potential bugs, edge cases, or issues?

Focus areas:
- Error handling
- Input validation
- Edge cases
- Type safety
- Test coverage
- Documentation
</code_review>

<test_file_review>
Review corresponding test files:

- Do tests exist for new functionality?
- Do tests cover edge cases mentioned in acceptance criteria?
- Are tests meaningful (not just coverage padding)?
- Do test names describe behavior clearly?
</test_file_review>
</implementation_analysis_phase>

<verification_checks_phase>
<run_tests>
Execute the test suite:

```bash
# Run all tests
just test

# Or run tests for specific files
just test-file {pattern}
```

Capture:
- Pass/fail count
- Any failures with error messages
- Coverage information if available
</run_tests>

<run_typecheck>
Verify type safety:

```bash
just typecheck
```

Capture any type errors or warnings.
</run_typecheck>

<run_lint>
Check code quality:

```bash
just lint
# or
bun run lint
```

Note any linting issues.
</run_lint>

<check_cicd_status>
Verify CI/CD pipeline status before approving:

```bash
# Check if there's an open PR for the current branch
gh pr view --json number,state,statusCheckRollup 2>/dev/null

# If no PR, check the latest workflow runs for the branch
gh run list --branch $(git branch --show-current) --limit 5

# Get detailed status of the most recent run
gh run view --json status,conclusion,jobs
```

**CI/CD Check Logic**:

1. **If PR exists**: Use `statusCheckRollup` to get all check statuses
   - All checks PASS: CI status = PASS
   - Any check PENDING: CI status = PENDING (wait or note in review)
   - Any check FAILURE: CI status = FAIL

2. **If no PR**: Check latest workflow run on branch
   - `conclusion: success`: CI status = PASS
   - `conclusion: failure`: CI status = FAIL
   - `status: in_progress`: CI status = PENDING

3. **If no CI configured**: Note this in review (CI status = N/A)

**Important**: A failing CI/CD status should block PASS recommendation. The implementation may be correct, but if CI is failing, it's not ready to merge.

```bash
# Example: Parse PR check status
gh pr view --json statusCheckRollup --jq '.statusCheckRollup[] | "\(.name): \(.conclusion // .status)"'

# Example: Get workflow run conclusion
gh run list --branch $(git branch --show-current) --limit 1 --json conclusion,status --jq '.[0]'
```
</check_cicd_status>

<verification_summary>
Compile verification results:

```markdown
## Verification Checks

| Check | Status | Details |
|-------|--------|---------|
| Tests | PASS/FAIL | X passed, Y failed |
| Typecheck | PASS/FAIL | {error count if any} |
| Lint | PASS/FAIL | {warning count if any} |
| CI/CD | PASS/FAIL/PENDING/N/A | {workflow status, failed jobs if any} |
```

**CI/CD blocking logic**: If CI/CD status is FAIL, the overall verification status cannot be PASS, even if all other checks pass. A failing pipeline indicates the code is not ready for merge.
</verification_summary>
</verification_checks_phase>

<criteria_comparison_phase>
<criterion_by_criterion>
For each acceptance criterion, evaluate:

1. **Is it addressed?** - Code exists that implements this requirement
2. **Is it complete?** - All aspects of the criterion are handled
3. **Is it testable?** - There are tests verifying this behavior
4. **Is it correct?** - The implementation matches the intent

Mark each criterion:
- **PASS**: Fully implemented, tested, and working
- **PARTIAL**: Implemented but incomplete or missing tests
- **FAIL**: Not implemented or broken
- **UNCLEAR**: Cannot determine from code review alone
</criterion_by_criterion>

<criteria_matrix>
Build a criteria evaluation matrix:

```markdown
## Acceptance Criteria Evaluation

| # | Criterion | Status | Evidence | Notes |
|---|-----------|--------|----------|-------|
| 1 | {criterion text} | PASS | {file:line or test name} | {any notes} |
| 2 | {criterion text} | PARTIAL | {what's missing} | {recommendations} |
| 3 | {criterion text} | FAIL | {what's wrong} | {fix needed} |
```
</criteria_matrix>
</criteria_comparison_phase>

<multi_agent_review>
Spawn four specialized review agents IN PARALLEL using Task tool:

### Agent 1: Bug & Logic Detection
```
Task tool:
  subagent_type: feature-dev:code-reviewer
  prompt: |
    Analyze implementation for bugs and logic errors.

    Context:
    - Issue: {parent_id} - {title}
    - Acceptance Criteria: {all_criteria}
    - Files: {all_modified_files}

    Focus:
    - Logic errors, off-by-one bugs
    - Business logic vs requirements
    - Edge case handling
    - Error handling completeness

    Output (structured):
    CRITICAL: [list with file:line]
    IMPORTANT: [list]
    EDGE_CASES_MISSING: [list]
    PASS: true/false
```

### Agent 2: Code Structure & Best Practices
```
Task tool:
  subagent_type: feature-dev:code-reviewer
  prompt: |
    Review code structure and codebase patterns.

    Files: {all_modified_files}

    Focus:
    - Codebase convention adherence
    - Code smells and anti-patterns
    - Readability and maintainability
    - Appropriate abstractions

    Output (structured):
    CODE_SMELLS: [list with file:line]
    PATTERN_VIOLATIONS: [list]
    ARCHITECTURE_CONCERNS: [list]
    PASS: true/false
```

### Agent 3: Performance & Security
```
Task tool:
  subagent_type: feature-dev:code-reviewer
  prompt: |
    Analyze performance and security.

    Files: {all_modified_files}

    Focus:
    - N+1 queries, unnecessary loops
    - Memory leaks, resource cleanup
    - Input validation
    - Authorization checks
    - Sensitive data handling

    Output (structured):
    PERFORMANCE_ISSUES: [list with severity]
    SECURITY_VULNERABILITIES: [list with severity]
    PASS: true/false
```

### Agent 4: Test Quality & Coverage
```
Task tool:
  subagent_type: feature-dev:code-reviewer
  prompt: |
    Evaluate test quality and coverage.

    Run: just test --coverage (or equivalent)
    Threshold: {coverage_threshold}% (default 80%)

    Test Files: {test_files}
    Source Files: {source_files}

    Focus:
    - Coverage percentage vs threshold
    - Test meaningfulness (not coverage padding)
    - Edge case test presence
    - Mock appropriateness

    Output (structured):
    COVERAGE_PERCENT: number
    THRESHOLD_MET: true/false
    MISSING_TESTS: [list]
    TEST_QUALITY_ISSUES: [list]
    PASS: true/false
```

### Multi-Grader Aggregation

After all agents complete, aggregate using this logic:

```
if any(agent.CRITICAL or agent.SECURITY_VULNERABILITIES with severity=high):
    overall = FAIL
elif any(agent.IMPORTANT) or not test_agent.THRESHOLD_MET:
    overall = NEEDS_WORK
elif all(agent.PASS):
    overall = PASS
else:
    overall = PASS_WITH_NOTES
```

**Aggregation Report Format**:
```markdown
## Multi-Agent Verification Results

### Agent 1: Bug & Logic Detection
Status: {PASS/FAIL}
{findings summary}

### Agent 2: Code Structure
Status: {PASS/FAIL}
{findings summary}

### Agent 3: Performance & Security
Status: {PASS/FAIL}
{findings summary}

### Agent 4: Test Quality
Status: {PASS/FAIL}
Coverage: {X}% (threshold: {Y}%)
{findings summary}

### Overall Status: {PASS/PASS_WITH_NOTES/NEEDS_WORK/FAIL}
```
</multi_agent_review>

<identify_improvements>
Categorize findings from all agents:

**Critical Issues** (must fix):
- Bugs that break functionality
- Missing critical acceptance criteria
- Security vulnerabilities (high severity)
- Logic errors identified by Agent 1

**Important Issues** (should fix):
- Missing edge case handling
- Incomplete test coverage (below threshold)
- Code quality concerns from Agent 2
- Performance issues from Agent 3

**Suggestions** (nice to have):
- Refactoring opportunities
- Performance optimizations
- Documentation improvements

**Questions** (need clarification):
- Ambiguous requirements
- Design decisions to verify
- Edge cases not specified
</identify_improvements>

<rework_loop>
**AUTONOMOUS ACTION**: On FAIL or NEEDS_WORK, IMMEDIATELY implement the rework loop without asking the user. Reopening failing sub-tasks with feedback is a required part of the verification workflow.

On FAIL or NEEDS_WORK, implement the rework loop:

### 1. Map Findings to Sub-Tasks

Match each finding's file to the sub-task that modified it:
```
For each finding with file:line reference:
  1. Check git blame or sub-task comments for file ownership
  2. Map finding to the responsible sub-task
  3. Group all findings by sub-task ID
```

### 2. Prepare Feedback in Structured Output

Include feedback comments in the `feedbackComments` field of the structured output. The mobius loop will create these comments via SDK:

```markdown
## Verification Feedback: NEEDS_REWORK

### Issues Found

**Critical** (must fix):
- {issue with file:line reference}

**Important** (should fix):
- {issue description}

### Recommended Fixes
{Specific guidance from review agents}

### Re-verification
After addressing these issues, the verification gate will automatically re-run when all implementation sub-tasks are complete again.

---
*Feedback from verify-issue multi-agent review*
```

### 3. Include Status Transitions in Structured Output

The structured output `failingSubtasks` field tells the mobius loop which sub-tasks need to be moved back to "To Do" / "Backlog" status. The loop handles the actual status transitions via SDK.

### 4. Document Rework Iteration

Include the rework iteration count in the structured output's `reworkIteration` field. The mobius loop tracks this and handles escalation after `max_rework_iterations` (default 3) cycles.

### Loop Continuation

The loop continues naturally after processing the structured output:
1. Mobius loop parses structured output
2. Reopens failing sub-tasks via SDK
3. Posts feedback comments via SDK
4. Loop polls for ready tasks
5. Picks up reopened sub-tasks
6. Executes them via execute-issue
7. When all implementation sub-tasks Done, verification sub-task unblocks
8. Verification runs again

**Max Iterations**: After `max_rework_iterations` (default 3) rework cycles, include `escalation` in structured output:
- Escalation reason and history
- The loop will add "escalation-needed" label
- Loop stops with escalation notification

### On PASS or PASS_WITH_NOTES

Include in structured output:
1. `status: PASS` or `status: PASS_WITH_NOTES`
2. `criteriaResults` with all criteria evaluations
3. `reviewComment` with full verification report

The mobius loop will:
1. Mark verification sub-task Done via SDK
2. Post verification report to parent issue as comment
3. Parent can now be completed (no longer blocked by verification sub-task)
</rework_loop>

<review_report_phase>
<report_structure>
Generate a structured review report:

```markdown
## Verification Report: {Issue ID}

### Summary
**Overall Status**: PASS / PASS_WITH_NOTES / NEEDS_WORK / FAIL
**Criteria Met**: X of Y
**Tests**: PASS / FAIL
**Typecheck**: PASS / FAIL

### Acceptance Criteria Evaluation
| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | ... | PASS | ... |
| 2 | ... | PARTIAL | ... |

### Verification Checks
- Tests: X passed, Y failed
- Typecheck: {status}
- Lint: {status}

### Implementation Review

**What was done well**:
- {positive observation 1}
- {positive observation 2}

**Critical Issues** (must fix before closing):
- {issue 1}
- {issue 2}

**Important Issues** (should address):
- {issue 1}
- {issue 2}

**Suggestions** (consider for future):
- {suggestion 1}
- {suggestion 2}

### Files Reviewed
- `{file1}` - {summary}
- `{file2}` - {summary}

### Recommendation
{APPROVE / REQUEST_CHANGES / DISCUSS}

{Closing summary with next steps}
```
</report_structure>

<status_definitions>
**Overall Status meanings**:

| Status | Meaning | Action |
|--------|---------|--------|
| PASS | All criteria met, tests pass, no issues | Close issue |
| PASS_WITH_NOTES | Criteria met with minor suggestions | Close issue, optionally address suggestions |
| NEEDS_WORK | Some criteria not met or tests fail | Keep open, address issues |
| FAIL | Critical issues or many criteria not met | Keep open, major rework needed |

**Recommendation meanings**:

| Recommendation | Meaning |
|----------------|---------|
| APPROVE | Ready to close, no blocking issues |
| REQUEST_CHANGES | Issues need resolution before closing |
| DISCUSS | Ambiguities need team input |
</status_definitions>
</review_report_phase>

<ticket_update_phase>
<post_review_comment>
Include the review as the `reviewComment` field in the structured output. The mobius loop will post it to the parent issue via SDK:

```markdown
## Verification Review

**Status**: {PASS/PASS_WITH_NOTES/NEEDS_WORK/FAIL}
**Recommendation**: {APPROVE/REQUEST_CHANGES/DISCUSS}

### Acceptance Criteria
{criteria evaluation matrix}

### Checks
- Tests: {status}
- Typecheck: {status}

### Findings
{condensed findings - critical issues and important issues}

### Next Steps
{clear action items}

---
*Automated verification by verify-issue*
```
</post_review_comment>

<update_issue_status>
The structured output `status` field determines what the mobius loop does:

**If PASS or PASS_WITH_NOTES**:
The mobius loop will:
- Move verification sub-task to "Done" via SDK
- Post reviewComment to parent issue via SDK

**If NEEDS_WORK or FAIL**:
The mobius loop will:
- Move failing sub-tasks back to "To Do" / "Backlog" via SDK
- Post feedback comments to failing sub-tasks via SDK
- Verification sub-task remains "In Progress"

The structured output drives all status transitions - no direct MCP/SDK calls from this skill.
</update_issue_status>

<update_local_context>
**CRITICAL: After verification completes, update the local context files.**

The local context files must be updated so that `mobius sync` can push changes to Linear/Jira.

**Files to update**:

1. **Verification task file**: `~/.mobius/issues/{parentId}/tasks/{verificationTaskId}.json`
   - On PASS/PASS_WITH_NOTES: Change `"status": "in_progress"` to `"status": "done"`
   - On NEEDS_WORK/FAIL: Keep `"status": "in_progress"`

2. **Failing sub-task files** (on NEEDS_WORK/FAIL): `~/.mobius/issues/{parentId}/tasks/{failingTaskId}.json`
   - Change `"status": "done"` back to `"status": "pending"` for each failing sub-task

3. **Main context file**: `~/.mobius/issues/{parentId}/context.json`
   - Update the `verificationTask.status` field accordingly
   - For failing sub-tasks, update their status in the `subTasks` array to `"pending"`
   - Update `metadata.updatedAt` to current ISO-8601 timestamp

**Example using Edit tool for PASS**:

```
# Update verification task file
Edit ~/.mobius/issues/MOB-161/tasks/MOB-186.json
  old_string: "status": "in_progress"
  new_string: "status": "done"

# Update context.json - verification task status
Edit ~/.mobius/issues/MOB-161/context.json
  old_string: [find verificationTask block with "status": "in_progress"]
  new_string: [same block with "status": "done"]

# Update the updatedAt timestamp
Edit ~/.mobius/issues/MOB-161/context.json
  old_string: "updatedAt": "2026-01-28T19:05:00.000Z"
  new_string: "updatedAt": "{current ISO-8601 timestamp}"
```

**Example using Edit tool for NEEDS_WORK**:

```
# Reopen failing sub-task files
Edit ~/.mobius/issues/MOB-161/tasks/MOB-177.json
  old_string: "status": "done"
  new_string: "status": "pending"

# Update context.json - reopen failing sub-tasks in subTasks array
Edit ~/.mobius/issues/MOB-161/context.json
  old_string: [find the failing subtask block with "status": "done"]
  new_string: [same block with "status": "pending"]

# Update the updatedAt timestamp
Edit ~/.mobius/issues/MOB-161/context.json
  old_string: "updatedAt": "2026-01-28T19:05:00.000Z"
  new_string: "updatedAt": "{current ISO-8601 timestamp}"
```

**Why this matters**:
- The `mobius sync` command reads local context files and pushes changes to Linear/Jira
- Without updating these files, verification status changes won't propagate to the issue tracker
- The structured YAML output alone is not sufficient - local files MUST be updated
- Reopening failing sub-tasks in local files ensures the loop correctly picks them up again
</update_local_context>
</ticket_update_phase>

<completion_report>
<report_format>
Output a summary for the user:

```markdown
# Verification Complete

## Issue: {ID} - {Title}

**Status**: {PASS/PASS_WITH_NOTES/NEEDS_WORK/FAIL}
**Recommendation**: {APPROVE/REQUEST_CHANGES/DISCUSS}

### Summary
- Acceptance Criteria: {X of Y} met
- Tests: {status}
- Typecheck: {status}
- Lint: {status}

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
If critical or important issues are found that won't be fixed immediately, include them in the structured output's `followUpIssues` field. The mobius loop can create these via SDK:

```yaml
followUpIssues:
  - title: "Technical debt: Refactor X for performance"
    description: |
      Discovered during verification of MOB-161.
      The current implementation works but could be optimized.
    labels: ["follow-up", "tech-debt"]
    relatedTo: "MOB-161"
```

Link follow-up issues in the verification comment.
</follow_up_issues>

<status_markers>
**IMPORTANT**: The structured output `status` field at the end of execution determines the outcome.

**Valid status values**:
- `PASS` - All criteria met, verification sub-task will be marked Done
- `PASS_WITH_NOTES` - Criteria met with suggestions, verification sub-task will be marked Done
- `NEEDS_WORK` - Issues found, failing sub-tasks will be reopened
- `FAIL` - Critical issues, failing sub-tasks will be reopened
- `ALL_BLOCKED` - Not all implementation sub-tasks are Done

The mobius loop parses the structured YAML/JSON output to determine execution results and take appropriate actions.
</status_markers>
</completion_report>

<examples>
<pass_example>
**Input**: `/verify PROJ-100`

**Issue**: PROJ-100 - Add dark mode support

**Findings**:
- All 5 acceptance criteria met
- Tests pass (12 new tests added)
- Typecheck clean
- Code follows existing patterns

**Output**:
```markdown
## Verification Review

**Status**: PASS
**Recommendation**: APPROVE

### Acceptance Criteria
| # | Criterion | Status |
|---|-----------|--------|
| 1 | Theme follows system preference by default | PASS |
| 2 | Settings screen has theme toggle | PASS |
| 3 | All text maintains 4.5:1 contrast ratio | PASS |
| 4 | Theme preference persists across restarts | PASS |
| 5 | No flash of wrong theme on launch | PASS |

### Checks
- Tests: 12 passed, 0 failed
- Typecheck: PASS

### What was done well
- Clean separation of theme logic into ThemeProvider
- Comprehensive test coverage for all modes
- Proper localStorage persistence

All criteria met. Ready to close.
```
</pass_example>

<needs_work_example>
**Input**: `/verify PROJ-200`

**Issue**: PROJ-200 - Fix schedule deactivation error

**Findings**:
- 2 of 3 acceptance criteria met
- Tests pass but missing edge case coverage
- Typecheck clean
- Missing error handling for concurrent deactivation

**Output**:
```markdown
## Verification Review

**Status**: NEEDS_WORK
**Recommendation**: REQUEST_CHANGES

### Acceptance Criteria
| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | User can deactivate without error | PASS | Works for single user |
| 2 | Schedule status updates to inactive | PASS | Verified |
| 3 | Team members see status change | PARTIAL | No sync test, potential race condition |

### Checks
- Tests: 8 passed, 0 failed
- Typecheck: PASS

### Critical Issues
- No handling for concurrent deactivation attempts
- Missing PowerSync conflict resolution

### Next Steps
1. Add optimistic locking or conflict resolution
2. Add multi-user test for sync scenario
3. Re-verify after changes
```
</needs_work_example>
</examples>

<anti_patterns>
**Don't skip code review**:
- BAD: Only run tests without reading the code
- GOOD: Review implementation against each acceptance criterion

**Don't be superficial**:
- BAD: "Tests pass, looks good"
- GOOD: Thorough analysis of correctness, completeness, quality

**Don't nitpick on style**:
- BAD: Flag every style preference as an issue
- GOOD: Focus on correctness, completeness, and maintainability

**Don't approve incomplete work**:
- BAD: "2 of 5 criteria met, but PASS"
- GOOD: NEEDS_WORK until all criteria are addressed

**Don't skip the ticket comment**:
- BAD: Tell user the results but don't post to ticket
- GOOD: Always document verification on the ticket

**Don't forget to check sub-tasks**:
- BAD: Only verify parent issue
- GOOD: Verify all sub-tasks are complete before overall review

**Don't skip local context updates**:
- BAD: Only output structured YAML without updating `~/.mobius/issues/` files
- BAD: Mark verification complete but forget to update task JSON files
- BAD: Reopen failing sub-tasks in output but not in local files
- GOOD: Update both task-specific JSON and main context.json after verification
- GOOD: Update `metadata.updatedAt` timestamp when modifying context
</anti_patterns>

<success_criteria>
A successful verification achieves:

**Configuration & Setup**:
- [ ] Backend detected from config (linear or jira)
- [ ] Verification config loaded (coverage_threshold, max_rework_iterations, etc.)
- [ ] Coverage threshold configurable (default 80%)

**Context Gathering** (AC 1, 2):
- [ ] verify-issue receives verification sub-task ID as input (from mobius loop)
- [ ] Parent issue identified from the verification sub-task
- [ ] Full parent issue context loaded (description, criteria, comments)
- [ ] All sibling implementation sub-tasks collected and analyzed
- [ ] Aggregated context from parent AND all implementation sub-tasks
- [ ] All modified files identified across implementation sub-tasks

**Quality Gate Dimensions** (evaluated during review):
- [ ] Testing (all tests pass, coverage >= threshold)
- [ ] Code structure (best practices, no code smells)
- [ ] Performance (no regressions identified)
- [ ] Security (no vulnerabilities found)
- [ ] Business logic correctness (matches requirements)
- [ ] User story satisfaction (solves user's problem)

**Multi-Agent Review**:
- [ ] All 4 specialized review agents spawned in parallel (multi-agent verification)
- [ ] Agent 1: Bug & Logic Detection completed
- [ ] Agent 2: Code Structure & Best Practices completed
- [ ] Agent 3: Performance & Security completed
- [ ] Agent 4: Test Quality & Coverage completed
- [ ] Multi-grader aggregation computed overall status

**Verification Checks**:
- [ ] Tests executed and results captured
- [ ] Coverage threshold evaluated against configurable value
- [ ] Typecheck and lint run
- [ ] CI/CD status checked

**Criteria Evaluation**:
- [ ] Each acceptance criterion evaluated with evidence
- [ ] Findings categorized (Critical, Important, Suggestions, Questions)

**Rework Loop** (AC 6, 7, 9 - on FAIL/NEEDS_WORK):
- [ ] Findings mapped to responsible sub-tasks
- [ ] Failing sub-tasks receive detailed feedback comments with file:line references
- [ ] Failing sub-tasks moved back to "To Do" status
- [ ] Rework iteration count tracked (up to max_rework_iterations)
- [ ] Rework iteration documented on verification sub-task
- [ ] Loop continues naturally (reopened tasks picked up by normal polling)

**Completion** (AC 8 - on PASS/PASS_WITH_NOTES):
- [ ] Verification sub-task marked Done when quality checks pass
- [ ] Verification report posted to parent issue
- [ ] Parent issue unblocked for completion (no longer blocked by verification sub-task)

**Local Context Updates**:
- [ ] **Local context files updated** (`~/.mobius/issues/{parentId}/` task and context.json)
- [ ] Verification task status updated in local files (to "done" on PASS, stays "in_progress" on FAIL)
- [ ] Failing sub-task statuses reverted to "pending" in local files (on NEEDS_WORK/FAIL)
- [ ] `metadata.updatedAt` timestamp updated in context.json

**Reporting**:
- [ ] Structured review report generated
- [ ] Review comment posted to ticket
- [ ] Clear next steps communicated to user
</success_criteria>
