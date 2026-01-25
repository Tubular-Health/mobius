---
name: define-linear-issue
description: Create well-defined Linear issues (bugs, features, tasks) using Socratic questioning to eliminate ambiguity. Use when creating new Linear issues, when the user mentions Linear, or needs to define work items with proper acceptance criteria and relationships.
---

<objective>
Guide the creation of precise, unambiguous Linear issues through the Socratic method. Ask targeted questions to uncover edge cases, acceptance criteria, relationships, and constraints before creating the issue. A well-defined issue prevents thrashing and enables clear work execution.
</objective>

<context>
Linear is a project management tool with issues, projects, and cycles. Issues have:
- **States**: Backlog, Todo, In Progress, Done, Canceled, Duplicate
- **Labels**: Bug, Feature, Improvement (and custom labels)
- **Priority**: 0 (No priority), 1 (Urgent), 2 (High), 3 (Normal), 4 (Low)
- **Relationships**: blocks, blockedBy, relatedTo, duplicateOf
- **Hierarchy**: Issues can have parent issues (sub-issues)

Use the Linear MCP tools for all operations:
- `mcp__plugin_linear_linear__create_issue` - Create issues
- `mcp__plugin_linear_linear__list_issues` - Search existing issues
- `mcp__plugin_linear_linear__get_issue` - Get issue details
- `mcp__plugin_linear_linear__list_teams` - List available teams
- `mcp__plugin_linear_linear__list_issue_labels` - List available labels
</context>

<quick_start>
<initial_gate>
**CRITICAL - Run this BEFORE investigation**

If user provides no context (just invoked the skill), use AskUserQuestion:

Question: "What kind of issue do you need to create in Linear?"

Options:
1. **Bug report** - Something is broken or not working as expected
2. **Feature request** - New capability or enhancement
3. **Task** - General work item
4. **Improvement** - Enhancement to existing functionality
</initial_gate>

<workflow>
1. **Determine issue type** - Bug, feature, task, or improvement
2. **Identify team** - Use `list_teams` to find the target team
3. **Gather core information** - Title, description, affected areas
4. **Investigate with Socratic questions** - Ask until no ambiguities remain
5. **Define acceptance criteria** - Verifiable outcomes
6. **Identify relationships** - What blocks this? What does this block?
7. **Set priority and metadata** - Priority 1-4, labels, project
8. **Present for approval** - Show complete issue before creating
9. **Create with Linear MCP** - Execute the create_issue tool
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
</universal_questions>
</question_categories>

<questioning_protocol>
1. Start with 2-3 high-value questions using AskUserQuestion
2. Based on answers, identify remaining ambiguities
3. Ask follow-up questions until answers create no new questions
4. Confirm understanding by summarizing back
5. Only proceed to issue creation when requirements are clear

Use AskUserQuestion with descriptive options where applicable. For open-ended information gathering, direct questions in chat are acceptable.
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
- [ ] Criterion 2 with test method
- [ ] Criterion 3 with manual verification step

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

<linear_context_gathering>
<available_context>
Before creating an issue, gather context from Linear:

```
# List existing issues that might be related
mcp__plugin_linear_linear__list_issues with query parameter

# Get issue details including relationships
mcp__plugin_linear_linear__get_issue with includeRelations: true

# List available teams
mcp__plugin_linear_linear__list_teams

# List available labels
mcp__plugin_linear_linear__list_issue_labels
```
</available_context>

<relationship_discovery>
Ask about relationships using Linear context:

- "I found these related open issues: [list]. Does this new issue depend on any of them?"
- "Should any existing issues be blocked by this work?"
- "Is this related to an existing issue?"

Use relationship parameters at creation time:
- `blocks`: Issues this one blocks
- `blockedBy`: Issues blocking this one
- `relatedTo`: Related issues
- `duplicateOf`: If this duplicates another issue
</relationship_discovery>
</linear_context_gathering>

<priority_guidelines>
<priority_matrix>
| Priority | Meaning | When to use |
|----------|---------|-------------|
| 1 | Urgent | Production down, data loss, security |
| 2 | High | Major feature broken, many users affected |
| 3 | Normal | Important but not urgent, default |
| 4 | Low | Nice to have, improvements |
| 0 | No priority | Not yet triaged |
</priority_matrix>

