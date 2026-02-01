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

### Local mode — no account needed

Get started in under a minute with zero external dependencies:

```bash
npm install -g mobius-ai
mobius setup
```

During setup, select **local** as your backend. Then define your first issue:

```bash
claude "/define"
```

Mobius walks you through creating a well-structured issue, breaks it into sub-tasks, and executes them. All state is stored locally in `.mobius/`.

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

## How It Works

Mobius uses a **local-first state model** — all issue data, sub-tasks, and execution history live in your repository under `.mobius/`.

```
.mobius/
  issues/
    MOB-248/
      context.json          # Parent issue + sub-tasks + metadata
      tasks/
        task-001.json       # Sub-task: one file, one concern
        task-002.json
        task-VG.json        # Verification gate (final check)
      execution/
        iterations.json     # Commit hashes, timing, verification results
```

### Sub-task decomposition

During refinement, Mobius analyzes your codebase and breaks each issue into **single-file sub-tasks** with explicit blocking dependencies. Each sub-task:

- Targets exactly one file (or a source + test pair)
- Has clear acceptance criteria
- Declares what it blocks and what blocks it
- Fits within a single context window

This structure means agents never need your entire codebase — only the file they're modifying and the context from completed dependencies.

### Git worktrees for isolation

When running in parallel, each agent operates in its own **git worktree** — a separate working directory backed by the same repository. Worktrees prevent agents from stepping on each other's uncommitted changes while sharing the same commit history.

```
your-repo/                          # Main working directory
../your-repo-worktrees/
  task-001/                         # Agent 1's isolated worktree
  task-002/                         # Agent 2's isolated worktree
```

### Recovery

Every completed sub-task is committed and pushed independently. If an agent fails or is interrupted, the loop resumes from the last successful sub-task — no work is lost.

---

## The 4 Skills

Mobius provides four skills that map to the issue lifecycle. Each is invoked through Claude Code.

### Define

Create issues with clear acceptance criteria through Socratic questioning. Mobius asks clarifying questions until the spec is unambiguous.

```bash
claude "/define"              # Local mode — stored in .mobius/
claude "/define MOB-123"      # Linear/Jira — updates existing issue
```

### Refine

Explore your codebase, identify affected files, and decompose the issue into focused sub-tasks with a dependency graph.

```bash
claude "/refine MOB-123"
```

Spawns architecture agents in parallel to deep-dive each work unit. Produces sub-task files in `.mobius/issues/{id}/tasks/` and creates a verification gate as the final sub-task.

### Execute

Implement exactly one sub-task per invocation: load context from dependencies, modify the target file, verify (typecheck + tests + lint), commit, and push.

```bash
claude "/execute MOB-123"     # Executes next ready sub-task
mobius loop MOB-123           # Runs execute in a loop until done
```

The loop handles iteration — each invocation picks up the next unblocked sub-task automatically.

### Verify

Multi-agent review against the original acceptance criteria. Spawns parallel review agents covering bugs, code quality, performance, security, and test coverage.

```bash
claude "/verify MOB-123"
```

If verification fails, affected sub-tasks are reopened with feedback and the loop continues with rework.

---

## Parallel Execution

Mobius can run **up to 10 concurrent agents**, each in its own git worktree. The dependency graph determines which sub-tasks are ready — tasks whose blockers are all complete execute simultaneously.

```bash
mobius loop MOB-123                   # Parallel (uses config default)
mobius loop MOB-123 --parallel=5      # 5 concurrent agents
mobius MOB-123 --sequential           # One at a time
```

Configure the default in `mobius.config.yaml`:

```yaml
execution:
  max_parallel_agents: 3              # 1–10 concurrent agents
  worktree_path: "../<repo>-worktrees/"
  cleanup_on_success: true            # Remove worktree after completion
```

Or via environment variables:

```bash
export MOBIUS_MAX_PARALLEL_AGENTS=5
export MOBIUS_WORKTREE_PATH="../worktrees/"
```

Each agent independently implements, verifies, commits, and pushes its sub-task. The loop monitors progress and feeds newly unblocked tasks to available agents.

---

## Shell Shortcuts

Source `scripts/shortcuts.sh` to get single-letter commands for the full workflow:

```bash
source scripts/shortcuts.sh     # Or add to .bashrc/.zshrc
```

| Command | Action | Equivalent |
|---------|--------|------------|
| `md` | Define a new issue | `claude "/define $MOBIUS_TASK_ID"` |
| `mr` | Refine into sub-tasks | `claude "/refine $MOBIUS_TASK_ID"` |
| `me` | Execute sub-tasks | `mobius $MOBIUS_TASK_ID` |
| `ms` | Submit PR | `mobius submit $MOBIUS_TASK_ID` |

All commands use `MOBIUS_TASK_ID` from your shell environment. If unset, you'll be prompted to enter it.

```bash
md                    # Define issue → sets MOBIUS_TASK_ID
mr                    # Refine into sub-tasks
me                    # Execute (default parallelism)
me --parallel=3       # Execute with 3 agents
ms                    # Submit PR
```

---

## Backend Setup

Mobius supports three backends. Choose the one that fits your workflow.

### Local

No external tools or accounts required. Issues are stored as JSON files in `.mobius/` within your repository.

```bash
mobius setup    # Select "local" when prompted
```

That's it. Start defining issues immediately with `claude "/define"`.

<details>
<summary><strong>Linear</strong></summary>

#### 1. Install the CLI

```bash
npm install -g linearis
```

#### 2. Set your API key

```bash
export LINEAR_API_KEY=lin_api_xxxxxxxx
```

Generate a key at **Settings > API > Personal API Keys** in Linear.

#### 3. Configure Mobius

```bash
mobius setup    # Select "linear" when prompted
```

Or set the backend manually in `mobius.config.yaml`:

```yaml
backend: linear
linear:
  team: Engineering
  project: My Project
```

</details>

<details>
<summary><strong>Jira</strong></summary>

#### 1. Install the CLI

```bash
npm install -g acli
```

#### 2. Set your credentials

```bash
export JIRA_API_TOKEN=your_api_token
export JIRA_EMAIL=you@company.com
```

Generate a token at **Atlassian Account > Security > API tokens**.

#### 3. Configure Mobius

```bash
mobius setup    # Select "jira" when prompted
```

Or set the backend manually in `mobius.config.yaml`:

```yaml
backend: jira
jira:
  base_url: https://yourcompany.atlassian.net
  project_key: PROJ
```

</details>

---

## Configuration

Mobius reads configuration from `mobius.config.yaml` in your project root.

```yaml
backend: local                        # linear | jira | local

execution:
  delay_seconds: 3                    # Pause between loop iterations
  max_iterations: 50                  # 0 = unlimited
  model: opus                         # opus | sonnet | haiku
  sandbox: true                       # Docker sandbox for safety
  max_parallel_agents: 3              # 1-10 concurrent agents
  auto_submit: true                   # Create PR after loop completes
  worktree_path: "../<repo>-worktrees/"
  cleanup_on_success: true            # Remove worktrees after completion
  base_branch: "main"
```

### Environment variable overrides

Any config value can be overridden with an environment variable:

```bash
export MOBIUS_BACKEND=linear
export MOBIUS_MAX_PARALLEL_AGENTS=5
export MOBIUS_MODEL=sonnet
export MOBIUS_SANDBOX=false
```

### Manage configuration

```bash
mobius config          # Display current configuration
mobius config --edit   # Open config in your editor
```

---

## Requirements

| Dependency | Required | Notes |
|---|---|---|
| **Node.js 18+** | Yes | Runtime |
| **Claude Code CLI** | Yes | `claude` must be available on PATH |
| **Git** | Yes | Version control and worktree support |
| **linearis** | Linear only | `npm install -g linearis` |
| **acli** | Jira only | `npm install -g acli` |
| **tmux** | Optional | Required for parallel execution; use `--sequential` as fallback |
| **Docker** | Optional | Required for sandbox mode; use `--no-sandbox` to bypass |

### Environment variables

| Variable | Backend | Purpose |
|---|---|---|
| `LINEAR_API_KEY` | Linear | API authentication |
| `JIRA_API_TOKEN` | Jira | API authentication |
| `JIRA_EMAIL` | Jira | Account email for API requests |

Run `mobius doctor` to verify all requirements are met.

---

## Comparison

