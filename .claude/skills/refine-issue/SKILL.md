---
name: refine-issue
description: Break down issues into sub-tasks with dependencies. Supports Linear and Jira backends. Use when the user mentions "refine", "break down", or "plan" for an issue.
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
4. **Creates sub-tasks** as children of the parent issue with proper blocking order

Sub-tasks are designed for autonomous execution - each should be completable without needing to reference other sub-tasks or gather additional context.
</context>

<backend_detection>
**FIRST**: Detect the backend from context file metadata.

Read the `metadata.backend` field from the context file:

```bash
cat "$MOBIUS_CONTEXT_FILE" | jq '.metadata.backend'
```

**Values**: `linear` or `jira`

**Default**: If no backend is specified in metadata, default to `linear`.

The backend information is included in the structured output so the mobius loop knows which SDK to use for issue creation. All workflow logic remains the same regardless of backend.
</backend_detection>

<input_validation>
**Issue ID Validation**:
- Linear: `MOB-123`, `VRZ-456` (team prefix + number)
- Jira: `PROJ-123` (project key + number)
- Pattern: `/^[A-Z]{2,10}-\d+$/`

If issue ID doesn't match expected format, warn user before proceeding:

```
The issue ID "{id}" doesn't match the expected format ({backend} pattern).
Did you mean to use a different backend, or is this a valid issue ID?
```
</input_validation>

<context_input>
**The mobius loop provides parent issue context via environment variable and local files.**

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
    "status": "Backlog",
    "labels": ["Feature"],
    "priority": { "value": 1, "name": "Urgent" },
    "team": "Mobius",
    "teamId": "uuid",
    "url": "https://linear.app/..."
  },
  "subTasks": [],
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
```

**Backend detection**: The `metadata.backend` field indicates whether the issue is from Linear or Jira. This affects how the mobius loop creates sub-tasks, but the skill outputs a uniform structure regardless of backend.
</context_input>

<structured_output>
**This skill MUST output structured data for the mobius loop to parse.**

At the END of your response, output a YAML or JSON block with the sub-task specifications. The mobius loop parses this to create sub-tasks via SDK.

**Output format** (YAML preferred for readability):

```yaml
---
status: BREAKDOWN_APPROVED  # Required: one of the valid status values
timestamp: "2026-01-28T12:00:00Z"  # Required: ISO-8601 timestamp
parentId: "MOB-161"  # Required: parent issue identifier
backend: "linear"  # Required: backend from context metadata

subTasks:
  - title: "[MOB-161] Define TypeScript types for feature"
    description: |
      ## Summary
      Create type definitions for the feature.

      ## Target File(s)
      `src/types/feature.ts` (Create)

      ## Acceptance Criteria
      - [ ] Type exported with proper definition
      - [ ] File compiles without errors

      ## Verify Command
      ```bash
      grep -q "export type Feature" src/types/feature.ts && echo "PASS"
      ```
    targetFile: "src/types/feature.ts"
    changeType: "create"
    blockedBy: []  # Empty for first task
    order: 1

  - title: "[MOB-161] Implement feature service"
    description: |
      ## Summary
      Implement the feature service.

      ## Target File(s)
      `src/lib/feature.ts` (Create)

      ## Acceptance Criteria
      - [ ] Service function implemented
      - [ ] Tests pass

      ## Verify Command
      ```bash
      grep -q "export function" src/lib/feature.ts && echo "PASS"
      ```
    targetFile: "src/lib/feature.ts"
    changeType: "create"
    blockedBy: [1]  # Blocked by order 1
    order: 2

  - title: "[MOB-161] Verification Gate"
    description: |
      Runs verify-issue to validate implementation meets acceptance criteria.
    targetFile: null
    changeType: "verification"
    blockedBy: [1, 2]  # Blocked by ALL implementation tasks
    order: 3
    isVerificationGate: true

dependencyGraph: |
  ```mermaid
  graph TD
    A[1: Define types] --> B[2: Implement service]
    B --> C[3: Verification Gate]
  ```

summary:
  totalSubTasks: 3
  implementationTasks: 2
  verificationGate: 1
  parallelGroups:
    - [1]
    - [2]
    - [3]
  readyToStart: [1]
