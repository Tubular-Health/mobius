---
name: pr
description: Fully autonomous PR creation skill. Creates structured pull requests with human and agent context sections. Designed for non-interactive use with `claude -p`.
invocation: /pr
---

<objective>
Autonomously create well-structured pull requests using `gh pr create` that optimize for both human reviewers and AI/agent consumers. The PR format follows conventional commits for titles (critical for release-please) and includes a collapsible agent context section for machine parsing.
</objective>

<autonomous_mode>
**THIS SKILL IS FULLY AUTONOMOUS - NO USER INPUT ALLOWED**

This skill is designed for non-interactive execution with `claude -p`. It MUST:
- **NEVER** use `AskUserQuestion` tool or prompt the user for confirmation
- **NEVER** show a preview and wait for approval
- **ALWAYS** make all decisions about type, scope, and content without asking
- **ALWAYS** proceed directly to PR creation after gathering context

All decisions are inferred automatically: type (from branch/commits/files), scope (from file paths), summary (from diff analysis), test plan (from test files). If any information is ambiguous, use sensible defaults and proceed.

If pre-flight checks fail (no commits, branch not pushed, PR exists), report the issue and exit gracefully.
</autonomous_mode>

<structured_output>
**This skill outputs structured data for the mobius loop to parse.**

At the END of your response, output a YAML block with the PR creation result.

```yaml
---
status: PR_CREATED  # PR_CREATED | PR_EXISTS | PR_FAILED | NO_CHANGES
timestamp: "2026-01-28T12:00:00Z"

# For PR_CREATED:
prUrl: "https://github.com/owner/repo/pull/123"
prNumber: 123
prTitle: "feat(scope): description"
prBase: "main"
prHead: "feature-branch"
isDraft: false
linkedIssues:
  - identifier: "MOB-72"
    validated: true
    title: "Issue title if known"
backend: linear  # or jira

# For PR_EXISTS:
existingPrUrl: "https://github.com/owner/repo/pull/100"
existingPrNumber: 100

# For PR_FAILED:
errorType: "no_commits"  # no_commits | not_pushed | auth_failed | gh_error
errorMessage: "Description of failure"
---
```

Output MUST be valid YAML, appear at the END of response, include `status` and `timestamp`, and include `linkedIssues` for all detected issue IDs.
</structured_output>

<quick_start>
<invocation>
```
/pr                    # Create PR with auto-detected context
/pr --draft            # Create as draft PR
/pr --base develop     # Target a specific base branch
```
</invocation>

<workflow>
1. **Pre-flight checks** - Verify commits exist, branch pushed, no existing PR
2. **Detect current state** - Get branch name, base branch, changed files
3. **Parse issue references** - Extract from branch name and commit messages
4. **Validate issues** - If local context available, validate issues from context file
5. **Gather changes** - Get file list and diff statistics
6. **Infer PR type** - Autonomously determine feat/fix/refactor from changes
7. **Generate PR content** - Title, summary, changes, test plan, agent context
8. **Execute creation** - Run `gh pr create` with formatted body (no confirmation)
9. **Output structured data** - Include issue linking data for mobius loop
10. **Report result** - Show PR URL, detected issues, and next steps
</workflow>
</quick_start>

<backend_detection>
Read `~/.config/mobius/config.yaml` or `mobius.config.yaml` in the project root. Default to `linear` if unspecified.

**Issue ID formats** (both Linear and Jira): `MOB-123`, `PROJ-456` — regex: `/^[A-Z]{2,10}-\d+$/`

**Validation via local context**: If `MOBIUS_CONTEXT_FILE` is set, read issue details from that file. Otherwise, proceed without validation.

Linking output is handled via structured output (see `<structured_output>`). This skill does NOT call issue tracker APIs directly.
</backend_detection>

<issue_linking>
Link PR to issue tracker when issue references are detected from branch name, commits, or user input. Do NOT block PR creation if no issues found.

**Validation**: If `MOBIUS_CONTEXT_FILE` is set, read parent issue details for enhanced PR context. If unavailable, warn and continue — include issue ID in `Refs:` anyway.

**Linking workflow**: After PR creation, output structured data with `linkedIssues` array. The mobius loop parses this and executes linking via SDK. This skill does NOT directly call issue tracker APIs.

