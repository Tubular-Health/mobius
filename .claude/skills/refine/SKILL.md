---
name: refine
description: Break down issues into sub-tasks with dependencies. Supports Linear, Jira, and local backends. Sub-tasks are always written locally. Use when the user mentions "refine", "break down", or "plan" for an issue.
invocation: /refine
---

<objective>
Transform an issue into a set of focused, executable sub-tasks through deep codebase exploration. Each sub-task targets a single file or tightly-coupled file pair, sized to fit within one Claude context window. Sub-tasks are created with blocking relationships to enable parallel work where dependencies allow.
</objective>

<context>
This skill bridges high-level issues and actionable implementation work. It:

1. **Deeply researches** the codebase to understand existing patterns, dependencies, and affected areas
2. **Decomposes** work into single-file-focused tasks that Claude can complete in one session
3. **Identifies dependencies** between tasks to establish blocking relationships
4. **Writes sub-tasks locally** as JSON files in `.mobius/issues/{id}/tasks/` with proper blocking order

Sub-tasks are ALWAYS local files, regardless of backend mode. The backend only determines where the parent issue is fetched from.
</context>

<backend_detection>
**Auto-detection from issue ID**:
- Linear: `MOB-123`, `VRZ-456` (2-4 letter prefix) — default if ambiguous
- Jira: `PROJ-123` (longer project key)
- Local: `LOC-001`, `LOC-002` (auto-incremented)

If ambiguous, use AskUserQuestion: "Which backend?" Options: Linear, Jira, Local.

Regardless of backend, sub-tasks are ALWAYS written as local JSON files to `.mobius/issues/{id}/tasks/`.
</backend_detection>

<input_validation>
Issue ID pattern: `/^[A-Z]{2,10}-\d+$/`
If ID doesn't match, warn user and ask to confirm or use different backend.
</input_validation>

<parent_issue_loading>
**Fetch parent issue based on backend mode.**

- **Local**: `cat .mobius/issues/{issue-id}/parent.json` — extract title, description, acceptance criteria, labels, priority. If missing, tell user to run `/define` first.
- **Linear**: `linearis issues read {issue-id}` — extract title, description, acceptance criteria, labels, priority, team, relationships, URL.
- **Jira**: `acli jira workitem show {issue-id}` — extract summary, description, issue type, priority, project key, issue links.

**After loading (all backends)**: Save parent data locally:
```bash
mkdir -p .mobius/issues/{parent-id}
```
Write to `.mobius/issues/{parent-id}/parent.json`.

**If CLI fails**: Report error. If CLI not found, suggest install (`npm install -g linearis` for Linear, see Atlassian docs for Jira). Offer retry or manual input.
</parent_issue_loading>

<quick_start>
<invocation>
```
/refine MOB-123    # Linear
/refine PROJ-456   # Jira
/refine LOC-001    # Local
```
</invocation>

<workflow>
1. **Detect backend** - Infer from issue ID format or ask user
2. **Fetch parent issue** - Load via CLI (linear/jira) or local file
3. **Phase 1: Initial exploration** - Single Explore agent identifies affected areas, patterns, dependencies
4. **Phase 2: Identify work units** - Main agent groups affected files into sub-task-sized work units
5. **Phase 3: Per-task research** - For complex issues (4+ work units), spawn `feature-dev:code-architect` subagents (batched 3 at a time). For simpler issues, main agent writes descriptions directly.
6. **Phase 4: Aggregate & present** - Collect write-ups, establish dependency ordering, add verification gate, present full breakdown
7. **Gather feedback** - Use AskUserQuestion for refinement
8. **Phase 5: Write sub-tasks locally** - Write sub-task JSON files to `.mobius/issues/{id}/tasks/`
</workflow>
</quick_start>

<research_phase>
<deep_exploration>
Use the Task tool with Explore agent to thoroughly analyze the codebase:

```
Task tool:
  subagent_type: Explore
  prompt: |
    Analyze the codebase to understand how to implement: {issue title and description}

    Research:
    1. Find all files that will need modification
    2. Understand existing patterns in similar areas
    3. Identify dependencies between affected files
    4. Note any shared utilities, types, or services involved
    5. Find test files that will need updates

    For each file, note:
    - What changes are needed
    - What it imports/exports that affects other files
    - Whether it has corresponding test files

    Provide a comprehensive analysis of the implementation approach.
```

Set thoroughness to "very thorough" for complex issues.
</deep_exploration>