---
```

**Valid status values**:
| Status | When to use |
|--------|-------------|
| `BREAKDOWN_APPROVED` | User approved breakdown, create sub-tasks |
| `BREAKDOWN_REVISED` | User requested changes, presenting revised plan |
| `NEEDS_CLARIFICATION` | Ambiguous requirements, asking user questions |
| `NO_BREAKDOWN_NEEDED` | Issue is already small enough, no sub-tasks required |

**Critical requirements**:
1. Output MUST be valid YAML or JSON
2. Output MUST appear at the END of your response
3. Output MUST include `status`, `timestamp`, `parentId`, `backend` fields
4. Each sub-task MUST include `title`, `description`, `blockedBy`, `order` fields
5. The `blockedBy` array contains order numbers (not identifiers) of blocking tasks
6. Verification Gate MUST be the final task, blocked by ALL implementation tasks
7. The mobius loop will create the actual issues using the appropriate SDK

**Sub-task description format**:
Each sub-task description should follow this template:
```markdown
## Summary
{Brief description of what this task accomplishes}

## Context
Part of {parent-id}: {parent title}

## Target File(s)
`{file-path}` ({Create/Modify})

## Action
{Specific implementation guidance}

## Avoid
- Do NOT {anti-pattern} because {reason}

## Acceptance Criteria
- [ ] {Criterion 1}
  * **Verification**: {how to verify}
- [ ] {Criterion 2}

## Verify Command
```bash
{executable verification command}
```

**Blocked by**: {order numbers or "None"}
**Enables**: {order numbers this unblocks}
```

**Important**: The mobius loop handles all issue creation via SDK. This skill only outputs the specification - it does NOT create issues directly.
</structured_output>

<quick_start>
<invocation>
The skill expects an issue identifier as argument:

```
/refine MOB-123    # Linear issue
/refine PROJ-456   # Jira issue
```

Or invoke programmatically:
```
Skill: refine-issue
Args: MOB-123
```
</invocation>

<workflow>
1. **Read context** - Load parent issue from `MOBIUS_CONTEXT_FILE` or local files
2. **Detect backend** - Read backend from context metadata (default: linear)
3. **Deep exploration** - Use Explore agent to thoroughly analyze related code, patterns, and dependencies
4. **Identify work units** - Break down into single-file-focused tasks
5. **Determine blocking order** - Analyze functional dependencies between tasks
6. **Include verification gate** - Add a final "Verification Gate" sub-task blocked by ALL implementation sub-tasks
7. **Present breakdown** - Show complete plan with all sub-tasks including verification gate
8. **Gather feedback** - Use AskUserQuestion for refinement
9. **Output specification** - Output structured YAML with approved sub-task specifications
</workflow>
</quick_start>

<research_phase>
<load_parent_context>
Read the parent issue from the context file:

```bash
# Read from context file
cat "$MOBIUS_CONTEXT_FILE" | jq '.parent'

# Or read directly from local storage
cat ~/.mobius/issues/{parentId}/parent.json
```

**Extract from parent**:
- **Title and description**: What needs to be implemented
- **Acceptance criteria**: Checklist of requirements (look for checkbox patterns)
- **Labels**: Bug/Feature/Improvement for context
- **Priority**: Urgency level for task ordering
- **Team/Project**: For sub-task inheritance
</load_parent_context>

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

<parallel_research>
**Optional optimization**: For complex issues (5+ files across multiple directories), spawn parallel Explore agents to gather context faster.

**Triggers** - use parallel research when:
- Issue affects 5+ files across multiple directories
- Multiple subsystems are involved
- Deep domain knowledge is required

**Skip** when: Simple features (< 4 files), well-understood areas, or time-sensitive changes.

For detailed agent prompts, aggregation strategy, and synthesis templates, see `.claude/skills/refine-issue/parallel-research.md`.
</parallel_research>
</research_phase>

<decomposition_phase>
<single_file_principle>
Each sub-task should focus on ONE file (or tightly-coupled pair like component + test). This ensures:

- Task fits within one context window
- Clear scope prevents scope creep
- Easy to verify completion
- Enables parallel work on unrelated files
</single_file_principle>

<task_structure>
<task_structure_quick>
Each sub-task must include:
- **Target file(s)**: Single file or source + test pair
- **Action**: 2-4 sentences of specific implementation guidance
- **Verify**: Executable command that proves completion
- **Done**: 2-4 measurable outcomes as checklist
- **Blocked by / Enables**: Dependency relationships
</task_structure_quick>

<task_structure_full>
Full template for detailed sub-tasks:

```markdown
## Sub-task: [Number] - [Brief title]

