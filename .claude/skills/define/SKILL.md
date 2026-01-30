---
name: define
description: Create well-defined issues (bugs, features, tasks) using Socratic questioning to eliminate ambiguity. Use when creating new Linear or Jira issues, when the user mentions Linear, Jira, or needs to define work items with proper acceptance criteria and relationships.
invocation: /define
---

<objective>
Guide the creation of precise, unambiguous issues through the Socratic method. Ask targeted questions to uncover edge cases, acceptance criteria, relationships, and constraints before creating the issue. A well-defined issue prevents thrashing and enables clear work execution.
</objective>

<backend_detection>
Read backend from mobius config (`mobius.config.yaml` or `~/.config/mobius/config.yaml`).
Default to 'linear' if not specified.

```yaml
# mobius.config.yaml
backend: linear  # or 'jira'
```

The backend determines the output format for issue specifications.
</backend_detection>

<backend_context>
<linear>
**Linear Concepts**:
- **States**: Backlog, Todo, In Progress, Done, Canceled, Duplicate
- **Labels**: Bug, Feature, Improvement (and custom labels)
- **Priority**: 0 (No priority), 1 (Urgent), 2 (High), 3 (Normal), 4 (Low)
- **Relationships**: blocks, blockedBy, relatedTo, duplicateOf
- **Hierarchy**: Issues can have parent issues (sub-issues)
</linear>

<jira>
**Jira Configuration**:
Requires `project_key` from jira config section:

```yaml
# mobius.config.yaml
backend: jira
jira:
  base_url: https://yourcompany.atlassian.net
  project_key: PROJ
```

**Jira Concepts**:
- **Statuses**: To Do, In Progress, Done (varies by workflow)
- **Issue Types**: Bug, Story, Task, Epic, Sub-task
- **Priority**: Highest, High, Medium, Low, Lowest
- **Links**: blocks, is blocked by, relates to, duplicates
- **Hierarchy**: Epics contain Stories/Tasks; Tasks can have Sub-tasks
</jira>
</backend_context>

<context_gathering_mcp>
**Use MCP tools to gather workspace context dynamically.**

Before presenting options to the user, fetch available teams, labels, and projects using MCP tools.

**For Linear backend**:
- `mcp__plugin_linear_linear__list_teams` - Get available teams
- `mcp__plugin_linear_linear__list_issue_labels` - Get available labels
- `mcp__plugin_linear_linear__list_projects` - Get available projects
- `mcp__plugin_linear_linear__list_users` - Get assignable users

**For Jira backend** (via Atlassian MCP):
- `mcp__atlassian__searchJiraIssuesUsingJql` - Search for issues and get project context
- `mcp__atlassian__getJiraProjectIssueTypesMetadata` - Get available issue types
- `mcp__atlassian__getJiraIssueTypeMetaWithFields` - Get required fields for issue type
- Fall back to asking user directly if MCP tools unavailable

**Workflow**:
1. Detect backend from config file (default: linear)
2. Use MCP tools to fetch workspace metadata
3. Present validated options in AskUserQuestion dialogs
4. If MCP tools fail, gracefully fall back to asking user directly

This enables presenting real team/project/label options to the user.
</context_gathering_mcp>

<quick_start>
<initial_gate>
**CRITICAL - Run this BEFORE investigation**

If user provides no context (just invoked the skill), use AskUserQuestion:

Question: "What kind of issue do you need to create?"

Options:
1. **Bug report** - Something is broken or not working as expected
2. **Feature request** - New capability or enhancement
3. **Task** - General work item
4. **Improvement** - Enhancement to existing functionality
</initial_gate>

<workflow>
1. **Determine issue type** - Bug, feature, task, or improvement
2. **Identify team/project** - From context or ask user directly
3. **Gather core information** - Title, description, affected areas
4. **Investigate with Socratic questions** - Ask until no ambiguities remain
5. **Define acceptance criteria** - Verifiable outcomes
6. **Identify relationships** - What blocks this? What does this block?
7. **Set priority and metadata** - Priority, labels/issue type, project
8. **Present for approval** - Show complete issue before creating
9. **Create issue via MCP** - Create issue directly using MCP tools after approval
</workflow>
</quick_start>

<socratic_investigation>
<purpose>
Uncover hidden requirements, edge cases, and ambiguities through targeted questioning. Each question should reveal information that prevents incorrect implementation or scope creep.
</purpose>

