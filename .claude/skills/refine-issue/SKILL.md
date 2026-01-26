---
name: refine-issue
description: Break down issues into sub-tasks with dependencies. Supports both Linear and Jira backends via progressive disclosure. Each sub-task is sized for single-file focus and context window efficiency. Creates sub-tasks with blocking relationships for parallel execution. Use when an issue needs implementation breakdown, when starting work on a complex issue, or when the user mentions "refine", "break down", or "plan" for an issue.
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

- `mcp__plugin_jira_jira__get_issue` - Fetch issue details with relations
- `mcp__plugin_jira_jira__create_issue` - Create sub-tasks with parent link
- `mcp__plugin_jira_jira__update_issue` - Set blocking relationships via issue links
- `mcp__plugin_jira_jira__create_comment` - Post Mermaid dependency diagram

**Issue ID format**: `PROJ-123` (project key + number)

**Creating sub-tasks**:
```
mcp__plugin_jira_jira__create_issue
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
First, retrieve the issue details using the appropriate backend tool:

**For Linear**:
```
mcp__plugin_linear_linear__get_issue
  id: "{issue-id}"
  includeRelations: true
```

**For Jira**:
```
mcp__plugin_jira_jira__get_issue
  issueIdOrKey: "{issue-id}"
```

Extract:
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
For each sub-task, define:

```markdown
## Sub-task: [Sequential number] - [Brief title]

**Target file(s)**: `path/to/file.ts` (and `path/to/file.test.ts` if applicable)

**Change type**: Create | Modify | Delete

**Description**:
[2-3 sentences describing exactly what to implement in this file]

**Acceptance criteria**:
- [ ] Specific, verifiable outcome 1
- [ ] Specific, verifiable outcome 2

**Blocked by**: [List of sub-task numbers that must complete first, or "None"]

**Enables**: [List of sub-task numbers this unblocks]
```
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
mcp__plugin_jira_jira__create_comment
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

<examples>
<example_breakdown>
**Parent issue**: MOB-100 - Add dark mode support

**Exploration findings**:
- Need theme types in `src/types/theme.ts`
- ThemeProvider context in `src/contexts/ThemeContext.tsx`
- useTheme hook in `src/hooks/useTheme.ts`
- Settings toggle in `src/components/settings/ThemeToggle.tsx`
- Update 3 components that have hardcoded colors

**Breakdown**:

```
1. Define theme types
   File: src/types/theme.ts (create)
   Blocked by: None

2. Create ThemeProvider context
   File: src/contexts/ThemeContext.tsx (create)
   Blocked by: 1

3. Implement useTheme hook
   File: src/hooks/useTheme.ts (create)
   Blocked by: 2

4. Add ThemeToggle component
   File: src/components/settings/ThemeToggle.tsx (create)
   Blocked by: 3

5. Update Header with theme support
   File: src/components/layout/Header.tsx (modify)
   Blocked by: 3

6. Update Sidebar with theme support
   File: src/components/layout/Sidebar.tsx (modify)
   Blocked by: 3

7. Update Card component with theme support
   File: src/components/ui/Card.tsx (modify)
   Blocked by: 3
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