**Target file(s)**: `path/to/file.ts` (and `path/to/file.test.ts` if applicable)
**Change type**: Create | Modify | Delete

### Action
[2-4 sentences of specific implementation guidance]
- Use {library/pattern} following `src/existing/example.ts`
- Handle {error case} by {specific handling}
- Return {exact output shape}

### Avoid
- Do NOT {anti-pattern 1} because {reason}
- Do NOT {anti-pattern 2} because {reason}

### Verify
```bash
{executable command that proves completion}
```

### Done
- [ ] {Measurable outcome 1}
- [ ] {Measurable outcome 2}
- [ ] {Measurable outcome 3}

**Blocked by**: [Sub-task numbers, or "None"]
**Enables**: [Sub-task numbers this unblocks]
```

Use the "Avoid" section when research phase identified pitfalls specific to this task.
</task_structure_full>
</task_structure>

<ordering_principles>
Determine blocking order based on functional requirements:

1. **Foundation first**: Types, interfaces, schemas before implementations
2. **Dependencies flow down**: If A imports from B, B must be done first
3. **Tests with implementation**: Pair test files with their source files in same task
4. **UI last**: Components after their dependencies (services, hooks, types)
5. **Verification last**: The verification gate is ALWAYS the final sub-task

**Parallelization opportunities**:
- Independent services can run in parallel
- Unrelated UI components can run in parallel
- Tests for different features can run in parallel
</ordering_principles>

<verification_gate>
**ALWAYS include a Verification Gate as the final sub-task.** This is required for every refined issue.

The verification gate:
- Has title: `[{parent-id}] Verification Gate` (MUST contain "Verification Gate" for mobius routing)
- Is blocked by ALL implementation sub-tasks
- When executed by mobius, routes to `/verify-issue` instead of `/execute-issue`
- Validates all acceptance criteria are met before the parent can be completed

**Template**:
```markdown
## Sub-task: [Final] - Verification Gate

**Target**: Validate implementation against acceptance criteria
**Change type**: Verification (no code changes)

### Action
This task triggers the verify-issue skill to validate all implementation sub-tasks meet the parent issue's acceptance criteria.

### Done
- [ ] All tests pass
- [ ] All acceptance criteria verified
- [ ] No critical issues found by code review agents

**Blocked by**: [ALL implementation sub-task IDs]
**Enables**: Parent issue completion
```

**Structured output specification**:
```yaml
- title: "[{parent-id}] Verification Gate"
  description: |
    Runs verify-issue to validate implementation meets acceptance criteria.
  targetFile: null
  changeType: "verification"
  blockedBy: [{all implementation task order numbers}]
  order: {final order number}
  isVerificationGate: true
```

The mobius loop handles creation via the appropriate SDK (Linear or Jira) based on the `backend` field in the structured output.
</verification_gate>

<sizing_guidelines>
A well-sized sub-task:

- Targets 1 file (or source + test pair)
- Has 2-4 acceptance criteria
- Can be described in 2-3 sentences
- Takes roughly 50-200 lines of changes
- Doesn't require reading many other files to understand

**Split if**:
- File needs multiple unrelated changes
- Description exceeds 5 sentences
- More than 5 acceptance criteria
- Changes span unrelated concerns in the file

**Combine if**:
- Two files are always modified together
- Changes are trivially small (< 10 lines each)
- One file is just re-exporting from another
</sizing_guidelines>

<context_sizing>
**Maximum 3 tasks per batch** to prevent context degradation.

<wave_triggers>
Create multiple waves when:
- More than 3 files affected in a single batch
- Changes span multiple subsystems (e.g., API + UI + database)
- Sub-task description exceeds 10 sentences
</wave_triggers>

<wave_structure>
For features requiring 4+ sub-tasks, organize into waves:

1. **Wave 1: Foundation** - Types, interfaces, schemas (max 3 tasks)
2. **Wave 2: Core Logic** - Services, API endpoints (max 3 tasks)
3. **Wave 3: UI/Presentation** - Components, forms (max 3 tasks)
4. **Wave 4: Integration** - Routing, E2E tests (remaining tasks)

**Batching rules**:
- Group related changes in same wave (e.g., service + its tests)
- Foundation tasks always in first wave
- Integration/E2E tasks always in final wave

See `<examples>` section for complete wave-based breakdown example.
</wave_structure>
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
- **Critical path**: {list of sequential dependencies}
- **Estimated scope**: {total files affected}

## Dependency Graph
```
[1] Types/Interfaces
 └─► [2] Service implementation
      ├─► [3] Hook implementation
      │    └─► [5] Component A
      └─► [4] Repository updates
           └─► [6] Component B

