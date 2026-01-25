---
description: Verify a completed Linear issue against its acceptance criteria
argument-hint: <issue-id>
allowed-tools: Skill(verify-linear-issue)
---

<objective>
Delegate Linear issue verification to the verify-linear-issue skill for: $ARGUMENTS

This routes to specialized skill that fetches issue context, reviews implementation against acceptance criteria, runs verification checks, and posts a review comment to Linear.
</objective>

<process>
1. Use Skill tool to invoke verify-linear-issue skill
2. Pass Linear issue ID: $ARGUMENTS
3. Let skill handle context loading, code review, verification, and Linear updates
</process>

<success_criteria>
- Skill successfully invoked
- Issue ID passed correctly to skill
</success_criteria>