<analysis_output>
From the exploration, extract:
- **Affected files**: Complete list with change type (create/modify)
- **Dependency graph**: Which files import from which
- **Shared resources**: Types, utilities, services used across files
- **Test requirements**: Which test files need updates
- **Pattern notes**: Existing conventions to follow
</analysis_output>

<work_unit_identification>
**Phase 2**: Group findings into sub-task-sized work units.

1. Review the Explore agent's file list and dependency graph
2. Group files following the single-file principle (one file or tightly-coupled pair per unit)
3. For each work unit, note:
   - **Target file(s)**: Primary file (and optional test pair)
   - **Rough scope**: Create/Modify/Delete, approximate change size
   - **Related areas**: Nearby files to examine for patterns
   - **Dependency hints**: Which other work units this depends on or enables
</work_unit_identification>
</research_phase>

<per_task_subagent_phase>
**Phase 3**: For issues with 4+ work units OR high complexity, spawn `feature-dev:code-architect` subagents (batched 3 at a time) to deep-dive each work unit and produce complete sub-task descriptions. For simpler issues (1-3 work units), the main agent writes descriptions directly using Phase 1 exploration data.

<subagent_batching>
- Spawn up to **3 subagents simultaneously** per batch
- Wait for all in a batch to complete before launching the next
- If a work unit depends on another's output, place it in a later batch
</subagent_batching>

<subagent_prompt_template>
Each subagent receives the following context and returns a complete sub-task write-up:

```
Task tool:
  subagent_type: feature-dev:code-architect
  prompt: |
    You are writing a sub-task description for an implementation breakdown.

    ## Parent Issue
    Title: {parent issue title}
    Description: {parent issue description}
    Acceptance Criteria: {acceptance criteria from parent}

    ## Architecture Context (from Phase 1 exploration)
    {Paste the Explore agent's analysis output — affected files, patterns, dependency graph, conventions}

    ## Your Assigned Work Unit
    Target file(s): {target file path(s)} ({Create/Modify})
    Rough scope: {approximate change description}
    Related areas to examine: {nearby files for pattern reference}
    Dependency hints: Depends on {work unit N}, enables {work unit M}

    ## Your Task
    Analyze the target file(s) and related areas deeply. Also assess the complexity and risk of this work unit to enable per-task model routing.
    Complexity: how much code, logic density, cross-module dependencies (1=trivial, 10=very complex)
    Risk: test coverage gaps, API surface changes, data migration (1=safe, 10=high risk)

    Then produce a complete sub-task description using this exact template:

    ## Summary
    {1-2 sentences: what this sub-task accomplishes}

    ## Context
    Part of {parent-id}: {parent title}

    ## Target File(s)
    `{file-path}` ({Create/Modify})

    ## Action
    {2-4 sentences of specific implementation guidance}

    ## Avoid
    - Do NOT {anti-pattern 1} because {reason}

    ## Acceptance Criteria
    - [ ] {Criterion 1}
      * **Verification**: {how to verify}
    - [ ] {Criterion 2}
      * **Verification**: {how to verify}

    ## Verify Command
    ```bash
    {executable verification command}
    ```

    ## Dependencies
    - **Blocked by**: {work unit numbers this depends on, or "None"}
    - **Enables**: {work unit numbers this unblocks}

    ## Scoring Proposal
    - **Complexity**: {1-10} — {brief justification referencing file count, logic density, cross-module deps}
    - **Risk**: {1-10} — {brief justification referencing test gaps, API surface, data changes}

    IMPORTANT: Be specific. Reference actual file paths, function names, and patterns you find in the codebase. Do not use generic placeholders.
```
</subagent_prompt_template>

<subagent_output_handling>
**Validation**: After each subagent returns, verify all template sections are present (Summary, Context, Target Files, Action, Avoid, Acceptance Criteria, Verify Command, Dependencies, Scoring Proposal), file paths are concrete, verify command is executable, and acceptance criteria are measurable.

- **On failure**: Retry once with clarifying note. If retry also fails, main agent writes description manually using Phase 1 data.
- **On success**: Store write-up keyed by work unit number for Phase 4 aggregation.
</subagent_output_handling>
</per_task_subagent_phase>

<decomposition_phase>
<single_file_principle>
Each sub-task should focus on ONE file (or tightly-coupled pair like component + test). This ensures tasks fit within one context window, have clear scope, are easy to verify, and enable parallel work.
</single_file_principle>

