---
name: define
description: Create well-defined issues (bugs, features, tasks) using Socratic questioning to eliminate ambiguity. Use when creating new Linear or Jira issues, when the user mentions Linear, Jira, or needs to define work items with proper acceptance criteria and relationships.
invocation: /define
---

<objective>
Guide the creation of precise, unambiguous issues through the Socratic method. Ask targeted questions to uncover edge cases, acceptance criteria, relationships, and constraints before creating the issue. A well-defined issue prevents thrashing and enables clear work execution.
</objective>

<backend_detection>
Read backend from mobius config (`mobius.config.yaml` or `~/.config/mobius/config.yaml`). Default to 'linear' if not specified.

```yaml
backend: linear  # or 'jira' or 'local'
```
</backend_detection>

<local_mode>
**When `backend: local`, skip all CLI calls and write issue specs directly to `.mobius/`.**

<local_id_generation>
Generate sequential `LOC-{N}` identifier using `.mobius/issues/counter.json`:
1. Read counter file (create with `{"nextTaskNumber": 1, "lastUpdated": "..."}` if missing)
2. Capture `nextTaskNumber`, increment, write back immediately
3. Format as `LOC-{N}` zero-padded to 3 digits (e.g., `LOC-001`)

Edge case: If counter.json is missing/corrupted, scan existing `LOC-*` directories to find highest number, set `nextTaskNumber` to max + 1.
</local_id_generation>

<local_issue_creation>
After user approval, write to `.mobius/issues/LOC-{N}/parent.json` using `ParentIssueContext` schema:

```json
{
  "id": "LOC-001",
  "identifier": "LOC-001",
  "title": "Issue title from Socratic questioning",
  "description": "## Summary\n\nFull markdown description with acceptance criteria...",
  "gitBranchName": "feature/loc-001",
  "status": "Backlog",
  "labels": ["Feature"],
  "url": ""
}
```

Create directories: `mkdir -p ".mobius/issues/${LOC_ID}/tasks" ".mobius/issues/${LOC_ID}/execution"`

Also create `context.json` wrapper with `parent`, empty `subTasks`, and `metadata` (backend: "local").

Ensure `.mobius/.gitignore` exists with `*` and `!.gitignore`.
</local_issue_creation>

<local_mode_constraints>
- No CLI calls, no workspace context fetching — ask user directly
- No relationship linking to backend issues (tracked locally if needed)
- Issue spec written to `.mobius/issues/LOC-{N}/parent.json`
- Full Socratic questioning, acceptance criteria, approval workflow, and quality standards still apply
- For approval, use same flow as CLI but write to local files instead of API calls
</local_mode_constraints>
</local_mode>

<backend_context>
<linear>
**Linear**: States (Backlog/Todo/In Progress/Done/Canceled/Duplicate), Labels (Bug/Feature/Improvement+custom), Priority (0=None, 1=Urgent, 2=High, 3=Normal, 4=Low), Relationships (blocks/blockedBy/relatedTo/duplicateOf), Issues can have parent issues.
</linear>

<jira>
**Jira**: Requires `project_key` from config `jira:` section. Statuses (To Do/In Progress/Done), Issue Types (Bug/Story/Task/Epic/Sub-task), Priority (Highest/High/Medium/Low/Lowest), Links (blocks/is blocked by/relates to/duplicates), Epics→Stories/Tasks→Sub-tasks.

```yaml
jira:
  base_url: https://yourcompany.atlassian.net
  project_key: PROJ
```
</jira>
</backend_context>

<context_gathering_config>
Read workspace context from `mobius.config.yaml` defaults before presenting options.

**Workflow**:
1. Detect backend from config (default: linear)
2. Read workspace defaults (team/project, labels) from config
3. Present config-based options in AskUserQuestion dialogs
4. If config values are missing, ask user directly as fallback

**CLI availability check** (run once at start):
```bash
# Linear
command -v linearis >/dev/null 2>&1 || echo "linearis not found. Install via: npm install -g linearis"
# Jira
command -v acli >/dev/null 2>&1 || echo "acli not found. See: https://developer.atlassian.com/cloud/acli/"
```

