---
name: verify-issue
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
**FIRST**: Detect the backend from mobius config before proceeding.

Read `~/.config/mobius/config.yaml` or `mobius.config.yaml` in the project root:

```yaml
backend: linear  # or 'jira'
```

**Default**: If no backend is specified, default to `linear`.

The detected backend determines which MCP tools to use throughout this skill. All subsequent tool references use the backend-specific tools from the `<backend_context>` section below.
</backend_detection>

<backend_context>
<linear>
**MCP Tools for Linear**:

- **Fetch issue**: `mcp__plugin_linear_linear__get_issue`
  - Parameters: `id` (issue ID), `includeRelations` (boolean)
  - Returns: Issue with status, description, acceptance criteria

- **List comments**: `mcp__plugin_linear_linear__list_comments`
  - Parameters: `issueId`
  - Returns: Array of comments with implementation notes

- **List sub-tasks**: `mcp__plugin_linear_linear__list_issues`
  - Parameters: `parentId`, `includeArchived`
  - Returns: Array of child issues with status

- **Add comment**: `mcp__plugin_linear_linear__create_comment`
  - Parameters: `issueId`, `body` (markdown)
  - Use for: Posting verification report

- **Update status**: `mcp__plugin_linear_linear__update_issue`
  - Parameters: `id`, `state` (e.g., "Done"), `labels` (optional)
  - Use for: Marking issue as Done if verified, or adding "needs-revision" label

- **Create follow-up issue**: `mcp__plugin_linear_linear__create_issue`
  - Parameters: `team`, `title`, `description`, `labels`, `relatedTo`
  - Use for: Creating follow-up issues for discovered problems
</linear>

<jira>
**MCP Tools for Jira**:

- **Fetch issue**: `mcp__plugin_jira_jira__get_issue`
  - Parameters: `issueIdOrKey` (e.g., "PROJ-123")
  - Returns: Issue with status, description, acceptance criteria

- **List comments**: `mcp__plugin_jira_jira__get_comments`
  - Parameters: `issueIdOrKey`
  - Returns: Array of comments with implementation notes

- **List sub-tasks**: `mcp__plugin_jira_jira__list_issues`
  - Parameters: `jql` (e.g., "parent = PROJ-123")
  - Returns: Array of child issues with status

- **Add comment**: `mcp__plugin_jira_jira__add_comment`
  - Parameters: `issueIdOrKey`, `body` (Jira wiki markup or markdown)
  - Use for: Posting verification report

- **Update status**: `mcp__plugin_jira_jira__transition_issue`
  - Parameters: `issueIdOrKey`, `transitionId` or `transitionName`
  - Use for: Transitioning to Done if verified

- **Create follow-up issue**: `mcp__plugin_jira_jira__create_issue`
  - Parameters: `projectKey`, `summary`, `description`, `issueType`, `labels`
  - Use for: Creating follow-up issues for discovered problems
</jira>
</backend_context>

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
2. **Fetch issue context** - Get title, description, acceptance criteria, comments, sub-tasks
3. **Analyze implementation** - Review recent commits, changed files, code
4. **Run verification checks** - Tests, typecheck, lint
5. **Compare against criteria** - Check each acceptance criterion
6. **Critique implementation** - Identify issues, improvements, concerns
7. **Generate review report** - Structured analysis with findings
8. **Post to ticket** - Add review as comment on the issue
9. **Report status** - Summary with pass/fail and recommendations
</workflow>
</quick_start>

<issue_context_phase>
<fetch_issue>
First, retrieve full issue details using the backend-appropriate fetch tool.

Extract:
- **Title and description**: What was supposed to be built
- **Acceptance criteria**: Checklist of requirements (look for checkbox patterns)
- **Labels**: Bug/Feature/Improvement for context
- **Priority**: Urgency level
- **Related issues**: Context from connected work
</fetch_issue>

<fetch_comments>
Get implementation context from comments using the backend-appropriate list comments tool.

Look for:
- Implementation notes from execute-issue
- Design decisions or constraints
- Questions or clarifications
- Commit references
</fetch_comments>

<fetch_subtasks>
If issue has sub-tasks, get their status using the backend-appropriate list sub-tasks tool.

Verify:
- All sub-tasks are in "Done" or "In Progress" (ready for review) state
- No sub-tasks are still blocked or in Backlog
- Each sub-task has completion comments
</fetch_subtasks>

<context_summary>
Build verification context:

```markdown
# Verification Context

## Issue: {ID} - {Title}
**Type**: {Bug/Feature/Improvement}
**Priority**: {level}

## Description
{Full description}

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Sub-tasks
| ID | Title | Status | Files Modified |
|----|-------|--------|----------------|
| ... | ... | ... | ... |

## Implementation Notes (from comments)
{Key decisions, constraints, commit references}
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

<critique_phase>
<thorough_critique>
Perform a thorough critique covering:

**Correctness**:
- Does the code do what it's supposed to?
- Are there logic errors or off-by-one bugs?
- Are edge cases handled?

**Completeness**:
- Are all acceptance criteria addressed?
- Is there missing functionality?
- Are error states handled?

**Code Quality**:
- Does it follow codebase patterns?
- Is it readable and maintainable?
- Are there code smells or anti-patterns?

**Test Quality**:
- Is there adequate test coverage?
- Do tests verify behavior, not just run code?
- Are edge cases tested?

**Performance**:
- Any obvious performance issues?
- N+1 queries, unnecessary loops, memory leaks?

**Security** (if applicable):
- Input validation?
- Authorization checks?
- Sensitive data handling?
</thorough_critique>

<identify_improvements>
Categorize findings:

**Critical Issues** (must fix):
- Bugs that break functionality
- Missing critical acceptance criteria
- Security vulnerabilities

**Important Issues** (should fix):
- Missing edge case handling
- Incomplete test coverage
- Code quality concerns

**Suggestions** (nice to have):
- Refactoring opportunities
- Performance optimizations
- Documentation improvements

**Questions** (need clarification):
- Ambiguous requirements
- Design decisions to verify
- Edge cases not specified
</identify_improvements>
</critique_phase>

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
Add the review as a comment on the issue using the backend-appropriate add comment tool:

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
Based on review outcome:

**If PASS or PASS_WITH_NOTES**:
Use the backend-appropriate update status tool to move the issue to "Done".

**If NEEDS_WORK or FAIL**:
Leave in current state. The comment documents what needs to be addressed.

Optionally add labels (if supported by backend):
- Add "needs-revision" label for issues that need more work
</update_issue_status>
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
If critical or important issues are found that won't be fixed immediately, use the backend-appropriate create issue tool to create follow-up issues.

Include:
- Clear title describing the issue
- Reference to the original issue in the description
- Appropriate labels (e.g., "follow-up")
- Related issue link

Link follow-up issues in the verification comment.
</follow_up_issues>
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
</anti_patterns>

<success_criteria>
A successful verification achieves:

- [ ] Backend detected from config
- [ ] Full issue context loaded (description, criteria, comments, sub-tasks)
- [ ] All sub-tasks verified as complete
- [ ] Recent commits and changed files analyzed
- [ ] Code reviewed against acceptance criteria
- [ ] Tests executed and results captured
- [ ] Typecheck and lint run
- [ ] Each acceptance criterion evaluated with evidence
- [ ] Thorough critique with categorized findings
- [ ] Structured review report generated
- [ ] Review comment posted to ticket
- [ ] Issue status updated appropriately
- [ ] Follow-up issues created if needed
- [ ] Clear next steps communicated to user
</success_criteria>