<task_structure>
Each sub-task must include:

```markdown
## Sub-task: [Number] - [Brief title]

**Target file(s)**: `path/to/file.ts` (and test file if applicable)
**Change type**: Create | Modify | Delete

### Action
[2-4 sentences of specific implementation guidance]
- Use {library/pattern} following `src/existing/example.ts`
- Handle {error case} by {specific handling}

### Avoid
- Do NOT {anti-pattern 1} because {reason}

### Verify
```bash
{executable command that proves completion}
```

### Done
- [ ] {Measurable outcome 1}
- [ ] {Measurable outcome 2}

**Blocked by**: [Sub-task numbers, or "None"]
**Enables**: [Sub-task numbers this unblocks]
```

In the standard flow, `feature-dev:code-architect` subagents (Phase 3) produce these descriptions. The main agent validates during Phase 4 aggregation.
</task_structure>

<ordering_principles>
1. **Foundation first**: Types, interfaces, schemas before implementations
2. **Dependencies flow down**: If A imports from B, B must be done first
3. **Tests with implementation**: Pair test files with source in same task
4. **UI last**: Components after their dependencies
5. **Verification last**: Verification gate is ALWAYS the final sub-task

**Parallelization**: Independent services, unrelated UI components, and tests for different features can run in parallel.
</ordering_principles>

<scoring_rubric>
**Score each sub-task for complexity and risk to enable per-task model routing.**

The scoring rubric enables the executor to route sub-tasks to appropriately-sized models. Scores are proposed by Phase 3 subagents and normalized by the main agent in Phase 4.

### Complexity Scale (1-10)

| Range | Label | Criteria |
|-------|-------|----------|
| 1-3 | Low | Type definitions, config files, re-exports, simple constants. <50 lines changed. Single concern, no branching logic. |
| 4-6 | Moderate | Business logic, pattern implementations (providers, hooks, services). 50-200 lines changed. Moderate cross-file awareness needed. |
| 7-10 | High | New modules or subsystems, algorithms, complex state machines. >200 lines changed. Complex cross-module dependencies, multiple interacting concerns. |

### Risk Scale (1-10)

| Range | Label | Criteria |
|-------|-------|----------|
| 1-3 | Low | Internal types, UI-only changes, existing test coverage in place. No API surface changes, no data format changes. |
| 4-6 | Moderate | Business logic changes, API endpoint modifications, state management updates. Moderate test gaps, may affect downstream consumers. |
| 7-10 | High | Auth/security logic, payment processing, database migrations, breaking API changes. Significant test gaps, data integrity implications. |

### Model Mapping Formula

Compute `combined = complexity + risk`, then apply thresholds:

| Combined Score | Recommended Model | Rationale |
|----------------|-------------------|-----------|
| ≤6 | `haiku` | Simple tasks that don't need heavy reasoning |
| ≤12 | `sonnet` | Moderate tasks requiring good code understanding |
| >12 | `opus` | Complex/high-risk tasks requiring deep reasoning |

These thresholds match the Rust `ModelRoutingConfig` defaults (`haiku_max_score: 6`, `sonnet_max_score: 12`).

### Edge Cases

- **Scores outside 1-10 range**: Clamp to 1 (minimum) or 10 (maximum) before computing combined score
- **All tasks score identically**: Valid if tasks are truly similar in scope — do not artificially spread scores
- **Verification Gate**: Always complexity 1, risk 1, `recommendedModel: "haiku"` — verification tasks are lightweight by definition
- **Scoring is optional**: The Rust `scoring` field is `Option<TaskScoring>` with `serde(default)`, so omitting it is backward-compatible but not recommended
</scoring_rubric>

<aggregation_phase>
**Phase 4**: Collect all sub-task write-ups and assemble the final breakdown.

1. **Collect write-ups** from Phase 3 subagents
2. **Assign ordering numbers** using dependency hints + ordering principles
3. **Establish blockedBy relationships** using assigned order numbers
4. **Verify no circular dependencies** — graph must be a DAG
5. **Aggregate verify commands** — extract each sub-task's `### Verify Command` bash block into numbered list for the Verification Gate description
6. **Identify parallel groups** — tasks with no mutual dependencies
7. **Add verification gate** blocked by ALL implementation tasks, with aggregated verify commands
8. **Quality checks**: single file per task, no duplicate targets, all sections complete, verify commands executable, acceptance criteria measurable
</aggregation_phase>