**For searching related issues**:
```bash
linearis issues search "search terms"                                    # Linear
acli jira workitem search --jql "summary ~ 'search terms' AND project = PROJ"  # Jira
```
</context_gathering_config>

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

<batching_protocol>
Reduce question rounds from 7+ to ≤3 for straightforward issues.
- Round 1: Type + scope + affected areas (3-4 options each)
- Round 2: Priority + relationships + edge cases (combined)
- Round 3: Approval (final gate)
For complex issues requiring architecture decisions, use up to 5 rounds.
</batching_protocol>

<workflow>
1. **Determine issue type** - Bug, feature, task, or improvement
2. **Identify team/project** - From context or ask user directly
3. **Gather core information** - Title, description, affected areas
4. **Investigate with Socratic questions** - Ask until no ambiguities remain
5. **Define acceptance criteria** - Verifiable outcomes
6. **Identify relationships** - What blocks this? What does this block?
7. **Set priority and metadata** - Priority, labels/issue type, project
8. **Present for approval** - Show complete issue before creating
9. **Create issue via CLI** - Create issue directly using CLI commands after approval
</workflow>
</quick_start>

<socratic_investigation>
<purpose>
Uncover hidden requirements, edge cases, and ambiguities through targeted questioning. Each question should reveal information that prevents incorrect implementation or scope creep.
</purpose>

<question_categories>
**Bug questions**: Expected vs actual behavior? Consistent reproduction steps? Affects all users or specific scenarios? Error messages/logs? When did it start? Impact level?

**Feature questions**: Primary user? Problem solved / current workaround? Minimum viable version? Related features? Edge cases (empty input, max values, errors)? Success metric?

**Task questions**: Definition of done? Existing code/systems touched? Dependencies? Who to inform? What could block progress?

**Universal questions**: Priority (1-4)? Deadline? Owner? Labels? Related issues? Part of a project? How to verify each criterion?
</question_categories>

<questioning_protocol>
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
- [ ] Edge cases documented with expected behavior
- [ ] Scope bounded (what's in AND what's out)
- [ ] Dependencies identified and linked

Continue questioning until all aspects are crystal clear.
</questioning_protocol>

<latent_error_prevention>
Watch for: Assumed context ("the usual flow" — which?), Implicit scope ("handle errors" — which? how?), Missing criteria ("should work better" — how to verify?), Hidden dependencies ("after the API is ready" — which issue?), Vague priority ("soon" — Urgent or Low?).
</latent_error_prevention>
</socratic_investigation>

<issue_structure>
<description_template>
```markdown
## Summary
[1-2 sentence overview]

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

## Additional Context
[Screenshots, logs, related issues]
```
</description_template>

<acceptance_criteria_rules>
Write criteria as **behavioral outcomes**, not implementation details:

**GOOD**: "User can deactivate schedule without error", "Error message displays with actionable guidance"
**BAD**: "Add try/catch around database call", "Use WebSocket for real-time sync"

Each criterion must be: **Observable** (seen/measured), **Verifiable** (has test/check), **Unambiguous** (one interpretation).
</acceptance_criteria_rules>
</issue_structure>

<checkpoint_issues>
<purpose>
Checkpoint issues represent decision points where human input is required. Used when implementation approach is genuinely ambiguous and an agent cannot decide autonomously.
</purpose>

<when_to_create_checkpoints>
Create when: Technology choice between valid options, Architecture decision with long-term implications, Business logic ambiguity requiring product decisions, Trade-off evaluation with meaningfully different pros/cons.

Do NOT create for: Implementation details an agent can decide, Standard patterns with clear best practices, Easily reversible decisions, Style preferences.
</when_to_create_checkpoints>

<checkpoint_template>
```markdown
## Summary
[Decision that needs to be made]

## Type: checkpoint:decision

## Decision Required
[Specific question — one decision per checkpoint]

## Options
1. **Option A** - Pros: [...] Cons: [...] Example: [...]
2. **Option B** - Pros: [...] Cons: [...] Example: [...]

## Recommendation
[Agent recommendation with reasoning, or "No strong recommendation"]

## Default Behavior
If no decision within [timeframe], proceed with: **[Option X]**
Reason: [Why this is a safe default]

## Blocks
This decision blocks: [dependent sub-tasks/issues]
```
</checkpoint_template>

