---
description: Break down a Linear issue into actionable sub-tasks with dependencies
argument-hint: <issue-id>
allowed-tools: Skill(refine-linear-issue)
---

<objective>
Delegate Linear issue refinement to the refine-linear-issue skill for: $ARGUMENTS

This routes to specialized skill that performs deep codebase exploration and creates single-file-focused sub-tasks with blocking relationships.
</objective>

<process>
1. Use Skill tool to invoke refine-linear-issue skill
2. Pass Linear issue ID: $ARGUMENTS
3. Let skill handle research, decomposition, and sub-task creation
</process>

<success_criteria>
- Skill successfully invoked
- Issue ID passed correctly to skill
</success_criteria>