Parallel groups:
- Group 1: [1]
- Group 2: [2]
- Group 3: [3], [4]
- Group 4: [5], [6]
```

## Sub-tasks

### 1. Define TypeScript types for {feature}
**File**: `src/types/feature.ts`
**Blocked by**: None
**Enables**: 2, 3, 4

[Full sub-task details...]

### 2. Implement {feature} service
**File**: `src/lib/services/featureService.ts`
**Blocked by**: 1
**Enables**: 3, 4

[Full sub-task details...]

[Continue for all sub-tasks...]
```
</breakdown_format>

<refinement_questions>
After presenting, use AskUserQuestion:

Question: "How would you like to proceed with this breakdown?"

Options:
1. **Create all sub-tasks** - Breakdown looks correct, create in issue tracker
2. **Adjust scope** - Some tasks need to be split or combined
3. **Change ordering** - Blocking relationships need adjustment
4. **Add context** - I have additional information to include
5. **Start over** - Need a different approach entirely
</refinement_questions>

<iterative_refinement>
If user selects adjustment options:

- **Adjust scope**: Ask which specific tasks to modify, then present revised breakdown
- **Change ordering**: Present dependency graph and ask which relationships to change
- **Add context**: Incorporate new information and re-analyze affected tasks

Loop back to presentation after each refinement until user approves.
</iterative_refinement>
</presentation_phase>

<output_phase>
<structured_output_generation>
After user approval, generate the structured YAML output with all sub-task specifications.

**Output the specification** at the END of your response:

```yaml
---
status: BREAKDOWN_APPROVED
timestamp: "{current ISO-8601 timestamp}"
parentId: "{parent issue identifier}"
backend: "{backend from context metadata}"

subTasks:
  - title: "[{parent-id}] {sub-task title}"
    description: |
      {full description with acceptance criteria and verify command}
    targetFile: "{file path or null for verification}"
    changeType: "{create|modify|delete|verification}"
    blockedBy: [{order numbers of blocking tasks}]
    order: 1

  # ... additional sub-tasks ...

  - title: "[{parent-id}] Verification Gate"
    description: |
      Runs verify-issue to validate implementation meets acceptance criteria.
    targetFile: null
    changeType: "verification"
    blockedBy: [{all implementation task order numbers}]
    order: {final order number}
    isVerificationGate: true

dependencyGraph: |
  {mermaid diagram showing dependencies}

summary:
  totalSubTasks: {count}
  implementationTasks: {count}
  verificationGate: 1
  parallelGroups: {list of parallel groups}
  readyToStart: [{order numbers of tasks with no blockers}]
---
```

**Important**: The mobius loop handles all issue creation via SDK. This skill outputs the specification - it does NOT create issues directly.
</structured_output_generation>

<creation_delegation>
The mobius loop parses the structured output and creates sub-tasks via SDK:

**For Linear**:
- Uses SDK to create issues with `parentId` and `blockedBy` fields
- Handles creation order automatically (leaf tasks first)
- Stores created issue IDs to reference in blockedBy for later tasks

**For Jira**:
- Uses SDK for two-phase creation (sub-tasks first, then links)
- Phase 1: Create all sub-tasks
- Phase 2: Create blocking relationships via `createJiraIssueLinks()`
- Reports success/failure counts

This delegation ensures:
- Reliable issue creation via tested SDK code
- Proper error handling and retry logic
- Consistent behavior across backends
</creation_delegation>

<completion_summary>
After outputting the structured specification, provide a summary for the user:

```markdown
## Breakdown Complete: {parent issue ID}

**Status**: BREAKDOWN_APPROVED
**Sub-tasks specified**: {count}
**Verification gate**: Included

| Order | Title | Blocked By | Ready |
|-------|-------|------------|-------|
| 1 | Define types | - | Yes |
| 2 | Implement service | 1 | No |
| 3 | Add hook | 1 | No |
| 4 | Verification Gate | 1, 2, 3 | No |

**Ready to start**: Task 1
**Parallel opportunities**: After task 1, tasks 2 and 3 can run simultaneously

The mobius loop will create these sub-tasks in {backend}.
```

