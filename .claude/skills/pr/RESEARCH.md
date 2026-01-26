# PR Best Practices Research

This document captures research findings on pull request best practices to inform the `/pr` skill implementation.

## Research Sources

### Primary Sources
- [Conventional Commits Specification](https://www.conventionalcommits.org/en/v1.0.0/)
- [GitHub Docs - Creating PR Templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository)
- [Graphite - Comprehensive PR Template Checklist](https://graphite.com/guides/comprehensive-checklist-github-pr-template)
- [Graphite - Best PR Title Guidelines](https://graphite.com/guides/best-pr-title-guidelines)
- [HackerOne - Writing Great PR Descriptions](https://www.hackerone.com/blog/writing-great-pull-request-description)
- [Codica - Pull Request Best Practices](https://github.com/codica2/pull-request-best-practices)
- [Axolo - GitHub PR Template Guide](https://axolo.co/blog/p/part-3-github-pull-request-template)
- [Everhour - GitHub PR Template Examples 2026](https://everhour.com/blog/github-pr-template/)

### AI/Agent Context Sources
- [CodeRabbit - AI PR Reviewer](https://www.coderabbit.ai/)
- [Qodo PR-Agent](https://github.com/qodo-ai/pr-agent)
- [Microsoft Engineering - AI-Powered Code Reviews](https://devblogs.microsoft.com/engineering-at-microsoft/enhancing-code-quality-at-scale-with-ai-powered-code-reviews/)

---

## 1. PR Title Conventions

### Conventional Commits Format

The industry standard for PR titles follows the Conventional Commits specification, especially when using squash-and-merge strategy (which makes PR titles become merge commit messages).

**Format:**
```
<type>(<scope>): <description>
```

**Types and their impact:**

| Type | Purpose | SemVer Impact | Changelog Section |
|------|---------|---------------|-------------------|
| `feat` | New feature | MINOR bump | Features |
| `fix` | Bug fix | PATCH bump | Bug Fixes |
| `perf` | Performance improvement | PATCH bump | Performance |
| `docs` | Documentation only | None | Documentation |
| `style` | Code style (formatting) | None | - |
| `refactor` | Code restructuring | None | Code Refactoring |
| `test` | Test additions/changes | None | Tests |
| `build` | Build system changes | None | Build |
| `ci` | CI/CD changes | None | CI |
| `chore` | Maintenance tasks | None | Chores |

**Breaking changes:** Indicated by `!` before colon: `feat(api)!: remove deprecated endpoint`

### Title Best Practices

**Good titles:**
- `feat(auth): add OAuth2 login with Google provider`
- `fix(cart): prevent duplicate item additions on double-click`
- `refactor(api): extract authentication middleware for reusability`

**Bad titles:**
- `bug fix` - Too vague
- `update code` - No context
- `PR for new feature` - Says nothing useful
- `Fixed the thing` - What thing?

### Key Principles

1. **Be specific** - Describe what changed, not that something changed
2. **Use imperative mood** - "add feature" not "added feature"
3. **Keep under 72 characters** - Fits in git log nicely
4. **Scope is optional but helpful** - Groups related changes
5. **Don't include issue numbers in title** - Put in body with `Refs:` or `Closes:`

---

## 2. Summary Section Patterns

### The "What, Why, How" Framework

From HackerOne's guide, effective PR descriptions follow this structure:

| Section | Purpose | Example |
|---------|---------|---------|
| **What** | Explicit description of changes | "Added OAuth2 authentication flow with Google and GitHub providers" |
| **Why** | Business/engineering justification | "Enables SSO for enterprise customers (Key Result 2 of Q1 OKR)" |
| **How** | Key design decisions | "Using Passport.js for OAuth handling, JWT for session tokens" |

### Summary Best Practices

1. **1-2 sentences maximum** - If you need more, the PR is too big
2. **Lead with the user impact** - "Users can now..." not "Added code that..."
3. **Avoid ticket-only references** - Don't just say "Implements JIRA-123"
4. **Connect to goals** - Why does this matter to the project?

### Anti-patterns

- **Cryptic**: "Support for #123" - What is #123?
- **Implementation-focused**: "Added try/catch around database call"
- **Too long**: If summary is 5 paragraphs, break up the PR

---

## 3. Change Description Formats

### Bullet Point Structure (Recommended)

Bullet points are preferred over prose for change descriptions because they're:
- Scannable by reviewers
- Easy to verify against diff
- Parseable by AI tools

**Effective bullet point patterns:**

```markdown
## Changes
- Add `ThemeProvider` context with light/dark/system modes
- Implement `useTheme` hook for consuming theme state
- Add localStorage persistence for user preference
- Update Header and Footer components for theme support
```

### Grouping Strategies

For larger PRs, group changes by concern:

```markdown
## Changes

### Backend
- Add `/api/oauth/callback` endpoint
- Implement token refresh logic

### Frontend
- Add login button with provider selection
- Create OAuth callback handler page

### Infrastructure
- Add OAuth client secrets to env config
```

### File-Level Detail (for AI/Agent Sections)

Provide explicit file paths with brief descriptions:

```markdown
### Files Changed
- `src/contexts/ThemeContext.tsx` - New context provider
- `src/hooks/useTheme.ts` - Consumer hook
- `src/components/Header.tsx` - Added theme toggle
```

---

## 4. Test Plan Formats

### Checkbox Pattern (Standard)

```markdown
## Test Plan
- [ ] Run `npm test` - all tests pass
- [ ] Manual: Toggle theme in settings, verify persistence
- [ ] Manual: Check all pages render correctly in dark mode
- [ ] Accessibility: Verify contrast ratios meet WCAG 2.1 AA
```

### Structured Testing Sections

For complex changes, categorize tests:

```markdown
## Test Plan

### Automated
- [ ] Unit tests pass (`npm test`)
- [ ] Integration tests pass (`npm run test:integration`)
- [ ] E2E tests pass (`npm run test:e2e`)

### Manual Verification
- [ ] Feature works on Chrome, Firefox, Safari
- [ ] Mobile responsive behavior correct
- [ ] Error states display correctly

### Edge Cases
- [ ] Empty state handled
- [ ] Maximum input length enforced
- [ ] Concurrent user edits resolved
```

### When Tests Aren't Possible

For infrastructure/config changes:

```markdown
## Test Plan
No automated tests for Terraform changes. Verified by:
- [ ] `terraform plan` shows expected changes
- [ ] Applied to staging environment successfully
- [ ] Monitored for 30 minutes, no errors
```

---

## 5. Link Conventions

### Issue References

**In PR body (not title):**

```markdown
Refs: MOB-123
Closes: #456
Related: MOB-100, MOB-101
```

**Keywords that auto-close issues:**
- `Closes`, `Fixes`, `Resolves` (GitHub)
- For Linear: `Refs: MOB-XXX` in body

### Documentation Links

```markdown
## Related
- [RFC-0042: Theme System Design](link)
- [Figma: Dark Mode Designs](link)
- [Previous PR: #234 - Added color tokens](link)
```

### Dependency References

```markdown
## Dependencies
- Blocked by: #432 (API endpoint not deployed)
- Depends on: #445 (merged, included in this PR)
```

---

## 6. AI/Agent Context Needs

### Why AI Context Matters

Modern code review increasingly involves AI tools:
- **CodeRabbit**: Provides context-aware line-by-line feedback
- **Qodo PR-Agent**: Uses JSON-based configuration for customizable review
- **Microsoft Copilot**: Powers 90% of Microsoft PRs with AI summaries

AI reviewers benefit from:
1. **Explicit file lists** - Know what to focus on
2. **Change intent** - Understand why, not just what
3. **Dependency information** - Context for impact analysis
4. **Structured format** - Parseable sections

### Recommended Agent Context Section

```markdown
<details>
<summary>Agent Context</summary>

### Files Changed
- `src/contexts/ThemeContext.tsx` - New: Theme state management
- `src/hooks/useTheme.ts` - New: Theme consumer hook
- `src/components/Header.tsx` - Modified: Added theme toggle

### Intent
This PR implements the theme system foundation for MOB-72 (Dark Mode Support).
It provides the context/hook pattern used by subsequent PRs for component updates.

### Dependencies
- **Provides**: `ThemeContext`, `useTheme` hook
- **Consumed by**: All UI components (future PRs)
- **External deps**: None added

### Review Focus
- Thread safety of localStorage access
- SSR compatibility of system preference detection
- Accessibility of theme toggle component

</details>
```

### Why Collapsible?

- Human reviewers focus on Summary/Changes/Test Plan
- AI tools can expand and parse the details
- Keeps main PR view clean and scannable

---

## 7. Good vs Bad Examples

### Bad PR Description

```markdown
Fixed the bug

Closes #123
```

**Problems:**
- No context on what bug
- No explanation of fix
- No test plan
- Reviewer must read all code to understand

### Good PR Description

```markdown
## Summary
Fix race condition in cart updates that caused duplicate items when users
double-clicked the "Add to Cart" button.

## Changes
- Add debounce to `addToCart` action (300ms)
- Implement optimistic locking on cart item creation
- Add unit tests for concurrent add scenarios

## Test Plan
- [ ] Unit tests pass
- [ ] Manual: Rapidly click add button, verify single item added
- [ ] Load test: 100 concurrent adds resolve correctly

Refs: MOB-123

<details>
<summary>Agent Context</summary>

### Files Changed
- `src/store/cartSlice.ts` - Added debounce, optimistic locking
- `src/store/cartSlice.test.ts` - New concurrency tests
- `src/components/AddToCartButton.tsx` - Disable during pending

### Intent
Prevent duplicate cart items from race condition when users double-click.
Root cause was missing idempotency key on cart operations.

### Dependencies
- No new dependencies
- Cart API already supports idempotency keys (unused until now)

</details>
```

---

## 8. Proposed Final Template Structure

Based on research findings, here is the recommended PR template structure:

```markdown
## Summary
[1-2 sentence overview - what changed and why]

## Changes
- [Bullet point 1]
- [Bullet point 2]
- [Bullet point 3]

## Test Plan
- [ ] Automated tests pass
- [ ] Manual verification step 1
- [ ] Manual verification step 2

Refs: {ISSUE-ID}

---

<details>
<summary>Agent Context</summary>

### Files Changed
- `path/to/file.ts` - [brief description]

### Intent
[Why this change was made - connects to issue context]

### Dependencies
[What this change provides/consumes/affects]

</details>
```

### Template Justification

| Section | Rationale |
|---------|-----------|
| **Summary** | Quick context for reviewers; 1-2 sentences keeps PRs focused |
| **Changes** | Bullet points are scannable; easier to verify against diff |
| **Test Plan** | Checkboxes provide verification accountability |
| **Refs** | Links to issue tracker; not in title per conventional commits |
| **Separator** | Visual break between human/agent sections |
| **Agent Context** | Collapsible keeps main view clean; structured for AI parsing |
| **Files Changed** | Explicit paths help AI tools and reviewers navigate |
| **Intent** | The "why" that helps reviewers give better feedback |
| **Dependencies** | Critical for understanding change impact |

### PR Title Format

```
<type>(<scope>): <description>
```

Examples:
- `feat(theme): add ThemeProvider context with system preference detection`
- `fix(cart): prevent duplicate items on rapid add-to-cart clicks`
- `refactor(auth): extract middleware for reusability`

**Critical for release-please:** PR title becomes merge commit message, which drives changelog generation and version bumping.

---

## 9. Implementation Notes for /pr Skill

### Auto-detection Features

The skill should automatically:

1. **Parse branch name** for issue IDs (e.g., `drverzal/mob-123-feature` -> `MOB-123`)
2. **Scan commit messages** for additional issue references
3. **Generate file list** from `git diff --name-only`
4. **Infer change type** from file patterns:
   - New files in `src/` -> likely `feat`
   - Changes to `*.test.*` only -> `test`
   - Changes to `docs/` only -> `docs`

### User Interaction Points

1. **Type selection** if not inferrable
2. **Scope suggestion** based on changed files
3. **Summary review** before PR creation
4. **Test plan prompts** if not provided

### Integration Requirements

- Use `gh pr create` with `--body` parameter
- Support `--draft` flag for WIP PRs
- Parse `gh pr view` output for existing PR detection
- Handle both Linear and Jira issue ID formats

---

## Summary of Key Findings

1. **Conventional Commits** is the standard for PR titles when using squash merge
2. **Bullet points > prose** for change descriptions
3. **Checkbox test plans** provide accountability
4. **Issue refs go in body**, not title
5. **AI context sections** should be collapsible and structured
6. **Keep PRs focused** - one concern per PR
7. **Lead with user impact** in summaries
8. **Explicit file lists** help both human and AI reviewers