<question_categories>
<bug_questions>
- "What is the expected behavior vs actual behavior?"
- "Can you reproduce this consistently? What are the exact steps?"
- "Does this affect all users or specific scenarios?"
- "What error messages or logs are shown?"
- "When did this start happening? Any recent changes?"
- "What is the impact - blocking users, data loss, degraded experience?"
</bug_questions>

<feature_questions>
- "Who is the primary user of this feature?"
- "What problem does this solve? What's the current workaround?"
- "What is the minimum viable version of this feature?"
- "Are there related features this should integrate with?"
- "What should happen at the edges - empty input, maximum values, errors?"
- "How will we know this feature is successful?"
</feature_questions>

<task_questions>
- "What is the definition of done for this task?"
- "What existing code or systems does this touch?"
- "Are there dependencies that must complete first?"
- "Who needs to be informed when this is complete?"
- "What could block progress on this?"
</task_questions>

<universal_questions>
- "What priority does this have? 1 (Urgent) to 4 (Low)?"
- "Is there a deadline or due date?"
- "Who should own this work?"
- "Are there labels that should be applied?"
- "Does this relate to any existing issues?"
- "Should this be part of a project?"
- "How will we verify each criterion is met?" (test command, manual step, or observable outcome)
</universal_questions>
</question_categories>

<questioning_protocol>
**Thorough Socratic Questioning for Zero Ambiguity**

The goal is to create issues with **no ambiguity** for execution and verification.

**Interactive questioning flow**:

1. **Initial classification** - Use AskUserQuestion for issue type
2. **Scope definition** - Ask about affected files/systems
3. **Edge case exploration** - "What should happen if X fails?"
4. **Acceptance validation** - "How will we verify this is done?"
5. **Boundary confirmation** - "What is explicitly NOT in scope?"
6. **Priority assessment** - "How critical is this work?"
7. **Dependency mapping** - "What blocks this or is blocked by it?"

**Anti-Ambiguity Checklist** (verify before creating):
- [ ] No vague terms like "should work better" or "improve performance"
- [ ] Each criterion has explicit verification method
- [ ] Edge cases are documented with expected behavior
- [ ] Scope is bounded (what's in AND what's out)
- [ ] Dependencies are identified and linked

**AskUserQuestion patterns**:

For **scope clarification**:
```
Question: "Which parts of the system does this affect?"
Options:
1. **Frontend only** - UI components, styling, client-side logic
2. **Backend only** - API, database, server-side logic
3. **Full stack** - Both frontend and backend changes
4. **Infrastructure** - CI/CD, deployment, configuration
```

For **edge case handling**:
```
Question: "What should happen when the operation fails?"
Options:
1. **Show error message** - Display user-friendly error and allow retry
2. **Silent fallback** - Use default behavior without notification
3. **Block operation** - Prevent action until issue resolved
4. **Log and continue** - Record error but proceed with degraded functionality
```

For **verification method**:
```
Question: "How should we verify this criterion is met?"
Options:
1. **Automated test** - Unit/integration test that can run in CI
2. **Manual testing** - Step-by-step verification by human
3. **Observable behavior** - Visible in logs, metrics, or UI
4. **Code review** - Verified by inspecting the implementation
```

Continue questioning until all aspects are crystal clear.
</questioning_protocol>

<latent_error_prevention>
Watch for these common sources of unclear issues:

- **Assumed context**: "The usual flow" - which flow exactly?
- **Implicit scope**: "Handle errors" - which errors? How?
- **Missing acceptance criteria**: "Should work better" - how do we verify?
- **Hidden dependencies**: "After the API is ready" - which issue?
- **Vague priority**: "Soon" - Urgent or Low?
</latent_error_prevention>
</socratic_investigation>

<issue_structure>
<description_template>
A well-structured description includes:

```markdown
## Summary
[1-2 sentence overview of the issue]

## Current Behavior (bugs only)
[What happens now that shouldn't]

## Expected Behavior
[What should happen instead]

## Reproduction Steps (bugs only)
1. Step one
2. Step two
3. Observe issue

## Acceptance Criteria
- [ ] Criterion 1 with verifiable outcome
  - **Verification**: `test command` | manual step | observable
- [ ] Criterion 2 with test method
  - **Verification**: `test command` | manual step | observable
- [ ] Criterion 3 with manual verification step
  - **Verification**: `test command` | manual step | observable

## Additional Context
[Screenshots, logs, related issues]
```
</description_template>

<acceptance_criteria_rules>
Write criteria as **behavioral outcomes**, not implementation details:

**GOOD (outcomes)**:
- "User can deactivate schedule without error"
- "All team members see updated schedule within 30 seconds"
- "Error message displays with actionable guidance"

**BAD (implementation)**:
- "Add try/catch around database call"
- "Use WebSocket for real-time sync"
- "Call scheduleService.deactivate()"

Each criterion should be:
1. **Observable** - Can be seen or measured
2. **Verifiable** - Has a test or check method
3. **Unambiguous** - Only one interpretation
</acceptance_criteria_rules>
</issue_structure>

<checkpoint_issues>
<purpose>
Checkpoint issues represent decision points where human input is required before work can proceed. They're used when the implementation approach is genuinely ambiguous and an agent cannot make the decision autonomously.
</purpose>

<when_to_create_checkpoints>
Create a checkpoint issue when:
- **Technology choice** - Multiple valid libraries/frameworks could solve the problem
- **Architecture decision** - The approach has long-term implications
- **Business logic ambiguity** - The "right" behavior depends on product decisions
- **Trade-off evaluation** - Options have meaningfully different pros/cons

Do NOT create checkpoints for:
- Implementation details an agent can reasonably decide
- Standard patterns with clear best practices
- Decisions that can be easily changed later
- Personal style preferences
</when_to_create_checkpoints>

<checkpoint_template>
```markdown
## Summary
[Brief description of the decision that needs to be made]

## Type: checkpoint:decision

## Decision Required
[Specific question that needs answering - one decision per checkpoint]

## Options
1. **Option A** - [Name]
   - Pros: [Benefits of this approach]
   - Cons: [Drawbacks or trade-offs]
   - Example: [Code snippet or reference if helpful]

2. **Option B** - [Name]
   - Pros: [Benefits of this approach]
   - Cons: [Drawbacks or trade-offs]
   - Example: [Code snippet or reference if helpful]

3. **Option C** - [Name] (optional)
   - Pros: [Benefits of this approach]
   - Cons: [Drawbacks or trade-offs]
   - Example: [Code snippet or reference if helpful]

## Recommendation
[If the agent has a recommendation, state it with reasoning. Otherwise: "No strong recommendation - depends on team preference."]

## Default Behavior
If no decision is made within [timeframe, e.g., "24 hours" or "before next sprint"], proceed with: **[Option X]**
Reason: [Why this is a safe default]

## Blocks
This decision blocks: [List of dependent sub-tasks or issues]
```
</checkpoint_template>

<checkpoint_example>
**Scenario**: Implementing dark mode feature requires deciding how to persist theme preference.

```markdown
## Summary
Choose the approach for persisting user theme preference.

## Type: checkpoint:decision

## Decision Required
How should we persist the user's theme preference across sessions?

## Options
1. **localStorage only**
   - Pros: Simple implementation, no server changes, immediate read
   - Cons: Not available during SSR, can flash wrong theme on load
   - Example: `localStorage.setItem('theme', 'dark')`

2. **Cookie only**
   - Pros: Available during SSR, no theme flash
   - Cons: Sent with every request, 4KB limit, requires cookie parsing
   - Example: `document.cookie = 'theme=dark; max-age=31536000'`

3. **Cookie + localStorage hybrid**
   - Pros: SSR-friendly AND fast client reads, best UX
   - Cons: More complex, must keep in sync
   - Example: Cookie for SSR, localStorage for client preference changes

## Recommendation
**Option 3 (hybrid)** if SSR is used, otherwise **Option 1 (localStorage)**.
Our app uses Next.js with SSR, so the hybrid approach prevents theme flash.

## Default Behavior
If no decision is made within 24 hours, proceed with: **Option 1 (localStorage)**
Reason: Simplest implementation; theme flash is acceptable for initial release.

## Blocks
This decision blocks: MOB-125 (Create ThemeProvider), MOB-126 (Add useTheme hook)
```
</checkpoint_example>

<timeout_handling>
Every checkpoint must have a default behavior to prevent indefinite blocking:

1. **Specify a timeout** - Usually 24-48 hours or "before next sprint"
2. **Choose a safe default** - The option that is easiest to change later
3. **Explain the reasoning** - Why this default won't cause problems

If the checkpoint is critical and has no safe default, escalate to the issue creator.
</timeout_handling>

<checkpoint_resolution>
When a decision is made:
1. Add a comment with the decision and reasoning
2. Update the issue description with "**Decision**: Option X selected"
3. Move the checkpoint to Done
4. Unblock dependent issues