**If no local context**: Warn "Could not validate issue {ID} - no local context". Include detected IDs in structured output. Running standalone, provide manual linking instructions.
</issue_linking>

<context_gathering>
<detect_branch>
```bash
# Current branch
git branch --show-current

# Base branch
git remote show origin | grep 'HEAD branch' | cut -d: -f2 | xargs
```

**Branch name patterns for issue detection**:
- `drverzal/mob-123-feature-description` -> `MOB-123`
- `feature/PROJ-456-add-login` -> `PROJ-456`
- `fix/123-bug-description` -> `#123`
</detect_branch>

<parse_issue_references>
**From branch name** (primary, case-insensitive, normalize to uppercase):
```
/([A-Z]{2,10}-\d+)/gi
```

**From commit messages** (secondary):
```bash
git log origin/main..HEAD --pretty=format:"%s%n%b"
```
Look for: `Refs: MOB-123`, `Closes #456`, `Implements: PROJ-789`, `Part-of: MOB-100`
</parse_issue_references>

<gather_changes>
```bash
git diff --name-only origin/main...HEAD   # Changed files
git diff --stat origin/main...HEAD        # Diff stats
git diff origin/main...HEAD              # Full diff
git log --oneline origin/main..HEAD      # Commit history
```
</gather_changes>
</context_gathering>

<pr_type_inference>
Infer type and scope from changes. Never ask user for clarification.

**Type detection priority**:
1. Explicit type in branch name: `fix/mob-123` -> `fix`
2. Commit message prefixes: `feat: add login` -> `feat`
3. File pattern analysis: new `src/` files -> `feat`, test only -> `test`, docs only -> `docs`, config -> `build`/`ci`
4. Default: `feat` for new code, `fix` for modifications

**Scope detection**: Infer from file paths (`src/components/*` -> `ui`, `src/api/*` -> `api`, `.claude/skills/*` -> `skills`, `packages/{name}/*` -> package name). Omit if changes span multiple areas.
</pr_type_inference>

<pr_template>
<title_format>
**Conventional commit format** (critical for release-please):
```
<type>(<scope>): <description>
```
Rules: imperative mood, under 72 chars, no issue numbers in title, scope optional.
</title_format>

<body_format>
```markdown
## Summary
[1-2 sentence overview - what changed and why]

## Changes
- [Bullet point describing change 1]
- [Bullet point describing change 2]
- [Bullet point describing change 3]

## Test Plan
- [ ] [How to verify change 1]
- [ ] [How to verify change 2]

Refs: {ISSUE-ID}

---

<details>
<summary>Agent Context</summary>

### Files Changed
- `path/to/file1.ts` - [brief description of change]
- `path/to/file2.ts` - [brief description of change]

### Intent
[Why this change was made - connects to issue context and broader goals]

### Dependencies
- **Provides**: [What this PR exports/enables for other code]
- **Consumes**: [What this PR depends on]
- **Affects**: [What existing functionality this might impact]

</details>
```
</body_format>

<section_guidelines>
- **Summary**: Lead with user/developer impact. Answer "What does this PR accomplish?"
- **Changes**: One bullet per logical change, start with verb, be specific
- **Test Plan**: Include automated commands and manual verification steps
- **Refs**: `Refs:` for Linear/Jira, `Closes:`/`Fixes:` for GitHub issues (auto-closes)
- **Agent Context**: Always in `<details>` tag. Include file paths, intent ("why"), and dependency analysis
</section_guidelines>
</pr_template>

<issue_detection>
**Linear/Jira style**: `/\b([A-Z]{2,10}-\d+)\b/g` — matches `MOB-123`, `PROJ-456`
**GitHub style**: `/\b#(\d+)\b/g`
**Commit trailers**: `/^(Refs|Closes|Fixes|Implements|Part-of):\s*(.+)$/gm`

**Branch parsing**: Split by `/`, search segments for patterns (case-insensitive), normalize to uppercase. Examples: `drverzal/mob-72-add-pr-skill` -> `MOB-72`

**Commit scanning**:
```bash
git log origin/main..HEAD --pretty=format:"%B" | grep -oiE "[A-Z]{2,10}-[0-9]+" | tr '[:lower:]' '[:upper:]' | sort -u
```
Deduplicate and combine with branch-detected issues.
</issue_detection>

