---
name: pr
description: Fully autonomous PR creation skill. Creates structured pull requests with human and agent context sections. Designed for non-interactive use with `claude -p`.
invocation: /pr
---

<objective>
Autonomously create well-structured pull requests using `gh pr create` that optimize for both human reviewers and AI/agent consumers. The PR format follows conventional commits for titles (critical for release-please) and includes a collapsible agent context section for machine parsing.

**CRITICAL: This skill is fully autonomous and MUST NOT use AskUserQuestion or request any user input.**

Key behaviors:
- Auto-detect issue references from branch name and commits
- Autonomously infer PR type and scope from changes
- Generate PR title in conventional commit format
- Create human-readable summary, changes, and test plan sections
- Include collapsible agent context with file list and intent
- Execute `gh pr create` directly without confirmation
</objective>

<autonomous_mode>
**THIS SKILL IS FULLY AUTONOMOUS - NO USER INPUT ALLOWED**

This skill is designed for non-interactive execution with `claude -p`. It MUST:
- **NEVER** use `AskUserQuestion` tool
- **NEVER** prompt the user for confirmation
- **NEVER** show a preview and wait for approval
- **ALWAYS** make autonomous decisions about type, scope, and content
- **ALWAYS** proceed directly to PR creation after gathering context

If pre-flight checks fail (no commits, branch not pushed, PR exists), report the issue
and exit gracefully - do not prompt for user action.
</autonomous_mode>

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
4. **Validate issues** - If issues detected, validate they exist via backend MCP tools
5. **Gather changes** - Get file list and diff statistics
6. **Infer PR type** - Autonomously determine feat/fix/refactor from changes
7. **Generate PR content** - Title, summary, changes, test plan, agent context
8. **Execute creation** - Run `gh pr create` with formatted body (no confirmation)
9. **Link to issues** - Add PR link and comment to detected issues
10. **Report result** - Show PR URL, issue links, and next steps
</workflow>
</quick_start>

<backend_detection>
**Detect the issue tracker backend** before attempting to link PRs to issues.

Read `~/.config/mobius/config.yaml` or `mobius.config.yaml` in the project root:

```yaml
backend: linear  # or 'jira'
```

**Default**: If no backend is specified, default to `linear`.

The detected backend determines which MCP tools to use for issue linking. See `<backend_context>` for available tools per backend.

**When backend detection is needed**:
- Issue references are detected from branch name or commits
- User wants to link PR back to issue tracker
- Validating issue existence before creating PR

**When backend detection can be skipped**:
- No issue references found
- User explicitly opts out of issue linking
</backend_detection>

<backend_context>
<linear>
**MCP Tools for Linear Issue Linking**:

- **Validate issue exists**: `mcp__plugin_linear_linear__get_issue`
  - Parameters: `id` (issue identifier, e.g., "MOB-123")
  - Returns: Issue details including title, description, status
  - Use before PR creation to validate issue reference is valid

- **Add PR link to issue**: `mcp__plugin_linear_linear__update_issue`
  - Parameters: `id` (issue identifier), `links` (array of link objects)
  - Link object format: `{ "url": "https://github.com/...", "title": "PR: Title here" }`
  - Attaches PR URL as an external link on the Linear issue

- **Add comment to issue**: `mcp__plugin_linear_linear__create_comment`
  - Parameters: `issueId`, `body` (markdown content)
  - Use to document that a PR was created for this issue
  - Example body: `"🔗 **PR Created**: [#123 - feat(auth): add OAuth login](https://github.com/...)"`

**Linear issue ID formats**:
- `MOB-123`, `PROJ-456`, `ABC-789` (uppercase prefix + number)
- Regex: `/^[A-Z]{2,10}-\d+$/`
</linear>

<jira>
**MCP Tools for Jira Issue Linking**:

- **Validate issue exists**: `mcp_plugin_atlassian_jira__get_issue`
  - Parameters: `issueIdOrKey` (e.g., "PROJ-123")
  - Returns: Issue details including summary, description, status
  - Use before PR creation to validate issue reference is valid