The agent executing dependent tasks should read the checkpoint's decision before implementing.
</checkpoint_resolution>
</checkpoint_issues>

<context_gathering>
<gathering_approach>
Use MCP tools to fetch workspace context dynamically, then present options to the user.

**Gathering workflow**:
1. Call `mcp__plugin_linear_linear__list_teams` to get available teams
2. Present team options via AskUserQuestion
3. Call `mcp__plugin_linear_linear__list_issue_labels` to get labels for selected team
4. Present label options via AskUserQuestion
5. Optionally call `mcp__plugin_linear_linear__list_projects` for project assignment

**For Jira**:
1. Use `mcp__atlassian__getJiraProjectIssueTypesMetadata` to get issue types
2. Use `mcp__atlassian__searchJiraIssuesUsingJql` to find related issues
3. Present options via AskUserQuestion

**For related issues**: Ask the user if they know of related issues, or use `mcp__plugin_linear_linear__list_issues` (Linear) / `mcp__atlassian__searchJiraIssuesUsingJql` (Jira) to search for potentially related issues.
</gathering_approach>

<relationship_discovery>
Ask about relationships:

- "Do you know of any existing issues this is related to?"
- "Should any existing issues be blocked by this work?"
- "Is this a duplicate of an existing issue?"

**Linear relationships** (included in output):
- `blocks`: Issues this one blocks
- `blockedBy`: Issues blocking this one
- `relatedTo`: Related issues
- `duplicateOf`: If this duplicates another issue

**Jira links** (included in output):
- blocks / is blocked by
- relates to
- duplicates / is duplicated by
</relationship_discovery>
</context_gathering>

<priority_guidelines>
<priority_matrix>
| Priority | Linear | Jira | When to use |
|----------|--------|------|-------------|
| Urgent | 1 | Highest | Production down, data loss, security |
| High | 2 | High | Major feature broken, many users affected |
| Normal | 3 | Medium | Important but not urgent, default |
| Low | 4 | Low | Nice to have, improvements |
| None | 0 | Lowest | Not yet triaged |
</priority_matrix>

<priority_questions>
Use AskUserQuestion for priority:

Question: "What priority should this have?"

Options:
1. **Urgent** - Production impact, must fix immediately
2. **High** - Major functionality affected, fix soon
3. **Normal** - Important but not urgent (recommended default)
4. **Low** - Enhancement, can wait
</priority_questions>
</priority_guidelines>

<approval_workflow>
<before_output>
Present the complete issue in chat:

"Here is the issue I'll create:

**Title**: [title]
**Team/Project**: [team or project name]
**Type/Labels**: [Bug/Feature/Improvement or issue type]
**Priority**: [Urgent/High/Normal/Low]
**State/Status**: [initial state]
**Description**:
[full description with acceptance criteria]

**Relationships**: [if any]
**Parent**: [if applicable]

Ready to create this issue?"

Use AskUserQuestion:
- **Create issue** - Issue looks correct, create it
- **Make changes** - I need to modify something
- **Add more context** - I have additional information
- **Cancel** - Don't create this issue
</before_output>

<mcp_creation>
After approval, create the issue directly using MCP tools.

**For Linear**:
```
mcp__plugin_linear_linear__create_issue:
  title: "{issue title}"
  team: "{team name}"
  description: "{full description with acceptance criteria}"
  priority: {1-4}
  state: "{initial state}"
  labels: ["{label1}", "{label2}"]
  # Optional relationships
  blocks: ["{issue-id}"]
  blockedBy: ["{issue-id}"]
  relatedTo: ["{issue-id}"]
```

**For Jira** - use `mcp__atlassian__createJiraIssue`:

```
mcp__atlassian__createJiraIssue:
  cloudId: "{cloud-id}"
  projectKey: "{project-key}"
  issueTypeName: "Bug"  # or "Story", "Task"
  summary: "{issue title}"
  description: |
    ## Summary
    {description content}

    ## Acceptance Criteria
    - [ ] Criterion 1
      - **Verification**: test command or manual step
  additional_fields:
    priority:
      name: "{High/Medium/Low}"
```

After creation, the MCP tool returns the created issue details including the URL.
</mcp_creation>

<after_creation>
After creating the issue via MCP:

"Issue created successfully!

**{Issue ID}**: {Issue Title}
**URL**: {issue URL from MCP response}

Would you like to:
- Define related issues
- Break this down into sub-tasks (/refine)
- Add this to a project/epic"
</after_creation>
</approval_workflow>