| Feature | Mobius | Cursor | Copilot Workspace | Devin | Cline | Aider |
|---|---|---|---|---|---|---|
| **Parallel agents** | Up to 10 | No | No | No | No | No |
| **Issue tracker integration** | Linear, Jira, Local | No | GitHub Issues | No | No | No |
| **Sub-task decomposition** | Automatic with dependency graph | No | No | No | No | No |
| **Verification gates** | Typecheck + tests + lint per sub-task | No | No | Partial | No | No |
| **Git worktree isolation** | Yes | No | No | No | No | No |
| **Resume on failure** | From last successful sub-task | No | No | Partial | No | No |

**Cursor** is an AI code editor focused on single-file edits within a GUI. It lacks issue tracking, parallel execution, and structured decomposition.

**GitHub Copilot Workspace** generates PR-level code suggestions from issues but does not run an autonomous execution loop or decompose work into independent sub-tasks.

**Devin** runs a single autonomous agent in a cloud sandbox. It does not support parallel agents, team-visible sub-task tracking, or local-first state.

**Cline** is a VS Code extension for chat-based coding. It does not provide structured workflows, verification gates, or issue tracker integration.

**Aider** is a CLI pair-programming tool. It excels at interactive code changes but does not integrate with issue trackers, run parallel agents, or decompose tasks with dependency graphs.

---

## CLI Reference

```bash
# Execution
mobius loop ABC-123                  # Parallel execution (default)
mobius loop ABC-123 --parallel=5     # Override max agents
mobius ABC-123                       # Alias for parallel loop
mobius ABC-123 --sequential          # Sequential execution
mobius ABC-123 --no-sandbox          # Bypass Docker sandbox
mobius ABC-123 --model=sonnet        # Use specific model

# PR and submission
mobius submit ABC-123                # Create pull request
mobius submit ABC-123 --draft        # Create draft PR
mobius submit ABC-123 --no-submit    # Skip auto-submit

# Setup and diagnostics
mobius setup                         # Interactive setup wizard
mobius config                        # Show configuration
mobius config --edit                 # Edit configuration
mobius doctor                        # Check requirements
mobius shortcuts                     # Install shell shortcuts

# Context management
mobius tree ABC-123                  # Display sub-task dependency tree
mobius pull ABC-123                  # Fetch fresh context from backend
mobius push ABC-123                  # Push local changes to backend
mobius set-id ABC-123                # Set current task ID
```

---

## Troubleshooting

<details>
<summary><strong>Claude CLI not found</strong></summary>

The `claude` command must be available on your PATH. Install Claude Code from [claude.ai/code](https://claude.ai/code) and verify:

```bash
claude --version
```

</details>

<details>
<summary><strong>Git not configured</strong></summary>

Ensure your repository has a remote configured:

```bash
git remote -v
```

If no remote is listed, add one:

```bash
git remote add origin <your-repo-url>
```

</details>

<details>
<summary><strong>tmux not found</strong></summary>

Parallel execution requires tmux. Install it for your platform:

```bash
# macOS
brew install tmux

# Ubuntu/Debian
sudo apt install tmux

# Fedora
sudo dnf install tmux
```

If you cannot install tmux, use sequential mode:

```bash
mobius loop ABC-123 --sequential
```

</details>

<details>
<summary><strong>Worktree already exists</strong></summary>

If a previous run was interrupted, stale worktrees may remain. Clean them up:

```bash
git worktree list                    # List active worktrees
git worktree remove <path>           # Remove a specific worktree
git worktree prune                   # Remove stale worktree references
```

</details>

<details>
<summary><strong>linearis not found</strong></summary>

The Linear backend requires the `linearis` CLI:

```bash
npm install -g linearis
```

</details>

<details>
<summary><strong>acli not found</strong></summary>

The Jira backend requires the Atlassian CLI:

```bash
npm install -g acli
```

</details>

<details>
<summary><strong>Docker sandbox fails</strong></summary>

Verify Docker is running:

```bash
docker info
```

If Docker is unavailable or unnecessary, bypass the sandbox:

```bash
mobius loop ABC-123 --no-sandbox
```

</details>

---

<div align="center">

**MIT License** — see [LICENSE](LICENSE) for details.

```bash
npm install -g mobius-ai && mobius setup
```

</div>