- **Add PR link to issue**: `mcp_plugin_atlassian_jira__add_link`
  - Parameters: `issueIdOrKey`, `url`, `title`
  - Adds the PR as a remote link (web link) on the Jira issue
  - Title format: `"PR #123: feat(auth): add OAuth login"`

- **Add comment to issue**: `mcp_plugin_atlassian_jira__add_comment`
  - Parameters: `issueIdOrKey`, `body` (Jira wiki markup or markdown)
  - Use to document that a PR was created for this issue
  - Example body: `"🔗 *PR Created*: [#123 - feat(auth): add OAuth login|https://github.com/...]"`

**Jira issue ID formats**:
- `PROJ-123`, `JIRA-456`, `KEY-789` (uppercase prefix + number)
- Regex: `/^[A-Z]{2,10}-\d+$/`
</jira>
</backend_context>

<issue_linking>
<when_to_link>
Link PR back to issue tracker when:
- Issue reference detected from branch name (e.g., `drverzal/mob-123-feature`)
- Issue reference found in commit messages
- User explicitly provides issue ID

**Do NOT attempt to link when**:
- No issue references detected
- Issue validation fails (invalid ID)
- Backend MCP tools are not available
</when_to_link>

<validation_step>
**Before creating PR**, validate that detected issue IDs exist:

```
For each detected issue ID:
1. Call backend-appropriate get_issue tool
2. If successful: Confirm issue exists, capture title for context
3. If failed: Warn user but continue with PR creation
```

**Linear validation**:
```
mcp__plugin_linear_linear__get_issue(id: "MOB-123")
```

**Jira validation**:
```
mcp_plugin_atlassian_jira__get_issue(issueIdOrKey: "PROJ-123")
```

If validation fails:
- Issue may not exist or may be private
- Warn user: "Could not validate issue MOB-123 - continuing without issue link"
- Do NOT block PR creation for validation failures
</validation_step>

<linking_workflow>
**After successful PR creation**, link back to issue tracker:

**Step 1: Add PR as link attachment**

For **Linear**:
```
mcp__plugin_linear_linear__update_issue(
  id: "MOB-123",
  links: [{
    url: "https://github.com/owner/repo/pull/456",
    title: "PR #456: feat(scope): description"
  }]
)
```

For **Jira**:
```
mcp_plugin_atlassian_jira__add_link(
  issueIdOrKey: "PROJ-123",
  url: "https://github.com/owner/repo/pull/456",
  title: "PR #456: feat(scope): description"
)
```

**Step 2: Add comment documenting PR creation**

For **Linear**:
```
mcp__plugin_linear_linear__create_comment(
  issueId: "MOB-123",
  body: "🔗 **Pull Request Created**\n\n[#456 - feat(scope): description](https://github.com/owner/repo/pull/456)\n\nReady for review."
)
```

For **Jira**:
```
mcp_plugin_atlassian_jira__add_comment(
  issueIdOrKey: "PROJ-123",
  body: "🔗 *Pull Request Created*\n\n[#456 - feat(scope): description|https://github.com/owner/repo/pull/456]\n\nReady for review."
)
```
</linking_workflow>

<linking_errors>
**Handle linking failures gracefully**:

If linking fails after PR is created:
- PR creation was successful - do NOT attempt to delete/undo
- Report the error to user
- Provide manual linking instructions

**Example error output**:
```markdown
## PR Created Successfully
URL: https://github.com/owner/repo/pull/456

⚠️ **Issue Linking Failed**
Could not link PR to MOB-123: [error message]

**Manual linking**:
1. Open https://linear.app/team/issue/MOB-123
2. Add link: https://github.com/owner/repo/pull/456
```

**Common linking errors**:
- Issue not found (deleted or wrong ID)
- Permission denied (private issue)
- MCP tool unavailable (backend not configured)
</linking_errors>
</issue_linking>

<context_gathering>
<detect_branch>
Get the current branch and determine the base branch:

```bash
# Current branch
git branch --show-current

# Default base branch (usually main or master)
git remote show origin | grep 'HEAD branch' | cut -d: -f2 | xargs

# Or use configured base
git config --get init.defaultBranch || echo "main"
```