<checkpoint_resolution>
When decided: Add comment with decision and reasoning, update description with "**Decision**: Option X selected", move to Done, unblock dependents. Executing agents should read the decision before implementing.
</checkpoint_resolution>
</checkpoint_issues>

<context_gathering>
Read workspace context from `mobius.config.yaml`, then present options to the user.

**Linear**: Read `team`, `project`, `default_labels` from config `linear:` section. Present as defaults via AskUserQuestion (user can override).
**Jira**: Read `project_key`, `default_labels` from config `jira:` section. Present issue type options.
If config values missing, ask user directly.

**Relationships** — ask about:
- Related existing issues, blocking relationships, duplicates
- Linear: blocks, blockedBy, relatedTo, duplicateOf
- Jira: blocks/is blocked by, relates to, duplicates/is duplicated by

For searching: `linearis issues search "terms"` (Linear) or `acli jira workitem search --jql "..."` (Jira).
</context_gathering>

<priority_guidelines>
| Priority | Linear | Jira | When to use |
|----------|--------|------|-------------|
| Urgent | 1 | Highest | Production down, data loss, security |
| High | 2 | High | Major feature broken, many users affected |
| Normal | 3 | Medium | Important but not urgent, default |
| Low | 4 | Low | Nice to have, improvements |
</priority_guidelines>

<approval_workflow>
Present the complete issue in chat before creating:

"Here is the issue I'll create:
**Title**: [title] / **Team/Project**: [name] / **Type/Labels**: [Bug/Feature/...] / **Priority**: [level] / **State**: [initial] / **Relationships**: [if any]
[full description with acceptance criteria]
Ready to create this issue?"

Use AskUserQuestion: Create issue, Make changes, Add more context, Cancel.

<cli_creation>
After approval, create via CLI:

**Linear**: `linearis issues create "{title}" --team "{team}" --description "{desc}" --priority {1-4} --state "{state}" --labels "{labels}"`
**Jira**: `acli jira workitem create --project "{key}" --type "{type}" --summary "{title}" --description "{desc}" --priority "{level}"`

Parse JSON output for issue ID and URL. If CLI not found: Linear → `npm install -g linearis`, Jira → see Atlassian docs.
</cli_creation>

<after_creation>
Report: "Issue created! **{ID}**: {Title} **URL**: {url}"
Offer: Define related issues, break down into sub-tasks (/refine), add to project/epic.
</after_creation>
</approval_workflow>

<examples>
<bug_example>
User: "There's a bug with schedules"

**Flow**: Ask expected vs actual behavior → reproduction steps → scope (AskUserQuestion: All users/Specific roles/Specific data/Unknown) → impact (AskUserQuestion: Production down/Major broken/Degraded/Minor)

**After gathering details, present for approval**:
"**Title**: Schedule deactivation throws 500 error / **Team**: Engineering / **Type**: Bug / **Priority**: Urgent (1)
[Description with Summary, Current/Expected Behavior, Repro Steps, Acceptance Criteria with verification methods]"

**After approval**: Create via `linearis issues create ...` and report result with URL. Offer to `/refine`.
</bug_example>
</examples>

<anti_patterns>
- **Don't accept vague requirements**: "Fix the scheduling bug" → ask for specifics
- **Don't skip acceptance criteria**: Every issue needs verifiable criteria
- **Don't assume priority**: Ask about impact and urgency
- **Don't ignore relationships**: Search for related issues and link them
- **Don't create compound issues**: Separate issue per concern
- **Don't write untestable criteria**: "System should be faster" → "Page load < 2s" with verification
</anti_patterns>

<success_criteria>
An issue is ready when:
- [ ] Title is specific and actionable
- [ ] Acceptance criteria are behavioral outcomes with explicit verification
- [ ] Priority reflects actual urgency/impact
- [ ] Relationships are identified and linked
- [ ] No vague terms remain
- [ ] Edge cases documented with expected behavior
- [ ] Scope is bounded (in AND out)
- [ ] User has approved before creating
</success_criteria>
