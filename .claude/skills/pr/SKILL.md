---
name: pr
description: Create structured pull requests with human and agent context sections. Use when creating PRs, when the user mentions "pull request", "PR", or wants to submit changes for review.
invocation: /pr
---

<objective>
Create well-structured pull requests using `gh pr create` that optimize for both human reviewers and AI/agent consumers. The PR format follows conventional commits for titles (critical for release-please) and includes a collapsible agent context section for machine parsing.

Key behaviors:
- Auto-detect issue references from branch name and commits
- Generate PR title in conventional commit format
- Create human-readable summary, changes, and test plan sections
- Include collapsible agent context with file list and intent
- Execute `gh pr create` with properly formatted body
</objective>

<quick_start>
<invocation>
```
/pr                    # Create PR with auto-detected context
/pr --draft            # Create as draft PR
/pr --base develop     # Target a specific base branch
```
</invocation>

<workflow>
1. **Detect current state** - Get branch name, base branch, changed files
2. **Parse issue references** - Extract from branch name and commit messages
3. **Gather changes** - Get file list and diff statistics
4. **Infer PR type** - Determine feat/fix/refactor from changes
5. **Generate PR content** - Title, summary, changes, test plan, agent context
6. **Review with user** - Show PR preview before creation
7. **Execute creation** - Run `gh pr create` with formatted body
8. **Report result** - Show PR URL and next steps
</workflow>
</quick_start>

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
# Linear/Jira style: MOB-123, PROJ-456, ABC-789
/([A-Z]{2,10}-\d+)/gi

# GitHub issue style: #123 or refs/123
/#?(\d+)/g
```

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
# Get all commit messages on branch
git log origin/main..HEAD --pretty=format:"%B" | grep -oE "[A-Z]{2,10}-[0-9]+"
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

<step_3_infer_type_scope>
Analyze changes to determine:
- **Type**: feat, fix, docs, refactor, test, etc.
- **Scope**: Component/area affected

If ambiguous, ask user with AskUserQuestion:

Question: "What type of change is this PR?"
Options:
1. **feat** - New feature or capability
2. **fix** - Bug fix
3. **refactor** - Code restructuring without behavior change
4. **docs** - Documentation only
</step_3_infer_type_scope>

<step_4_generate_content>
Build PR content using the template:

1. **Title**: `{type}({scope}): {description}`
2. **Summary**: 1-2 sentences from commit messages or ask user
3. **Changes**: Bullet points from file changes
4. **Test Plan**: Default automated + ask for manual steps
5. **Refs**: Issue references detected
6. **Agent Context**: File list, intent, dependencies
</step_4_generate_content>

<step_5_preview>
Show user the complete PR before creation:

```markdown
**Title**: feat(skills): add PR creation skill with structured template

**Base**: main <- current-branch

**Body**:
## Summary
Add /pr skill for creating well-structured pull requests...

## Changes
- Add SKILL.md with PR creation workflow
- Include conventional commit title generation
...

Ready to create this PR?
```

Use AskUserQuestion:
- **Create PR** - Looks good, create it
- **Edit title** - I want to change the title
- **Edit body** - I want to modify the description
- **Cancel** - Don't create the PR
</step_5_preview>

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

<step_7_report>
After successful creation:

```markdown
## PR Created

**URL**: https://github.com/owner/repo/pull/123
**Title**: feat(skills): add PR creation skill
**Base**: main <- feature-branch
**Status**: Open (or Draft)

### Next Steps
- Request reviewers if needed: `gh pr edit 123 --add-reviewer @username`
- Add labels: `gh pr edit 123 --add-label "enhancement"`
- Mark ready (if draft): `gh pr ready 123`
```
</step_7_report>
</execution_flow>

<user_interaction>
<when_to_ask>
Use AskUserQuestion in these situations:

1. **Type unclear**: Multiple possible types (feat vs refactor)
2. **Scope ambiguous**: Changes span multiple areas
3. **Summary needed**: Can't infer from commits
4. **Test plan specifics**: Need manual verification steps
5. **Before creation**: Final confirmation
</when_to_ask>

<interaction_examples>
**Type selection**:
Question: "What type of change is this PR?"
- **feat** - New feature (Recommended based on new files)
- **fix** - Bug fix
- **refactor** - Code restructuring
- **other** - Let me specify

**Summary input**:
Question: "What should the PR summary say?"
- Provide a text input for custom summary
- Or offer to generate from commit messages

**Final confirmation**:
Question: "Ready to create this PR?"
- **Create PR** - Create with current content
- **Edit** - I want to make changes
- **Create as draft** - Create as draft PR
- **Cancel** - Don't create
</interaction_examples>
</user_interaction>

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

**User indicates draft**:
- `/pr --draft`
- User selects "Create as draft" option
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

**Don't create without confirmation**:
- BAD: Immediately run `gh pr create`
- GOOD: Show preview, get user approval first

**Don't ignore existing PRs**:
- BAD: Create duplicate PR for same branch
- GOOD: Detect existing PR, offer to update or view it
</anti_patterns>

<success_criteria>
A successful PR creation achieves:

- [ ] Branch has commits relative to base
- [ ] Branch is pushed to remote
- [ ] Issue references detected from branch/commits
- [ ] PR title follows conventional commit format
- [ ] Type correctly reflects the nature of changes
- [ ] Summary is 1-2 sentences, user-impact focused
- [ ] Changes section has clear bullet points
- [ ] Test plan includes verification steps
- [ ] Issue references included with `Refs:` or `Closes:`
- [ ] Agent context section is collapsible
- [ ] Files changed list has paths and descriptions
- [ ] User confirmed before creation
- [ ] PR created successfully with `gh pr create`
- [ ] PR URL reported to user
</success_criteria>