**Branch name patterns for issue detection**:
- `drverzal/mob-123-feature-description` -> `MOB-123`
- `feature/PROJ-456-add-login` -> `PROJ-456`
- `fix/123-bug-description` -> `#123` (GitHub issue)
- `bugfix/jira-789` -> `JIRA-789`
</detect_branch>

<parse_issue_references>
**From branch name** (primary source):

Regex patterns to extract issue IDs:
```
# Linear/Jira style: MOB-123, PROJ-456, ABC-789 (case-insensitive)
/([A-Z]{2,10}-\d+)/gi

# GitHub issue style: #123 or refs/123
/#?(\d+)/g
```

**Note**: Branch names often contain lowercase issue IDs (e.g., `mob-72` instead of `MOB-72`).
Always use case-insensitive matching and normalize to uppercase for display.

**From commit messages** (secondary source):

```bash
# Get commits on this branch not in base
git log origin/main..HEAD --pretty=format:"%s%n%b"
```

Look for patterns:
- `Refs: MOB-123`
- `Closes #456`
- `Implements: PROJ-789`
- `Part-of: MOB-100`
</parse_issue_references>

<gather_changes>
**File changes**:
```bash
# Files changed vs base branch
git diff --name-only origin/main...HEAD

# Diff statistics
git diff --stat origin/main...HEAD

# Detailed diff for context
git diff origin/main...HEAD
```

**Commit history on branch**:
```bash
# Commits since branching from base
git log --oneline origin/main..HEAD
```
</gather_changes>
</context_gathering>

<pr_type_inference>
<type_detection>
Infer the PR type from changes and commit history:

| Indicator | Type | Example |
|-----------|------|---------|
| New files in `src/` | `feat` | Adding new component |
| Bug fix keywords in commits | `fix` | "fix", "bug", "issue" |
| Test files only | `test` | Adding test coverage |
| Docs files only | `docs` | README, documentation |
| Config/build files | `build` or `ci` | package.json, Dockerfile |
| Code restructuring | `refactor` | Moving/renaming without behavior change |
| Performance keywords | `perf` | "optimize", "performance" |

**Detection priority**:
1. Explicit type in branch name: `fix/mob-123` -> `fix`
2. Commit message prefixes: `feat: add login` -> `feat`
3. File pattern analysis (fallback)

**If uncertain**, default to `feat` for new features or `fix` for bug-related work.
</type_detection>

<scope_detection>
Infer scope from changed files:

| File Pattern | Suggested Scope |
|--------------|-----------------|
| `src/components/*` | component name or `ui` |
| `src/api/*` | `api` |
| `src/hooks/*` | `hooks` |
| `src/store/*` or `src/state/*` | `state` |
| `src/utils/*` | `utils` |
| `.claude/skills/*` | `skills` |
| `packages/{name}/*` | package name |

If changes span multiple areas, use the primary area or omit scope.
</scope_detection>
</pr_type_inference>

<pr_template>
<title_format>
**Conventional commit format** (critical for release-please):

```
<type>(<scope>): <description>
```

**Rules**:
- Use imperative mood: "add" not "added"
- Keep under 72 characters
- No issue numbers in title (put in body)
- Scope is optional but helpful

**Examples**:
- `feat(auth): add OAuth2 login with Google provider`
- `fix(cart): prevent duplicate items on double-click`
- `refactor(api): extract authentication middleware`
- `docs(readme): update installation instructions`
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
**Summary** (1-2 sentences):
- Lead with user/developer impact
- Answer: "What does this PR accomplish?"
- Avoid implementation details

**Changes** (bullet points):
- One bullet per logical change
- Start with verb: "Add", "Update", "Remove", "Fix"
- Be specific but concise
- Group by area if many changes

**Test Plan** (checkboxes):
- Include automated test commands
- Add manual verification steps
- Cover edge cases if applicable

**Refs** (issue references):
- Use `Refs:` for Linear/Jira issues
- Use `Closes:` or `Fixes:` for GitHub issues (auto-closes)
- Multiple refs: `Refs: MOB-123, MOB-124`

**Agent Context** (collapsible):
- Always in `<details>` tag to keep main view clean
- Files Changed: Explicit paths with descriptions
- Intent: The "why" for AI reviewers
- Dependencies: Impact analysis for automated tools
</section_guidelines>
</pr_template>

