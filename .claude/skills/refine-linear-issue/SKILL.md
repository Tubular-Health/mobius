---
name: refine-linear-issue
description: Break down a Linear issue into actionable sub-tasks through deep codebase research. Each sub-task is sized for single-file focus and context window efficiency. Creates sub-tasks with blocking relationships for parallel execution. Use when an issue needs implementation breakdown, when starting work on a complex Linear issue, or when the user mentions "refine", "break down", or "plan" for a Linear issue.
---

<objective>
Transform a Linear issue into a set of focused, executable sub-tasks through deep codebase exploration. Each sub-task targets a single file or tightly-coupled file pair, sized to fit within one Claude context window. Sub-tasks are created with blocking relationships to enable parallel work where dependencies allow.
</objective>

<context>
This skill bridges high-level Linear issues and actionable implementation work. It:

1. **Deeply researches** the codebase to understand existing patterns, dependencies, and affected areas
2. **Decomposes** work into single-file-focused tasks that Claude can complete in one session
3. **Identifies dependencies** between tasks to establish blocking relationships
4. **Creates sub-tasks** in Linear as children of the parent issue with proper blocking order

Sub-tasks are designed for autonomous execution - each should be completable without needing to reference other sub-tasks or gather additional context.
</context>

<quick_start>
<invocation>
The skill expects a Linear issue identifier as argument:

```
/refine-linear-issue VRZ-123
```

Or invoke programmatically:
```
Skill: refine-linear-issue
Args: VRZ-123
```
</invocation>

<workflow>
1. **Fetch issue** - Get full issue details from Linear including description and acceptance criteria
2. **Deep exploration** - Use Explore agent to thoroughly analyze related code, patterns, and dependencies
3. **Identify work units** - Break down into single-file-focused tasks
4. **Determine blocking order** - Analyze functional dependencies between tasks
5. **Present breakdown** - Show complete plan with all sub-tasks and their relationships
6. **Gather feedback** - Use AskUserQuestion for refinement
7. **Batch create** - Create all approved sub-tasks in Linear with blocking relationships
</workflow>
</quick_start>

<research_phase>
<fetch_issue>
First, retrieve the issue details:

```
mcp__plugin_linear_linear__get_issue
  id: "{issue-id}"
  includeRelations: true
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
1. **Create all sub-tasks** - Breakdown looks correct, create in Linear
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
After approval, create all sub-tasks in Linear:

For each sub-task in dependency order (leaves first):

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

**Important**: Create in reverse dependency order so blockedBy references exist.
</batch_creation>

<creation_order>
1. Identify leaf tasks (blocked by nothing or only by already-created tasks)
2. Create leaf tasks first
3. Work up the dependency tree
4. Store created issue IDs to reference in blockedBy for later tasks
</creation_order>

<post_creation>
After all sub-tasks created, confirm:

```markdown
Created {count} sub-tasks for {parent issue ID}:

| ID | Title | Blocked By | Status |
|----|-------|------------|--------|
| VRZ-124 | Define types | - | Ready |
| VRZ-125 | Implement service | VRZ-124 | Blocked |
| VRZ-126 | Add hook | VRZ-124 | Blocked |
| VRZ-127 | Update component | VRZ-125, VRZ-126 | Blocked |

**Ready to start**: VRZ-124
**Parallel opportunities**: After VRZ-124, can work VRZ-125 and VRZ-126 simultaneously
```
</post_creation>
</creation_phase>

<examples>
<example_breakdown>
**Parent issue**: VRZ-100 - Add dark mode support

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
- [ ] Sub-tasks created in Linear as children of parent issue
- [ ] Ready tasks (no blockers) are clearly identified
- [ ] User approved breakdown before creation
</success_criteria>