<examples>
<bug_example>
User: "There's a bug with schedules"

**Response flow with AskUserQuestion**:

1. Initial question: "What is happening vs what should happen?"
2. Follow-up: "Can you reproduce this? What are the exact steps?"
3. Scope question via AskUserQuestion:
   - Question: "Does this affect all users or specific scenarios?"
   - Options: All users, Specific user roles, Specific data conditions, Unknown
4. Priority question via AskUserQuestion:
   - Question: "What is the impact of this bug?"
   - Options: Production down, Major feature broken, Degraded experience, Minor annoyance

**After gathering all details, present for approval**:

"Here is the issue I'll create:

**Title**: Schedule deactivation throws 500 error
**Team**: Engineering
**Type**: Bug
**Priority**: Urgent (1)
**State**: Todo

**Description**:
## Summary
Users receive HTTP 500 error when deactivating schedules.
...

Ready to create this issue?"

**After approval, create via MCP**:

```
mcp__plugin_linear_linear__create_issue:
  title: "Schedule deactivation throws 500 error"
  team: "Engineering"
  description: |
    ## Summary
    Users receive HTTP 500 error when deactivating schedules.

    ## Current Behavior
    Clicking 'Deactivate' shows error toast and schedule remains active.

    ## Expected Behavior
    Schedule deactivates successfully with confirmation message.

    ## Reproduction Steps
    1. Navigate to Schedule Settings
    2. Click 'Deactivate Schedule'
    3. Observe 500 error in toast

    ## Acceptance Criteria
    - [ ] User can deactivate schedule without error
      - **Verification**: Manual test - click Deactivate, observe success toast
    - [ ] Schedule status updates to 'inactive'
      - **Verification**: `npm test -- --grep 'schedule deactivation'`
    - [ ] Team members see schedule status change
      - **Verification**: Manual test - check team view after deactivation
    - [ ] Error logs capture root cause for monitoring
      - **Verification**: Observable - check logs after fix deployment
  priority: 1
  state: "Todo"
  labels: ["Bug"]
```

**Report result to user**:

"Issue created successfully!

**MOB-200**: Schedule deactivation throws 500 error
**URL**: https://linear.app/mobius/issue/MOB-200

Would you like to break this down into sub-tasks (/refine)?"
</bug_example>

<feature_example>
User: "We need to add dark mode"

**Response flow with thorough AskUserQuestion**:

1. "Who is the primary user of this feature?"
2. AskUserQuestion for behavior:
   - Question: "How should the theme be controlled?"
   - Options: Follow system only, Manual toggle only, Both system and manual, User choice on first launch
3. AskUserQuestion for scope:
   - Question: "Which areas need dark mode support?"
   - Options: All screens, Core screens only, Settings and main views, Specific components (list them)
4. AskUserQuestion for verification:
   - Question: "How should we verify the feature works?"
   - Options: Automated visual regression, Manual QA checklist, Accessibility audit, All of the above

**After gathering all details and approval, create via MCP**:

```
mcp__plugin_linear_linear__create_issue:
  title: "Add dark mode theme support"
  team: "Engineering"
  description: |
    ## Summary
    Add dark mode support with system preference detection and manual toggle.

    ## Expected Behavior
    - App detects system dark mode preference on launch
    - User can manually toggle between light/dark/system
    - All screens render correctly in both modes

    ## Scope
    **In scope**: All core screens, settings, navigation
    **Out of scope**: Admin dashboard (separate issue)

    ## Acceptance Criteria
    - [ ] Theme follows system preference by default
      - **Verification**: `npm test -- --grep 'theme system preference'`
    - [ ] Settings screen has theme toggle (Light/Dark/System)
      - **Verification**: Manual test - navigate to Settings, verify toggle exists
    - [ ] All text maintains 4.5:1 contrast ratio in both modes
      - **Verification**: `npm run test:a11y` or Lighthouse accessibility audit
    - [ ] Theme preference persists across app restarts
      - **Verification**: Manual test - set theme, restart app, verify theme persists
    - [ ] No flash of wrong theme on app launch
      - **Verification**: Observable - launch app in dark mode, no white flash

    ## Edge Cases
    - If localStorage is unavailable, default to system preference
    - If system preference API unavailable, default to light mode
  priority: 3
  state: "Backlog"
  labels: ["Feature"]
```

**Report result to user**:

"Issue created successfully!

