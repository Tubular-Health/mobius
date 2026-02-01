<div align="center">

```
███╗   ███╗ ██████╗ ██████╗ ██╗██╗   ██╗███████╗
████╗ ████║██╔═══██╗██╔══██╗██║██║   ██║██╔════╝
██╔████╔██║██║   ██║██████╔╝██║██║   ██║███████╗
██║╚██╔╝██║██║   ██║██╔══██╗██║██║   ██║╚════██║
██║ ╚═╝ ██║╚██████╔╝██████╔╝██║╚██████╔╝███████║
╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ ╚══════╝
```

**Autonomous issue execution for Linear, Jira, and Local workflows.**

Break down issues into focused sub-tasks. Execute them in parallel with Claude. Ship faster.

[![npm version](https://img.shields.io/npm/v/mobius-ai?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/mobius-ai)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)

</div>

---

## Table of Contents

- [Why Mobius?](#why-mobius)
- [Quick Start](#quick-start)
- [Workflow](#workflow)
- [How It Works](#how-it-works)
- [The 4 Skills](#the-4-skills)
- [Parallel Execution](#parallel-execution)
- [Shell Shortcuts](#shell-shortcuts)
- [Backend Setup](#backend-setup)
- [Configuration](#configuration)
- [Comparison](#comparison)
- [Requirements](#requirements)
- [CLI Reference](#cli-reference)
- [Troubleshooting](#troubleshooting)

---

## Why Mobius?

Most AI coding tools feed entire codebases into a single context window. Mobius takes a different approach: it decomposes work into **focused sub-tasks** that each target a single file with minimal context.

| | Traditional AI Tools | Mobius |
|---|---|---|
| **Context** | Entire codebase in one window | Scoped to one file per sub-task |
| **Token Usage** | High — redundant context on every call | Low — 5-10x fewer tokens |
| **Accuracy** | Degrades with context size | Consistent — focused scope reduces errors |
| **Execution** | Sequential, single-threaded | Parallel — up to 10 concurrent agents |
| **State** | Hidden in chat history | Visible in Linear, Jira, or local files |
| **Recovery** | Start over on failure | Resume from last successful sub-task |
| **Safety** | Varies | Docker sandbox, scoped permissions, verification gates |

---

## Quick Start

### Local mode (no account needed)

Get started in under a minute with zero external dependencies:

```bash
npm install -g mobius-ai
mobius setup
```

During setup, select **local** as your backend. Then define your first issue:

```bash
claude "/define"
```

Mobius will walk you through creating a well-structured issue, break it into sub-tasks, and execute them — all stored locally in `.mobius/`.

### With Linear or Jira

If you already use Linear or Jira, Mobius integrates directly:

```bash
mobius setup             # Select your backend and configure credentials
mobius loop ABC-123      # Execute an existing issue
```

---

## Workflow

Every issue follows a five-step lifecycle — from idea to merged PR.

### 1. Define

Create a well-structured issue with clear acceptance criteria using Socratic questioning.

```bash
claude "/define"
```

Mobius asks clarifying questions to eliminate ambiguity, then creates the issue in your configured backend (or locally).

### 2. Refine

Analyze your codebase and decompose the issue into focused sub-tasks. Each sub-task targets a single file and has explicit blocking dependencies.

```bash
claude "/refine ABC-123"
```

### 3. Execute

Run the autonomous execution loop. Unblocked sub-tasks execute simultaneously in isolated git worktrees.

```bash
mobius loop ABC-123              # Parallel execution (default)
mobius loop ABC-123 --parallel=5 # Up to 5 concurrent agents
mobius ABC-123 --sequential      # Sequential mode
```

Each sub-task is implemented, verified (typecheck + tests + lint), committed, and pushed before moving to the next.

### 4. Verify

Review the full implementation against the original acceptance criteria. Run final validation and add review notes.

```bash
claude "/verify ABC-123"
```

### 5. Submit

Create a pull request with linked issues and structured description.

```bash
mobius submit ABC-123
```

---