**Note**: The mobius loop handles:
- Creating sub-tasks via SDK
- Posting the dependency diagram as a comment
- Reporting creation success/failure
</completion_summary>
</output_phase>

<error_handling>
<context_load_failure>
If context file cannot be loaded:
1. Check `MOBIUS_CONTEXT_FILE` environment variable is set
2. Verify the file exists at the specified path
3. Try reading from local storage: `~/.mobius/issues/{parentId}/parent.json`
4. Report error with suggested action:
   - "Context file not found" - Run `mobius loop {issue-id}` to generate context
   - "Invalid JSON" - Context file may be corrupted, re-run mobius loop
</context_load_failure>

<output_format_errors>
If structured output is malformed:
1. Ensure YAML is valid (proper indentation, correct syntax)
2. Verify all required fields are present:
   - `status`, `timestamp`, `parentId`, `backend`
   - Each sub-task has `title`, `description`, `blockedBy`, `order`
3. Validate `blockedBy` arrays contain valid order numbers
4. Confirm Verification Gate is marked with `isVerificationGate: true`

The mobius loop will report parsing errors - fix the output format and re-run.
</output_format_errors>

<creation_failure_handling>
**Note**: Sub-task creation is handled by the mobius loop, not this skill.

If the loop reports creation failures:
1. Check the loop's error output for specific failures
2. Common issues:
   - "Issue not found" - Verify parent issue ID exists
   - "Permission denied" - Check API token permissions
   - "Link type not available" (Jira) - "Blocks" link type may need configuration
3. Partial failures are reported by the loop - successfully created sub-tasks remain valid
4. Re-run `/refine` after fixing issues to regenerate the specification
</creation_failure_handling>
</error_handling>

<examples>
<example_breakdown backend="linear">
**Parent issue**: MOB-100 - Add dark mode support
**Backend**: Linear (Jira equivalent: PROJ-100)

**Exploration findings**:
- Need theme types in `src/types/theme.ts`
- ThemeProvider context in `src/contexts/ThemeContext.tsx`
- useTheme hook in `src/hooks/useTheme.ts`
- Settings toggle in `src/components/settings/ThemeToggle.tsx`
- Update 3 components that have hardcoded colors

**Breakdown**:

```markdown
## Sub-task: 1 - Define theme types

**Target file(s)**: `src/types/theme.ts`
**Change type**: Create

### Action
Create TypeScript type definitions for the theme system. Define `Theme` type with light/dark/system modes, `ThemeContextValue` interface with current theme and toggle function.
- Follow existing type patterns in `src/types/` directory
- Export all types for use by ThemeProvider and useTheme hook

### Avoid
- Do NOT include implementation logic in types file because types should be pure declarations
- Do NOT use `any` type because it defeats type safety

### Verify
```bash
grep -q "export type Theme" src/types/theme.ts && \
grep -q "export interface ThemeContextValue" src/types/theme.ts && \
echo "PASS"
```

### Done
- [ ] `Theme` type exported with 'light' | 'dark' | 'system' values
- [ ] `ThemeContextValue` interface exported with theme and setTheme properties
- [ ] File compiles without TypeScript errors

**Blocked by**: None
**Enables**: 2, 3

---

## Sub-task: 2 - Create ThemeProvider context

**Target file(s)**: `src/contexts/ThemeContext.tsx`
**Change type**: Create

### Action
Create React context provider for theme state management. Import types from sub-task 1, implement localStorage persistence, and detect system preference.
- Follow existing context patterns in `src/contexts/` directory
- Use `useEffect` for system preference detection via `matchMedia`

### Avoid
- Do NOT call hooks conditionally because it violates React rules
- Do NOT forget SSR safety check for localStorage because window may not exist

### Verify
```bash
grep -q "createContext" src/contexts/ThemeContext.tsx && \
grep -q "ThemeProvider" src/contexts/ThemeContext.tsx && \
echo "PASS"
```

### Done
- [ ] ThemeContext created with proper default value
- [ ] ThemeProvider component exports and wraps children
- [ ] Theme persisted to localStorage on change
- [ ] System preference detected on mount

**Blocked by**: 1
**Enables**: 3

---

## Sub-task: 3 - Implement useTheme hook

**Target file(s)**: `src/hooks/useTheme.ts`
**Change type**: Create
**Blocked by**: 2
**Enables**: 4, 5, 6, 7

---

## Sub-task: 4 - Add ThemeToggle component

**Target file(s)**: `src/components/settings/ThemeToggle.tsx`
**Change type**: Create
**Blocked by**: 3

---

## Sub-task: 5-7 - Update existing components

Files: Header.tsx, Sidebar.tsx, Card.tsx (modify)
**Blocked by**: 3

---

## Sub-task: 8 - Verification Gate

**Target**: Validate implementation against acceptance criteria
**Change type**: Verification (no code changes)

### Action
This task triggers the verify-issue skill to validate all implementation sub-tasks meet the parent issue's acceptance criteria.

### Done
- [ ] All tests pass
- [ ] All acceptance criteria verified
- [ ] No critical issues found by code review agents

**Blocked by**: 1, 2, 3, 4, 5, 6, 7
**Enables**: Parent issue completion
```