<issue_detection>
<patterns>
**Linear/Jira style** (uppercase project key):
```regex
/\b([A-Z]{2,10}-\d+)\b/g
```
Matches: `MOB-123`, `PROJ-456`, `JIRA-789`, `ABC-1`

**GitHub issue style**:
```regex
/\b#(\d+)\b/g
```
Matches: `#123`, `#456`

**In commit trailers**:
```regex
/^(Refs|Closes|Fixes|Implements|Part-of):\s*(.+)$/gm
```
Matches: `Refs: MOB-123`, `Closes: #456`
</patterns>

<branch_name_parsing>
Common branch naming conventions:

| Pattern | Example | Extracted |
|---------|---------|-----------|
| `user/KEY-123-desc` | `drverzal/mob-72-add-pr-skill` | `MOB-72` |
| `feature/KEY-123` | `feature/PROJ-456-login` | `PROJ-456` |
| `fix/KEY-123` | `fix/BUG-789-crash` | `BUG-789` |
| `type/123-desc` | `bugfix/123-fix-null` | `#123` |

**Extraction logic**:
1. Split branch name by `/`
2. Search each segment for issue patterns
3. Return first match (usually in second segment)
</branch_name_parsing>

<commit_scanning>
Scan commit messages for additional references:

```bash
# Get all commit messages on branch (case-insensitive, normalize to uppercase)
git log origin/main..HEAD --pretty=format:"%B" | grep -oiE "[A-Z]{2,10}-[0-9]+" | tr '[:lower:]' '[:upper:]' | sort -u
```

Deduplicate and combine with branch-detected issues.
</commit_scanning>
</issue_detection>

<execution_flow>
<step_1_gather_context>
```bash
# Get current branch
BRANCH=$(git branch --show-current)

# Get base branch
BASE=$(git config --get pr.base || echo "main")

# Check if remote branch exists
git ls-remote --exit-code --heads origin "$BRANCH" 2>/dev/null

# Get changed files
git diff --name-only origin/$BASE...HEAD

# Get commit log
git log --oneline origin/$BASE..HEAD
```
</step_1_gather_context>

<step_2_detect_issues>
Parse branch name and commits for issue references using patterns from `<issue_detection>`.

Build reference string:
- Primary issue from branch: `Refs: MOB-123`
- Additional issues from commits: `Refs: MOB-123, MOB-124`
</step_2_detect_issues>

<step_2b_validate_issues>
If issue references were detected, validate they exist before proceeding.

**For each detected issue ID**:

1. Read backend from `mobius.config.yaml` or `~/.config/mobius/config.yaml`
2. Call appropriate validation tool:
   - **Linear**: `mcp__plugin_linear_linear__get_issue(id: "MOB-123")`
   - **Jira**: `mcp_plugin_atlassian_jira__get_issue(issueIdOrKey: "PROJ-123")`
3. On success: Store issue title for enhanced PR context
4. On failure: Warn but continue - don't block PR creation

**Example validation output**:
```markdown
Detected issues:
- MOB-72: "Add PR skill for structured pull request creation" ✓
- MOB-123: Could not validate (issue may not exist) ⚠️
```

**Store validated issues** for use in:
- PR body `Refs:` section (confirmed references)
- Post-creation linking (only link confirmed issues)
</step_2b_validate_issues>

<step_3_infer_type_scope>
Autonomously analyze changes to determine:
- **Type**: feat, fix, docs, refactor, test, etc.
- **Scope**: Component/area affected

**Autonomous type inference priority** (DO NOT ask user):
1. Explicit type in branch name: `fix/mob-123` -> `fix`
2. Commit message prefixes: `feat: add login` -> `feat`
3. File pattern analysis:
   - New files in `src/` -> `feat`
   - Test files only -> `test`
   - Docs files only -> `docs`
   - Config/build changes -> `build` or `ci`
4. **Default fallback**: If still ambiguous, use `feat` for new code or `fix` for modifications

**Never ask user for type clarification** - make the best autonomous decision.
</step_3_infer_type_scope>

<step_4_generate_content>
Build PR content autonomously using the template:

1. **Title**: `{type}({scope}): {description}` - infer from branch/commits
2. **Summary**: Generate 1-2 sentences from commit messages and diff analysis
3. **Changes**: Bullet points derived from file changes and commit messages
4. **Test Plan**: Generate from test files changed, include `npm test` or equivalent
5. **Refs**: Issue references detected from branch/commits
6. **Agent Context**: File list with descriptions, intent from commits, dependency analysis

**Do NOT ask user for any content** - generate everything autonomously.
</step_4_generate_content>

<step_5_execute>
**Execute PR creation immediately** - no preview or confirmation required.

Proceed directly to `gh pr create` with the generated content.

**This skill is autonomous** - do not show preview, do not ask for confirmation,
do not use AskUserQuestion. Create the PR directly.
</step_5_execute>

<step_6_create_pr>
Execute PR creation with `gh`:

```bash
gh pr create \
  --title "feat(skills): add PR creation skill" \
  --base main \
  --body "$(cat <<'EOF'
## Summary
...

## Changes
...

## Test Plan
...

Refs: MOB-72

---

<details>
<summary>Agent Context</summary>
...
</details>
EOF
)"
```

**For draft PRs**:
```bash
gh pr create --draft ...
```
</step_6_create_pr>

<step_6b_link_to_issues>
After successful PR creation, link the PR back to validated issues.

**For each validated issue from step 2b**:

1. **Add PR as link attachment** (connects PR to issue in tracker):

   For **Linear**:
   ```
   mcp__plugin_linear_linear__update_issue(
     id: "MOB-72",
     links: [{
       url: "https://github.com/owner/repo/pull/123",
       title: "PR #123: feat(skills): add PR creation skill"
     }]
   )
   ```

   For **Jira**:
   ```
   mcp_plugin_atlassian_jira__add_link(
     issueIdOrKey: "PROJ-123",
     url: "https://github.com/owner/repo/pull/123",
     title: "PR #123: feat(skills): add PR creation skill"
   )
   ```

2. **Add comment to issue** (documents PR creation):

   For **Linear**:
   ```
   mcp__plugin_linear_linear__create_comment(
     issueId: "MOB-72",
     body: "🔗 **Pull Request Created**\n\n[#123 - feat(skills): add PR creation skill](https://github.com/owner/repo/pull/123)"
   )
   ```

   For **Jira**:
   ```
   mcp_plugin_atlassian_jira__add_comment(
     issueIdOrKey: "PROJ-123",
     body: "🔗 *Pull Request Created*\n\n[#123 - feat(skills): add PR creation skill|https://github.com/owner/repo/pull/123]"
   )
   ```

**Error handling**:
- If linking fails, PR was still created successfully
- Report the linking error to user
- Provide manual linking instructions
- Do NOT attempt to delete or rollback the PR
</step_6b_link_to_issues>

<step_7_report>
After successful creation:

```markdown
## PR Created

**URL**: https://github.com/owner/repo/pull/123
**Title**: feat(skills): add PR creation skill
**Base**: main <- feature-branch
**Status**: Open (or Draft)

### Issue Links
- MOB-72: Linked ✓ ([view in Linear](https://linear.app/team/issue/MOB-72))

### Next Steps
- Request reviewers if needed: `gh pr edit 123 --add-reviewer @username`
- Add labels: `gh pr edit 123 --add-label "enhancement"`
- Mark ready (if draft): `gh pr ready 123`
```

**If issue linking failed**, include in report:

```markdown
### Issue Links
- MOB-72: ⚠️ Link failed - [manual link instructions]
```
</step_7_report>
</execution_flow>

<autonomous_operation>
**This skill MUST NOT use AskUserQuestion or request any user input.**

All decisions are made autonomously:
- **Type**: Inferred from branch name, commits, and file patterns
- **Scope**: Inferred from changed file paths
- **Summary**: Generated from commit messages and diff analysis
- **Test plan**: Generated from test files and standard commands
- **Confirmation**: NOT REQUIRED - create PR directly

If any information is ambiguous, make the best autonomous decision and proceed.
Do not block on missing information - use sensible defaults.
</autonomous_operation>

<examples>
<feature_pr_example>
**Scenario**: Creating PR for new authentication feature