**MOB-201**: Add dark mode theme support
**URL**: https://linear.app/mobius/issue/MOB-201

This is a larger feature. Would you like to break it down into sub-tasks (/refine MOB-201)?"
</feature_example>
</examples>

<issue_creation_mcp>
**Create the issue directly using MCP tools after user approval.**

This skill creates issues directly via MCP tools - no structured YAML output needed.

**For Linear** - use `mcp__plugin_linear_linear__create_issue`:

```
mcp__plugin_linear_linear__create_issue:
  title: "{issue title}"
  team: "{team name}"
  description: |
    ## Summary
    {description content}

    ## Acceptance Criteria
    - [ ] Criterion 1
      - **Verification**: test command or manual step
  priority: {1-4}  # 1=Urgent, 2=High, 3=Normal, 4=Low
  state: "{initial state}"  # Backlog, Todo, In Progress, Done
  labels: ["{label1}", "{label2}"]
  # Optional relationships
  blocks: ["{issue-id}"]
  blockedBy: ["{issue-id}"]
  relatedTo: ["{issue-id}"]
  duplicateOf: "{issue-id}"  # if marking as duplicate
```

**For Jira** - use `mcp__atlassian__createJiraIssue`:

```
mcp__atlassian__createJiraIssue:
  cloudId: "{cloud-id}"
  projectKey: "{project-key}"
  issueTypeName: "Bug"  # or "Story", "Task"
  summary: "{issue title}"
  description: |
    ## Summary
    {description content}

    ## Acceptance Criteria
    - [ ] Criterion 1
      - **Verification**: test command or manual step
  additional_fields:
    priority:
      name: "{High/Medium/Low}"
```

**After successful creation**:
1. Extract the issue ID and URL from the MCP response
2. Report the created issue to the user
3. Offer next steps (refine, create related issues)

**If MCP tool fails**:
1. Report the error to the user
2. Suggest troubleshooting steps (check API token, permissions)
3. Offer to retry or save issue details for manual creation

**Relationship handling**:
- `blocks`: Issues that cannot start until this one completes
- `blockedBy`: Issues that must complete before this one can start
- `relatedTo`: Related issues for reference
- `duplicateOf`: Mark as duplicate of existing issue

**Backend-specific field mappings**:

| Field | Linear | Jira (via Atlassian MCP) |
|-------|--------|--------------------------|
| `team` / `projectKey` | Team name | Project key |
| `priority` | 1=Urgent, 2=High, 3=Normal, 4=Low | Highest/High/Medium/Low/Lowest |
| `state` / `status` | Backlog, Todo, In Progress, Done | To Do, In Progress, Done |
| `labels` / `issueTypeName` | Labels array | Issue type name (Bug/Story/Task) |
</issue_creation_mcp>

<anti_patterns>
**Don't accept vague requirements**:
- BAD: "Fix the scheduling bug"
- GOOD: "Fix 500 error on schedule deactivation affecting all users"

**Don't skip acceptance criteria**:
- BAD: Create issue with just title and description
- GOOD: Every issue has verifiable acceptance criteria

**Don't assume priority**:
- BAD: Default everything to Normal
- GOOD: Ask about impact and urgency to determine priority

**Don't ignore relationships**:
- BAD: Create isolated issues
- GOOD: Search for related issues and set up relationship links

**Don't create compound issues**:
- BAD: "Fix deactivation and add team sync and improve UI"
- GOOD: Create separate issues for each concern

**Don't write untestable acceptance criteria**:
- BAD: "System should be faster" (unmeasurable)
- BAD: "UI should look better" (subjective)
- GOOD: "Page load time < 2 seconds" with `Verification: Lighthouse performance score > 90`
- GOOD: "Button uses primary color from design system" with `Verification: Visual regression test`
</anti_patterns>

<success_criteria>
An issue is ready when:

- [ ] Type/labels match the nature of the work (Bug/Feature/Task)
- [ ] Title is specific and actionable
- [ ] Description includes all relevant context
- [ ] Acceptance criteria are behavioral outcomes
- [ ] Each criterion has explicit verification method
- [ ] Priority reflects actual urgency/impact
- [ ] Relationships are identified and linked
- [ ] Project/team is set
- [ ] No vague terms remain (no "should work better", "improve performance")
- [ ] Edge cases are documented with expected behavior
- [ ] Scope is bounded (what's in AND what's out)
- [ ] User has approved before creating
- [ ] Issue created successfully via MCP tool
- [ ] Created issue URL returned to user
</success_criteria>