**Dependency graph**:
```
[1] Types ─► [2] ThemeProvider ─► [3] useTheme hook
                                      │
                   ┌──────────────────┼──────────────────┐
                   ▼                  ▼                  ▼
                 [4]                [5]                [6]
             ThemeToggle         Header.tsx        Sidebar.tsx
                   │                  │                  │
                   └──────────────────┼──────────────────┘
                                      ▼
                              [8] Verification Gate
```

**Parallel groups**:
- [1] → [2] → [3] (sequential foundation)
- [4], [5], [6], [7] can all run in parallel after [3]
- [8] runs after ALL other tasks complete
</example_breakdown>
</examples>

<anti_patterns>
**Don't create vague sub-tasks**:
- BAD: "Update components for dark mode"
- GOOD: "Update Header.tsx to use theme context for background and text colors"

**Don't skip the research phase**:
- BAD: Guess at file structure and create tasks
- GOOD: Deep exploration to understand actual codebase patterns

**Don't over-split**:
- BAD: Separate task for each function in a file
- GOOD: One task per file with all related changes

**Don't under-split**:
- BAD: "Implement entire feature" as one task
- GOOD: One task per file, each independently completable

**Don't ignore existing patterns**:
- BAD: Create tasks that introduce new patterns
- GOOD: Research existing conventions and match them

**Don't create circular dependencies**:
- BAD: Task A blocks B, B blocks C, C blocks A
- GOOD: Clear hierarchical dependency flow
</anti_patterns>

<success_criteria>
A successful refinement produces:

- [ ] Parent issue context loaded from `MOBIUS_CONTEXT_FILE` or local files
- [ ] Backend detected from context metadata
- [ ] All affected files identified through deep exploration
- [ ] Each sub-task targets exactly one file (or source + test pair)
- [ ] Every sub-task has clear, verifiable acceptance criteria
- [ ] Blocking relationships are logically sound (using order numbers)
- [ ] No circular dependencies exist
- [ ] Parallel opportunities are maximized
- [ ] Ready tasks (no blockers) are clearly identified
- [ ] **Verification Gate included as final task** (with `isVerificationGate: true`)
- [ ] Verification Gate blocked by ALL implementation sub-tasks
- [ ] User approved breakdown before output
- [ ] Structured YAML output with all sub-task specifications
- [ ] Output includes `status`, `timestamp`, `parentId`, `backend` fields
- [ ] Each sub-task has `title`, `description`, `blockedBy`, `order` fields
- [ ] Dependency graph included in output
</success_criteria>

<testing>
**Manual integration testing** for verifying the refine-issue skill works end-to-end.

<verification_steps>
After running `/refine {issue-id}` and having mobius loop create sub-tasks, verify the results.

<output_verification>
**Structured output verification**:

1. **Check YAML validity**: The output should be parseable YAML
2. **Verify required fields**:
   - `status`: Should be `BREAKDOWN_APPROVED`
   - `timestamp`: Valid ISO-8601 timestamp
   - `parentId`: Matches input issue ID
   - `backend`: `linear` or `jira`