<priority_questions>
Use AskUserQuestion for priority:

Question: "What priority should this have?"

Options:
1. **Urgent (1)** - Production impact, must fix immediately
2. **High (2)** - Major functionality affected, fix soon
3. **Normal (3)** - Important but not urgent (recommended default)
4. **Low (4)** - Enhancement, can wait
</priority_questions>
</priority_guidelines>

<approval_workflow>
<before_creating>
Present the complete issue in chat:

"Here is the issue I'll create in Linear:

**Title**: [title]
**Team**: [team name]
**Labels**: [Bug/Feature/Improvement]
**Priority**: [Urgent/High/Normal/Low]
**State**: [Backlog/Todo]
**Description**:
[full description with acceptance criteria]

**Relationships**: [if any]
**Project**: [if applicable]

Ready to create this issue?"

Use AskUserQuestion:
- **Create issue** - Issue looks correct, create it
- **Make changes** - I need to modify something
- **Add more context** - I have additional information
- **Cancel** - Don't create this issue
</before_creating>

<create_command>
After approval, use the Linear MCP tool:

```
mcp__plugin_linear_linear__create_issue
  team: "Team Name"
  title: "Issue title"
  description: "Full markdown description"
  labels: ["Bug"] or ["Feature"] or ["Improvement"]
  priority: 1-4
  state: "Backlog" or "Todo"
  blocks: ["ISSUE-123"]  # optional
  blockedBy: ["ISSUE-456"]  # optional
  relatedTo: ["ISSUE-789"]  # optional
```
</create_command>

<after_creation>
Confirm: "Created issue [ID]: [title]

Would you like to:
- Create related issues
- Set up additional relationships
- Add this to a project"
</after_creation>
</approval_workflow>

<examples>
<bug_example>
User: "There's a bug with schedules"

Response flow:
1. "What is happening vs what should happen?"
2. "Can you reproduce this? What are the steps?"
3. "Does this affect all users or specific scenarios?"
4. "What error message do you see?"

Resulting issue:
```
mcp__plugin_linear_linear__create_issue
  team: "Verz"
  title: "Schedule deactivation throws 500 error"
  description: "## Summary
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
- [ ] Schedule status updates to 'inactive'
- [ ] Team members see schedule status change
- [ ] Error logs capture root cause for monitoring"
  labels: ["Bug"]
  priority: 1
  state: "Todo"
```
</bug_example>

<feature_example>
User: "We need to add dark mode"

Response flow:
1. "Who is the primary user of this feature?"
2. "Should it follow system preferences or be manually toggled?"
3. "Which screens/components need dark mode support?"
4. "How will we know this feature is successful?"

Resulting issue:
```
mcp__plugin_linear_linear__create_issue
  team: "Verz"
  title: "Add dark mode theme support"
  description: "## Summary
Add dark mode support with system preference detection and manual toggle.

## Expected Behavior
- App detects system dark mode preference on launch
- User can manually toggle between light/dark/system
- All screens render correctly in both modes

## Acceptance Criteria
- [ ] Theme follows system preference by default
- [ ] Settings screen has theme toggle (Light/Dark/System)
- [ ] All text maintains 4.5:1 contrast ratio in both modes
- [ ] Theme preference persists across app restarts
- [ ] No flash of wrong theme on app launch"
  labels: ["Feature"]
  priority: 3
  state: "Backlog"
```
</feature_example>
</examples>

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
</anti_patterns>

<success_criteria>
An issue is ready when:

- [ ] Labels match the nature of the work (Bug/Feature/Improvement)
- [ ] Title is specific and actionable
- [ ] Description includes all relevant context
- [ ] Acceptance criteria are behavioral outcomes
- [ ] Each criterion is verifiable
- [ ] Priority reflects actual urgency/impact
- [ ] Relationships are identified and linked
- [ ] Project is set (if applicable)
- [ ] User has approved before creation
</success_criteria>