**Branch**: `drverzal/mob-45-add-oauth-login`
**Commits**:
- `feat(auth): add OAuth2 provider configuration`
- `feat(auth): implement Google login flow`
- `test(auth): add OAuth integration tests`

**Generated PR**:

```markdown
Title: feat(auth): add OAuth2 login with Google provider

## Summary
Add OAuth2 authentication support enabling users to sign in with their Google accounts, reducing friction in the login flow.

## Changes
- Add OAuth2 provider configuration in `src/config/auth.ts`
- Implement Google login flow with token handling
- Add callback route for OAuth redirect
- Create login button component with provider selection
- Add integration tests for OAuth flow

## Test Plan
- [ ] Run `npm test` - all tests pass
- [ ] Manual: Click "Sign in with Google" on login page
- [ ] Manual: Complete OAuth flow, verify redirect to dashboard
- [ ] Manual: Verify user profile shows Google account info

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
This enables single sign-on for organizations using Google Workspace.

### Dependencies
- **Provides**: OAuth login capability, GoogleAuthProvider
- **Consumes**: Existing auth context, session management
- **Affects**: Login page, user profile display

</details>
```
</feature_pr_example>

<bugfix_pr_example>
**Scenario**: Fixing a race condition bug

**Branch**: `fix/mob-89-cart-duplicate-items`
**Commits**:
- `fix(cart): add debounce to prevent duplicate additions`

**Generated PR**:

```markdown
Title: fix(cart): prevent duplicate items on rapid add-to-cart clicks

## Summary
Fix race condition that caused duplicate cart items when users rapidly clicked the "Add to Cart" button.

## Changes
- Add 300ms debounce to `addToCart` action
- Implement optimistic locking on cart item creation
- Add visual feedback during add operation

## Test Plan
- [ ] Run `npm test` - all tests pass
- [ ] Manual: Rapidly click "Add to Cart" button 5+ times
- [ ] Verify only one item is added to cart
- [ ] Verify button shows loading state during operation

Fixes: #89
Refs: MOB-89

---

<details>
<summary>Agent Context</summary>

### Files Changed
- `src/store/cartSlice.ts` - Added debounce and optimistic locking
- `src/components/AddToCartButton.tsx` - Added loading state

### Intent
Root cause was missing debounce on the add-to-cart action. Multiple rapid clicks
queued multiple API calls before the first completed, resulting in duplicates.

### Dependencies
- **Provides**: Thread-safe cart operations
- **Consumes**: Cart API, debounce utility
- **Affects**: All "Add to Cart" interactions site-wide

</details>
```
</bugfix_pr_example>
</examples>

<draft_pr_handling>
<when_to_use_draft>
Create as draft when:
- Work in progress, not ready for review
- Seeking early feedback on approach
- CI needs to run before marking ready
- Dependent on another PR being merged

**Draft is indicated by**:
- `/pr --draft` argument passed to skill
</when_to_use_draft>

<draft_commands>
```bash
# Create as draft
gh pr create --draft --title "..." --body "..."

# Mark ready when complete
gh pr ready {pr-number}
```
</draft_commands>
</draft_pr_handling>

<error_handling>
<common_errors>
**No commits on branch**:
```
Error: No commits between main and current branch
```
Solution: Ensure there are committed changes before creating PR.

**Branch not pushed**:
```
Error: Remote branch not found
```
Solution: Push branch first with `git push -u origin {branch}`.

**PR already exists**:
```
Error: A pull request already exists for this branch
```
Solution: Show existing PR URL, offer to update it.

**Authentication failure**:
```
Error: gh auth required
```
Solution: Run `gh auth login` to authenticate.
</common_errors>

<pre_flight_checks>
Before attempting PR creation:

1. **Check for commits**: `git log origin/main..HEAD --oneline`
2. **Check branch is pushed**: `git ls-remote --heads origin {branch}`
3. **Check no existing PR**: `gh pr list --head {branch}`
4. **Check gh auth**: `gh auth status`

If any check fails, report the issue and provide the fix command.
</pre_flight_checks>
</error_handling>

<edge_cases>
<no_issue_detected>
**Branch without issue ID**:

When no issue reference is found in branch name or commits:
1. Proceed with PR creation without issue linking
2. Inform user: "No issue references detected. PR will be created without issue linking."
3. Do NOT block PR creation or prompt user to enter an issue ID
4. `Refs:` line will be omitted from PR body
</no_issue_detected>

<multiple_issues>
**Multiple issue IDs found**:

When multiple issue references are detected:
1. Collect all unique issue IDs from branch name and commits
2. Validate each issue via backend MCP tools
3. Include all validated issues in `Refs:` line: `Refs: MOB-72, MOB-74, MOB-75`
4. Link PR to all validated issues after creation
5. Add comment to each linked issue
</multiple_issues>

<no_changes>
**No changes to commit**:

Detected when `git diff --name-only origin/main...HEAD` returns empty:
1. Report: "No changes detected between current branch and main."
2. Suggest: "Ensure you have committed your changes before creating a PR."
3. Do NOT attempt to create an empty PR
</no_changes>

<pr_already_exists>
**PR already exists for branch**:

Detected by `gh pr list --head {branch}`:
1. Report: "A pull request already exists for this branch."
2. Show existing PR URL and title
3. Exit gracefully - do NOT create a duplicate PR
4. Suggest next steps in output (view with `gh pr view`, edit with `gh pr edit`)
</pr_already_exists>

<lowercase_issue_ids>
**Lowercase issue IDs in branch names**:

Branch names often use lowercase (e.g., `drverzal/mob-72-feature`):
1. Use case-insensitive regex matching: `grep -oiE "[A-Z]{2,10}-[0-9]+"`
2. Normalize extracted IDs to uppercase for display and API calls
3. Example: `mob-72` -> `MOB-72`
</lowercase_issue_ids>
</edge_cases>

<anti_patterns>
**Don't put issue numbers in title**:
- BAD: `feat(auth): add OAuth login (MOB-45)`
- GOOD: `feat(auth): add OAuth login` with `Refs: MOB-45` in body

**Don't use vague titles**:
- BAD: `Update code`
- GOOD: `refactor(api): extract shared validation middleware`

**Don't skip the test plan**:
- BAD: "No tests needed"
- GOOD: Always include at least basic verification steps

**Don't write prose in Changes**:
- BAD: "This PR adds a new feature that allows users to..."
- GOOD: Bullet points starting with verbs

**Don't forget agent context**:
- BAD: Human section only
- GOOD: Include collapsible agent context with file list and intent

**Don't ask for user input** (this is an autonomous skill):
- BAD: Use AskUserQuestion for type/scope/confirmation
- GOOD: Infer everything autonomously and create PR directly

**Don't ignore existing PRs**:
- BAD: Create duplicate PR for same branch
- GOOD: Detect existing PR, offer to update or view it
</anti_patterns>

<success_criteria>
A successful autonomous PR creation achieves:

**Pre-flight checks**:
- [ ] Branch has commits relative to base (or graceful exit if none)
- [ ] Branch is pushed to remote (or auto-push with `git push -u origin`)
- [ ] No existing PR for this branch (or report existing PR URL)
- [ ] GitHub CLI authenticated (`gh auth status`)

**Issue detection**:
- [ ] Issue references detected from branch/commits (case-insensitive)
- [ ] Lowercase issue IDs normalized to uppercase
- [ ] Multiple issues handled correctly (deduplicated, all validated)
- [ ] Detected issues validated via backend MCP tools (if available)
- [ ] Graceful handling when no issues detected (PR created without linking)

**PR content** (all generated autonomously):
- [ ] PR title follows conventional commit format
- [ ] Type autonomously inferred from changes
- [ ] Summary generated from commits and diff analysis
- [ ] Changes section has clear bullet points
- [ ] Test plan generated from test files and standard commands
- [ ] Issue references included with `Refs:` or `Closes:` (if detected)
- [ ] Agent context section is collapsible
- [ ] Files changed list has paths and descriptions

**Execution** (fully autonomous):
- [ ] NO user confirmation requested
- [ ] PR created directly with `gh pr create`
- [ ] PR linked to validated issues via backend MCP tools
- [ ] Comment added to linked issues documenting PR creation
- [ ] PR URL and issue link status reported to user
</success_criteria>