<scoring_phase>
Score each sub-task for complexity (1-10) and risk (1-10) to enable per-task model routing.

**Complexity**: 1-3 (types, config, <50 lines) | 4-6 (logic, patterns, 50-200 lines) | 7-10 (new modules, algorithms, >200 lines)
**Risk**: 1-3 (internal types, UI, tests) | 4-6 (business logic, APIs, state) | 7-10 (auth, payments, DB, security)

**Model mapping** (complexity + risk): 2-6 → `haiku` | 7-12 → `sonnet` | 13-20 → `opus`

Include `scoring` field in each sub-task JSON. Verification Gate always gets complexity: 1, risk: 1, model: haiku.
</scoring_phase>

<verification_gate>
**ALWAYS include a Verification Gate as the final sub-task.**

- Title: `[{parent-id}] Verification Gate` (MUST contain "Verification Gate" for mobius routing)
- Blocked by ALL implementation sub-tasks
- Routes to `/verify` instead of `/execute` when run by mobius
- Description includes `### Aggregated Verify Commands` with each sub-task's verify command
- Done criteria: all verify commands pass, all tests pass, all acceptance criteria verified, no critical review issues
</verification_gate>

<sizing_guidelines>
A well-sized sub-task: targets 1 file, has 2-4 acceptance criteria, 50-200 lines of changes.

**Split if**: multiple unrelated changes, >5 sentences description, >5 acceptance criteria.
**Combine if**: files always modified together, trivially small (<10 lines each), one re-exports from another.
</sizing_guidelines>

<context_sizing>
**Maximum 3 tasks per batch** to prevent context degradation.

For features requiring 4+ sub-tasks, organize into waves:
1. **Wave 1: Foundation** - Types, interfaces, schemas (max 3 tasks)
2. **Wave 2: Core Logic** - Services, API endpoints (max 3 tasks)
3. **Wave 3: UI/Presentation** - Components, forms (max 3 tasks)
4. **Wave 4: Integration** - Routing, E2E tests (remaining tasks)
</context_sizing>
</decomposition_phase>

<presentation_phase>
<breakdown_format>
Present the complete breakdown:

```markdown
# Implementation Breakdown: {Issue ID} - {Issue Title}

## Overview
- **Total sub-tasks**: {count}
- **Parallelizable groups**: {count}
- **Critical path**: {sequential dependencies}

## Dependency Graph
[ASCII art showing task relationships and parallel groups]

## Sub-tasks
### 1. {Title}
**File**: `{path}` | **Blocked by**: {deps} | **Enables**: {deps}
[Full sub-task details...]
```
</breakdown_format>

<refinement_questions>
After presenting the breakdown, use AskUserQuestion:

Question: "How would you like to proceed with this breakdown?"
Options:
1. **Create all sub-tasks** - Breakdown looks correct, create sub-tasks
2. **Adjust scope** - Some tasks need to be split or combined
3. **Change ordering** - Blocking relationships need adjustment
4. **Add context** - I have additional information to include
5. **Start over** - Need a different approach entirely

If user selects adjustment, incorporate changes and re-present. Loop until approved.
</refinement_questions>
</presentation_phase>

<output_phase>
<local_creation_process>
After user approval, write sub-task JSON files to `.mobius/issues/{parent-id}/tasks/`.

1. `mkdir -p .mobius/issues/{parent-id}/tasks`
2. Write leaf tasks first (no blockers) as `task-001.json`, `task-002.json`, etc.
3. Write dependent tasks with `blockedBy` referencing earlier `task-{NNN}` identifiers
4. Write Verification Gate last as `task-VG.json`
5. Write `context.json` with full parent + subTasks array
6. Report progress as each file is written

**Sub-task JSON schema** (see `<subtask_creation_local>` for complete schema):

```json
{
  "id": "task-001",
  "title": "[{parent-id}] {sub-task title}",
  "description": "## Summary\n...\n## Verify Command\n```bash\n...\n```",
  "status": "pending",
  "blockedBy": [],
  "blocks": ["task-002"],
  "labels": ["{inherited-labels}"],
  "parentId": "{parent-id}",
  "scoring": {
    "complexity": 4,
    "risk": 3,
    "recommendedModel": "sonnet",
    "rationale": "Single file with moderate logic"
  }
}
```

**VG JSON**: Same schema with `"id": "task-VG"`, `blockedBy` listing ALL implementation task IDs, `scoring` of complexity: 1, risk: 1, model: haiku.

