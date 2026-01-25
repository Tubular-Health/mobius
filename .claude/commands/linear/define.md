---
description: Create well-defined Linear issues using Socratic questioning
argument-hint: [issue description or type]
allowed-tools: Skill(define-linear-issue)
---

<objective>
Delegate Linear issue creation to the define-linear-issue skill for: $ARGUMENTS

This routes to specialized skill containing Socratic questioning patterns, acceptance criteria best practices, and Linear MCP integration.
</objective>

<process>
1. Use Skill tool to invoke define-linear-issue skill
2. Pass user's request: $ARGUMENTS
3. Let skill handle workflow
</process>

<success_criteria>
- Skill successfully invoked
- Arguments passed correctly to skill
</success_criteria>