<examples>
<feature_pr_example>
**Branch**: `drverzal/mob-45-add-oauth-login`
**Commits**: `feat(auth): add OAuth2 provider configuration`, `feat(auth): implement Google login flow`, `test(auth): add OAuth integration tests`

**Generated PR**:
```markdown
Title: feat(auth): add OAuth2 login with Google provider

## Summary
Add OAuth2 authentication support enabling users to sign in with their Google accounts, reducing friction in the login flow.

## Changes
- Add OAuth2 provider configuration in `src/config/auth.ts`
- Implement Google login flow with token handling
- Add callback route for OAuth redirect
- Add integration tests for OAuth flow

## Test Plan
- [ ] Run `npm test` - all tests pass
- [ ] Manual: Click "Sign in with Google" on login page
- [ ] Manual: Complete OAuth flow, verify redirect to dashboard

Refs: MOB-45

---

<details>
<summary>Agent Context</summary>

### Files Changed
- `src/config/auth.ts` - OAuth provider configuration
- `src/routes/auth/callback.ts` - OAuth callback handler
- `src/components/LoginButton.tsx` - Updated with provider selection
- `src/services/oauth.ts` - New OAuth service
- `tests/auth/oauth.test.ts` - Integration tests

### Intent
Implements OAuth2 authentication as part of the enterprise SSO initiative (MOB-45).

### Dependencies
- **Provides**: OAuth login capability, GoogleAuthProvider
- **Consumes**: Existing auth context, session management
- **Affects**: Login page, user profile display

</details>
```
</feature_pr_example>
</examples>

<draft_pr_handling>
Create as draft when `/pr --draft` is passed. Use `gh pr create --draft`. Mark ready later with `gh pr ready {pr-number}`.
</draft_pr_handling>

<error_handling>
<pre_flight_checks>
Before PR creation, check:
1. **Commits exist**: `git log origin/main..HEAD --oneline`
2. **Branch pushed**: `git ls-remote --heads origin {branch}`
3. **No existing PR**: `gh pr list --head {branch}`
4. **gh authenticated**: `gh auth status`

If any check fails, report the issue with fix command and exit gracefully.
</pre_flight_checks>

<common_errors>

| Error | Solution |
|-------|----------|
| No commits between branches | Ensure changes are committed |
| Remote branch not found | `git push -u origin {branch}` |
| PR already exists | Show existing PR URL, exit gracefully |
| gh auth required | Run `gh auth login` |
</common_errors>
</error_handling>

<edge_cases>

| Edge Case | Behavior |
|-----------|----------|
| No issue ID in branch/commits | Create PR without issue linking, omit `Refs:` line |
| Multiple issue IDs found | Deduplicate, validate each, include all in `Refs:` and structured output |
| No changes detected | Report "no changes", do NOT create empty PR |
| PR already exists | Show existing PR URL, exit gracefully |
| Lowercase issue IDs in branch | Use case-insensitive matching, normalize to uppercase (e.g., `mob-72` -> `MOB-72`) |
</edge_cases>

<anti_patterns>
- Don't put issue numbers in title — use `Refs:` in body
- Don't use vague titles like "Update code" — be specific
- Don't skip the test plan — always include verification steps
- Don't write prose in Changes — use bullet points with verbs
- Don't forget agent context — include collapsible section with files/intent
- Don't ask for user input — infer everything and proceed directly
- Don't create duplicate PRs — detect existing PR first
</anti_patterns>

<success_criteria>
- [ ] Pre-flight checks pass (commits, branch pushed, no duplicate PR, gh auth)
- [ ] Issue references detected case-insensitively and normalized to uppercase
- [ ] Issues validated from local context if `MOBIUS_CONTEXT_FILE` set
- [ ] PR title in conventional commit format with inferred type/scope
- [ ] PR body has summary, changes, test plan, refs, and collapsible agent context
- [ ] PR created directly with `gh pr create` (no user confirmation)
- [ ] Structured YAML output at end of response with issue linking data
- [ ] PR URL reported to user
- [ ] Draft mode used when `--draft` flag passed
- [ ] Graceful exit on pre-flight failures
</success_criteria>
