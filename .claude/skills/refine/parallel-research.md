# Per-Task Subagent Pattern

Reference document for the Phase 3 per-task subagent research pattern used by the refine skill.

## Overview

Instead of the main agent writing all sub-task descriptions itself, Phase 3 spawns `feature-dev:code-architect` subagents — one per work unit — to deep-dive into the target files and produce complete sub-task write-ups. This produces higher-quality descriptions because each subagent focuses its full context window on a single work unit.

## When to Use

**Always** — this is the default flow for all refined issues. The main agent identifies work units (Phase 2) and delegates description writing to subagents (Phase 3). The only exception is if a subagent fails and retry also fails, in which case the main agent writes that sub-task's description manually as a fallback.

## Why `feature-dev:code-architect`

The `feature-dev:code-architect` subagent type is purpose-built for this task:

- **Analyzes existing codebase patterns** — reads target files and nearby code to understand conventions
- **Designs component-level implementations** — produces specific file-level guidance (Action, Avoid sections)
- **Maps data flows and dependencies** — identifies what the task depends on and what it enables
- **Has read-only codebase access** — can Glob, Grep, Read files but cannot write, keeping the operation safe

Other agent types considered and rejected:
- `Explore` — good for broad discovery (used in Phase 1) but lacks the architectural design focus needed for writing implementation guidance
- `feature-dev:code-explorer` — traces execution paths well but doesn't produce implementation blueprints
- `feature-dev:code-reviewer` — reviews existing code, doesn't design new implementations

## Batching Strategy

**Batch size**: Up to 3 subagents simultaneously.

**Rationale**:
- 3 concurrent agents balances throughput against system resource limits
- Matches the existing `<context_sizing>` rule of "maximum 3 tasks per batch"
- Prevents context window pressure on the main agent managing results

**Batch ordering**:
- Work units are batched in order (1-3, 4-6, 7-9, etc.)
- If a work unit's description depends on another's output (rare — usually only dependency hints matter, not full descriptions), place it in a later batch
- All subagents in a batch run in parallel; the main agent waits for the full batch to complete before launching the next

**Example** (7 work units):
```
Batch 1: Work Units 1, 2, 3 → 3 parallel subagents
  [wait for all 3 to complete]
Batch 2: Work Units 4, 5, 6 → 3 parallel subagents
  [wait for all 3 to complete]
Batch 3: Work Unit 7 → 1 subagent
  [wait for completion]
→ Proceed to Phase 4 aggregation
```

## Input Spec

Each subagent receives a prompt containing:

| Field | Source | Description |
|-------|--------|-------------|
| Parent issue title | MCP fetch | Title of the parent issue being refined |
| Parent issue description | MCP fetch | Full description including acceptance criteria |
| Architecture context | Phase 1 Explore agent | Affected files, patterns, dependency graph, conventions |
| Target file(s) | Phase 2 work unit brief | Primary file path(s) and change type (Create/Modify) |
| Rough scope | Phase 2 work unit brief | Approximate size and nature of changes |
| Related areas | Phase 2 work unit brief | Nearby files to examine for patterns |
| Dependency hints | Phase 2 work unit brief | Which work units this depends on / enables |

See `<subagent_prompt_template>` in SKILL.md for the exact prompt format.

## Output Spec

Each subagent returns a markdown document with these required sections:

| Section | Required | Description |
|---------|----------|-------------|
| Summary | Yes | 1-2 sentences describing what the sub-task accomplishes |
| Context | Yes | Links back to parent issue |
| Target File(s) | Yes | Concrete file path(s) with change type |
| Action | Yes | 2-4 sentences of specific implementation guidance |
| Avoid | Yes | Anti-patterns with reasons (at least 1) |
| Acceptance Criteria | Yes | Measurable outcomes as checklist (2-4 items) |
| Verify Command | Yes | Executable bash command proving completion |
| Dependencies | Yes | Blocked by / Enables references |

## Fallback Behavior

**Retry once**: If a subagent returns incomplete or malformed output (missing required sections, placeholder file paths, pseudocode verify commands), retry with a clarifying note appended:

```
IMPORTANT: Your previous output was incomplete. Ensure ALL of the following sections
are present with concrete values (no placeholders): Summary, Context, Target File(s),
Action, Avoid, Acceptance Criteria, Verify Command, Dependencies.
```

**Manual fallback**: If retry also fails, the main agent writes the sub-task description manually using:
- Phase 1 exploration data (architecture overview, file list)
- Phase 2 work unit brief (target files, scope, dependencies)
- The standard sub-task template from `<task_structure_full>`

Log which work units required manual fallback for debugging.
