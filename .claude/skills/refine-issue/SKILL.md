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
Read the backend from mobius config (`~/.config/mobius/config.yaml`). The `backend` field specifies which issue tracker to use.

**Supported backends**:
- `linear` (default) - Linear issue tracker
- `jira` - Atlassian Jira

If no backend is specified in config, default to `linear`.

The backend determines which MCP tools to use for issue operations. All workflow logic remains the same regardless of backend.
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

<backend_context>
<linear>
**MCP Tools for Linear backend**:

- `mcp__plugin_linear_linear__get_issue` - Fetch issue details with relations
- `mcp__plugin_linear_linear__create_issue` - Create sub-tasks with `parentId` parameter
- `mcp__plugin_linear_linear__update_issue` - Set blocking relationships via `blockedBy` array
- `mcp__plugin_linear_linear__create_comment` - Post Mermaid dependency diagram

**Issue ID format**: `MOB-123`, `VRZ-456` (team prefix + number)

**Creating sub-tasks**:
```
mcp__plugin_linear_linear__create_issue
  team: "{same team as parent}"
  title: "[{parent-id}] {sub-task title}"
  description: "{full sub-task description with acceptance criteria}"
  parentId: "{parent issue id}"
  labels: ["{inherited from parent}"]
  priority: {inherited from parent}
  state: "Backlog"
  blockedBy: ["{ids of blocking sub-tasks}"]
```
</linear>

<jira>
**MCP Tools for Jira backend**:

- `mcp_plugin_atlassian_jira__get_issue` - Fetch issue details with relations
- `mcp_plugin_atlassian_jira__create_issue` - Create sub-tasks with parent link
- `mcp_plugin_atlassian_jira__update_issue` - Set blocking relationships via issue links
- `mcp_plugin_atlassian_jira__add_comment` - Post Mermaid dependency diagram

**Issue ID format**: `PROJ-123` (project key + number)

**Creating sub-tasks**:
```
mcp_plugin_atlassian_jira__create_issue
  project: "{same project as parent}"
  summary: "[{parent-id}] {sub-task title}"
  description: "{full sub-task description with acceptance criteria}"
  parent: "{parent issue key}"
  issuetype: "Sub-task"
  labels: ["{inherited from parent}"]
  priority: {inherited from parent}
```

Note: Jira uses issue links for blocking relationships. After creating sub-tasks, use `update_issue` to add "Blocks"/"Is blocked by" links.
</jira>
</backend_context>

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
1. **Detect backend** - Read backend from mobius config (default: linear)
2. **Fetch issue** - Get full issue details including description and acceptance criteria
3. **Deep exploration** - Use Explore agent to thoroughly analyze related code, patterns, and dependencies
4. **Identify work units** - Break down into single-file-focused tasks
5. **Determine blocking order** - Analyze functional dependencies between tasks
6. **Present breakdown** - Show complete plan with all sub-tasks and their relationships
7. **Gather feedback** - Use AskUserQuestion for refinement
8. **Batch create** - Create all approved sub-tasks with blocking relationships
</workflow>
</quick_start>

<research_phase>
<fetch_issue>
Retrieve issue details using the backend-appropriate get_issue tool (see `<backend_context>` for tool names):

- Linear: `mcp__plugin_linear_linear__get_issue` with `includeRelations: true`
- Jira: `mcp_plugin_atlassian_jira__get_issue`

**Extract from response**:
- Title and description
- Acceptance criteria
- Existing relationships
- Project context
- Labels and priority
</fetch_issue>

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

**Parallelization opportunities**:
- Independent services can run in parallel
- Unrelated UI components can run in parallel
- Tests for different features can run in parallel
</ordering_principles>

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

<creation_phase>
<batch_creation>
After approval, create all sub-tasks using the appropriate backend tools.

**Important**: Create in reverse dependency order so blocking references exist.

For Linear, use `blockedBy` parameter during creation.
For Jira, create sub-tasks first, then add issue links for blocking relationships.
</batch_creation>

<creation_order>
1. Identify leaf tasks (blocked by nothing or only by already-created tasks)
2. Create leaf tasks first
3. Work up the dependency tree
4. Store created issue IDs to reference in blockedBy for later tasks
</creation_order>

<post_creation>
After all sub-tasks created, add a comment to the parent issue with the Mermaid dependency diagram:

**For Linear**:
```
mcp__plugin_linear_linear__create_comment
  issueId: "{parent-issue-id}"
  body: |
    ## Sub-task Dependency Graph

    ```mermaid
    graph TD
      A[MOB-124: Define types] --> B[MOB-125: Implement service]
      B --> C[MOB-126: Add hook]
      C --> D[MOB-127: Update component]
    ```

    **Ready to start**: MOB-124
```

**For Jira**:
```
mcp_plugin_atlassian_jira__add_comment
  issueIdOrKey: "{parent-issue-key}"
  body: |
    ## Sub-task Dependency Graph

    {code:mermaid}
    graph TD
      A[PROJ-124: Define types] --> B[PROJ-125: Implement service]
      B --> C[PROJ-126: Add hook]
      C --> D[PROJ-127: Update component]
    {code}

    *Ready to start*: PROJ-124
```

Then confirm with summary:

```markdown
Created {count} sub-tasks for {parent issue ID}:

| ID | Title | Blocked By | Status |
|----|-------|------------|--------|
| XXX-124 | Define types | - | Ready |
| XXX-125 | Implement service | XXX-124 | Blocked |
| XXX-126 | Add hook | XXX-124 | Blocked |
| XXX-127 | Update component | XXX-125, XXX-126 | Blocked |

**Ready to start**: XXX-124
**Parallel opportunities**: After XXX-124, can work XXX-125 and XXX-126 simultaneously
```
</post_creation>
</creation_phase>

<error_handling>
<fetch_failure>
If issue fetch fails:
1. Verify issue ID format matches backend pattern (see `<input_validation>`)
2. Check MCP tool availability for the detected backend
3. Report error with suggested action:
   - "Issue not found" - Verify issue ID exists in your tracker
   - "Permission denied" - Check API token permissions
   - "MCP tool unavailable" - Verify Linear/Jira plugin is configured
</fetch_failure>

<creation_failure>
If sub-task creation fails:
1. Do NOT retry failed tasks automatically
2. Report which tasks succeeded and which failed with IDs
3. Provide manual recovery:
   - Successfully created: List IDs for reference
   - Failed tasks: Re-run with just the failed sub-tasks
   - Blocking relationships: May need manual update if partial success
</creation_failure>
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
```

**Parallel groups**:
- [1] → [2] → [3] (sequential foundation)
- [4], [5], [6], [7] can all run in parallel after [3]
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

- [ ] All affected files identified through deep exploration
- [ ] Each sub-task targets exactly one file (or source + test pair)
- [ ] Every sub-task has clear, verifiable acceptance criteria
- [ ] Blocking relationships are logically sound
- [ ] No circular dependencies exist
- [ ] Parallel opportunities are maximized
- [ ] Sub-tasks created as children of parent issue
- [ ] Ready tasks (no blockers) are clearly identified
- [ ] User approved breakdown before creation
- [ ] Mermaid dependency diagram posted to parent issue
</success_criteria>
