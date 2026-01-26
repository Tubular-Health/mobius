---
description: Execute the next ready sub-task from a Linear issue with full context
argument-hint: <parent-issue-id>
allowed-tools: Skill(execute-issue)
---

<objective>
Delegate Linear sub-task execution to the execute-issue skill for: $ARGUMENTS

This routes to specialized skill that primes context from parent and dependencies, implements the change, verifies, commits, pushes, and updates Linear.
</objective>

<process>
1. Use Skill tool to invoke execute-issue skill
2. Pass parent Linear issue ID: $ARGUMENTS
3. Let skill handle context priming, implementation, verification, and git operations
</process>

<success_criteria>
- Skill successfully invoked
- Issue ID passed correctly to skill
</success_criteria>