3. **Verify sub-tasks**:
   - Each has `title`, `description`, `blockedBy`, `order`
   - `blockedBy` arrays contain valid order numbers
   - Last sub-task has `isVerificationGate: true`
4. **Verify dependency graph**: Mermaid diagram matches blocking relationships
</output_verification>

<linear_verification>
**Linear verification steps** (after mobius loop creates sub-tasks):

1. **Open parent issue** in Linear web UI
2. **Check sub-tasks list**: All created sub-tasks should appear as children
3. **Open each sub-task**: Verify the "Blocked by" section shows correct dependencies
4. **Check issue relations**: The blocking relationships should appear in the issue detail view

**Expected behavior**:
- Sub-tasks appear nested under parent issue
- "Blocked by" relationships visible on each sub-task
- Dependency graph in parent comment matches actual relationships
</linear_verification>

<jira_verification>
**Jira verification steps** (after mobius loop creates sub-tasks):

1. **Open parent issue** in Jira web UI
2. **Check sub-tasks section**: All created sub-tasks should appear linked to parent
3. **Open each sub-task**: Click on the sub-task to view its detail page
4. **Check "is blocked by" links**: In the issue links section, verify:
   - "is blocked by" relationships point to correct blocker issues
   - Link direction is correct (blocked task shows "is blocked by", blocker shows "blocks")
5. **Verify link type**: Links should use the "Blocks" link type (inward: "is blocked by", outward: "blocks")

**Expected behavior**:
- Sub-tasks appear in parent's sub-task section
- Each sub-task's "Issue Links" section shows "is blocked by: PROJ-XXX"
- Blocker issues show "blocks: PROJ-YYY" in their links section
- Dependency graph in parent comment matches actual link relationships
</jira_verification>
</verification_steps>

<troubleshooting>
**Common errors and solutions**:

<context_not_found>
**Context file not found**
```
Error: MOBIUS_CONTEXT_FILE not set or file not found
```

**Cause**: The mobius loop hasn't generated context yet.

**Solution**:
1. Run `mobius loop {issue-id}` to generate context files
2. Check that `~/.mobius/issues/{parentId}/` directory exists
3. Verify `MOBIUS_CONTEXT_FILE` environment variable is set correctly
</context_not_found>

<invalid_yaml>
**Invalid YAML output**
```
Error: Failed to parse skill output
```

**Cause**: The structured output has YAML syntax errors.

**Solution**:
1. Check for proper indentation (YAML is sensitive to spaces)
2. Ensure all strings with special characters are quoted
3. Verify all arrays use consistent formatting
4. Use a YAML validator to check syntax
</invalid_yaml>

<missing_fields>
**Missing required fields**
```
Error: Output missing required field: blockedBy
```

**Cause**: Sub-task specification is incomplete.

**Solution**:
1. Ensure each sub-task has all required fields:
   - `title`, `description`, `targetFile`, `changeType`
   - `blockedBy` (array of order numbers, can be empty `[]`)
   - `order` (sequential integer)
2. Ensure Verification Gate has `isVerificationGate: true`
</missing_fields>
</troubleshooting>

<end_to_end_test>
**Complete end-to-end verification checklist**:

1. **Setup**:
   - [ ] Mobius configured with Linear or Jira backend
   - [ ] Context generated for test parent issue
   - [ ] `MOBIUS_CONTEXT_FILE` environment variable set

2. **Run refine**:
   - [ ] Execute `/refine {test-issue-id}` on a test issue
   - [ ] Review the breakdown presentation
   - [ ] Approve the breakdown when prompted
   - [ ] Verify structured YAML output is valid

3. **Verify output structure**:
   - [ ] `status: BREAKDOWN_APPROVED` in output
   - [ ] All sub-tasks have required fields
   - [ ] Verification Gate is last task with `isVerificationGate: true`
   - [ ] `blockedBy` arrays contain valid order references
   - [ ] Dependency graph mermaid matches blocking relationships

4. **Verify mobius loop creation** (after loop processes output):
   - [ ] All sub-tasks created in issue tracker
   - [ ] Blocking relationships established correctly
   - [ ] Dependency diagram comment posted to parent

5. **Verify execution**:
   - [ ] `mobius loop {parent-id}` respects dependency order
   - [ ] Blocked tasks wait for blockers to complete
   - [ ] Parallel execution works for unblocked tasks
</end_to_end_test>
</testing>