**context.json**: Contains `parent` object, `subTasks` array (with id, identifier, title, status, blockedBy, blocks for each), and `metadata` (backend, fetchedAt, updatedAt).
</local_creation_process>

<completion_summary>
After writing all files, provide summary table:

```markdown
## Breakdown Complete: {parent issue ID}

**Sub-tasks created**: {count} | **Location**: `.mobius/issues/{parent-id}/tasks/`

| ID | Title | Blocked By | File |
|----|-------|------------|------|
| task-001 | ... | - | `tasks/task-001.json` |
| task-VG | Verification Gate | all tasks | `tasks/task-VG.json` |

**Ready to start**: {first unblocked task(s)}
**Parallel opportunities**: {description}

Run `mobius loop {parent-id}` to begin execution.
```
</completion_summary>

<post_creation_comment>
Optionally post the dependency graph as a comment on the parent issue:
- **Linear**: `linearis comments create {parent-id} --body "$COMMENT_BODY"`
- **Jira**: `acli jira workitem comment add --issue "{parent-key}" --body "$COMMENT_BODY"`
- **Local**: No comment (displayed in terminal only)
</post_creation_comment>
</output_phase>

<error_handling>
<cli_fetch_failure>
If parent issue fetch via CLI fails:
1. **Not found**: Verify issue ID, check tracker, try full identifier
2. **Permission denied**: Check API token, verify project access
3. **CLI not installed**: `npm install -g linearis` (Linear) or see Atlassian docs (Jira). Fall back to manual input.

Recovery: Ask user to retry, use different ID, or provide details manually.
</cli_fetch_failure>

<local_file_write_failure>
If sub-task file creation fails:
1. Check directory permissions on `.mobius/`
2. Check disk space
3. Report which files succeeded vs failed
4. Offer retry via AskUserQuestion
</local_file_write_failure>
</error_handling>

<examples>
<example_breakdown backend="linear">
**Parent**: MOB-100 - Add dark mode support

**Exploration finds**: theme types, ThemeProvider context, useTheme hook, ThemeToggle component, 3 components with hardcoded colors.

**Breakdown** (7 sub-tasks + VG):

1. **Define theme types** — `src/types/theme.ts` (Create) | Blocked by: None | Enables: 2, 3
2. **Create ThemeProvider** — `src/contexts/ThemeContext.tsx` (Create) | Blocked by: 1 | Enables: 3
3. **Implement useTheme hook** — `src/hooks/useTheme.ts` (Create) | Blocked by: 2 | Enables: 4-7
4. **Add ThemeToggle** — `src/components/settings/ThemeToggle.tsx` (Create) | Blocked by: 3
5-7. **Update Header/Sidebar/Card** — (Modify) | Blocked by: 3
8. **Verification Gate** — Blocked by: 1-7

```
[1] Types → [2] ThemeProvider → [3] useTheme hook
                                     ├→ [4] ThemeToggle
                                     ├→ [5] Header
                                     ├→ [6] Sidebar
                                     └→ [7] Card
                                          └→ [VG] Verification Gate
```

Parallel groups: [1]→[2]→[3] sequential, then [4-7] parallel, then [VG].

After approval, write `task-001.json` through `task-007.json` + `task-VG.json` + `context.json` to `.mobius/issues/MOB-100/tasks/`.
</example_breakdown>
</examples>

<anti_patterns>
- **Vague tasks**: BAD: "Update components for dark mode" → GOOD: "Update Header.tsx to use theme context for background and text colors"
- **Skip research**: Always explore codebase before creating tasks
- **Over-split**: One task per file, not per function
- **Under-split**: Don't create "Implement entire feature" as one task
- **Ignore patterns**: Research existing conventions and match them
- **Circular deps**: Ensure clear hierarchical dependency flow (DAG)
</anti_patterns>

<success_criteria>
- [ ] Verification Gate included as final task (`task-VG.json`) blocked by ALL implementation tasks
- [ ] No circular dependencies
- [ ] Each sub-task targets exactly one file (or source + test pair)
- [ ] Every sub-task has verifiable acceptance criteria and executable verify command
- [ ] Blocking relationships captured in JSON `blockedBy`/`blocks` arrays
- [ ] Sub-task files written to `.mobius/issues/{id}/tasks/` as `task-{NNN}.json`
- [ ] `context.json` written with full parent + subTasks array
- [ ] User approved breakdown before creation
</success_criteria>
