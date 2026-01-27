<div align="center">

```
███╗   ███╗ ██████╗ ██████╗ ██╗██╗   ██╗███████╗
████╗ ████║██╔═══██╗██╔══██╗██║██║   ██║██╔════╝
██╔████╔██║██║   ██║██████╔╝██║██║   ██║███████╗
██║╚██╔╝██║██║   ██║██╔══██╗██║██║   ██║╚════██║
██║ ╚═╝ ██║╚██████╔╝██████╔╝██║╚██████╔╝███████║
╚═╝     ╚═╝ ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝ ╚══════╝
```

**Autonomous AI development that works with your existing workflow.**

**Define issues in Linear or Jira. Let Claude implement them. Review and ship.**

[![npm version](https://img.shields.io/npm/v/mobius-loop?style=for-the-badge&logo=npm&logoColor=white&color=CB3837)](https://www.npmjs.com/package/mobius-loop)
[![License](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)

<br>

```bash
npm install -g mobius-loop && mobius setup
```

**Works on Mac, Windows, and Linux.**

</div>

---

## Table of Contents

- [The Problem](#the-problem)
- [Why Mobius?](#why-mobius)
- [Workflow Lifecycle](#workflow-lifecycle)
- [TUI Dashboard](#tui-dashboard)
- [Quick Start](#quick-start)
- [The 4 Skills](#the-4-skills)
- [The Execution Loop](#the-execution-loop)
- [Parallel Execution](#parallel-execution)
- [Configuration](#configuration)
- [Jira Setup](#jira-setup)
- [Switching Backends](#switching-backends)
- [Backend Architecture](#backend-architecture)
- [Project Setup](#project-setup-agentsmd)
- [Sandbox Mode](#sandbox-mode)
- [Requirements](#requirements)
- [Environment Variables](#environment-variables)
- [CLI Reference](#cli-reference)
- [Troubleshooting](#troubleshooting)

---

## The Problem

AI-assisted coding has a coordination problem:

- **Context amnesia** — Every session starts from scratch, losing prior decisions
- **Manual orchestration** — You become the glue between AI and your issue tracker
- **Team blindness** — No visibility into what AI is doing or has done
- **Scope creep** — Without guardrails, AI changes spiral beyond the original ask
- **Risky autonomy** — Letting AI run unattended feels dangerous

---

## Why Mobius?

<!-- TODO: Expand with context efficiency benefits (MOB-110) -->

Mobius uses **your existing issue tracker** as the source of truth. No new systems to learn. No state files to merge. Your team already knows how to use Linear or Jira.

| What You Do | What Mobius Does |
|-------------|------------------|
| Create an issue (Linear or Jira) | Break it into focused sub-tasks |
| Run `mobius ABC-123` | Execute each sub-task autonomously |
| Review the PR | Validate against acceptance criteria |

| Feature | Mobius | GSD | Beads |
|---------|--------|-----|-------|
| **State management** | Linear (existing tracker) | PROJECT.md, STATE.md files | .beads/ SQLite + daemon |
| **Setup** | `npm install -g mobius-loop` | Clone + configure file structure | Clone + daemon + database |
| **Team workflow** | Works with existing process | Requires learning new system | Requires syncing database |
| **Merge conflicts** | None — state is external | Frequent on state files | Database sync issues |
| **Resumability** | Stop/resume anytime | Manual state management | Daemon must be running |
| **Sandbox mode** | Docker isolation built-in | None | None |

---

## Workflow Lifecycle

<!-- TODO: Add workflow lifecycle content (MOB-109) -->
<!-- TODO: Add workflow diagram (MOB-105) -->

The complete Mobius workflow from issue creation to PR submission:

```
/define  →  Create story/task with clear acceptance criteria
    ↓
/refine  →  Explore codebase, create sub-tasks with dependencies
    ↓
mobius   →  Execute task DAG with parallel agents (TUI dashboard)
    ↓
/verify  →  Validate all work against acceptance criteria and tests
    ↓
mobius submit  →  Create PR with linked issues
```

<p align="center">
  <img src="assets/diagrams/workflow.svg" alt="Mobius Workflow" width="700" />
</p>

---

## TUI Dashboard

<!-- TODO: Add TUI Dashboard content (MOB-108) -->

Real-time visualization of parallel agent execution status.

<p align="center">
  <!-- TODO: Add TUI diagram/screenshot (MOB-108) -->
  <em>TUI Dashboard showing parallel agent status</em>
</p>

---

## Quick Start

Get from zero to executing your first issue:

```bash
npm install -g mobius-loop
mobius setup
mobius ABC-123
```

<p align="center">
  <img src="assets/terminal/setup.svg" alt="Mobius Setup" width="700" />
</p>

<details>
<summary>Alternative installation methods</summary>

### Manual Installation

```bash
git clone https://github.com/Tubular-Health/mobius.git
cd mobius
./install.sh
```

The installer places:
- `mobius` command in `~/.local/bin/`
- Config at `~/.config/mobius/config.yaml`
- Claude skills in `~/.claude/skills/`

Ensure `~/.local/bin` is in your PATH:
```bash
export PATH="$HOME/.local/bin:$PATH"
```

</details>

---

## The 4 Skills

Mobius provides four unified skills for the complete issue lifecycle, supporting both Linear and Jira backends. The skills automatically detect your configured backend and use the appropriate API.

<details>
<summary><code>/define</code> — Create well-defined issues</summary>

Through Socratic questioning, Claude helps you create issues with:
- Clear title and description
- Measurable acceptance criteria
- Appropriate labels and priority

```bash
claude "/define"
```

Works with both Linear and Jira based on your `backend` config setting.

</details>

<details>
<summary><code>/refine</code> — Break into sub-tasks</summary>

Analyzes your codebase and creates sub-tasks that are:
- Small enough for single-file focus
- Ordered with blocking dependencies
- Detailed with specific files and changes

```bash
claude "/refine ABC-123"    # Linear
claude "/refine PROJ-123"   # Jira
```

</details>

<details>
<summary><code>/execute</code> — Implement one sub-task</summary>

Executes the next ready sub-task:
1. Reads parent issue context
2. Implements the change
3. Runs validation commands
4. Commits and pushes
5. Marks sub-task complete

```bash
claude "/execute ABC-123"
```

Or use the CLI for continuous execution:
```bash
mobius ABC-123
```

</details>

<details>
<summary><code>/verify</code> — Validate completion</summary>

Reviews implementation against acceptance criteria:
- Compares changes to requirements
- Runs final validation
- Adds review notes as issue comment
- Marks issue complete if passing

```bash
claude "/verify ABC-123"
```

</details>

### Backend-Specific Aliases

For explicit backend selection, you can also use:

| Unified Command | Linear Alias | Jira Alias |
|-----------------|--------------|------------|
| `/define` | `/linear:define` | `/jira:define` |
| `/refine` | `/linear:refine` | `/jira:refine` |
| `/execute` | `/linear:execute` | `/jira:execute` |
| `/verify` | `/linear:verify` | `/jira:verify` |

---

## The Execution Loop

When you run `mobius ABC-123`, here's what happens:

<p align="center">
  <img src="assets/diagrams/execution-loop.svg" alt="Execution Loop" width="600" />
</p>

```
do {
    task = findNextReady(issue)      // Respects blockedBy dependencies

    implement(task)                   // Single-file focus per sub-task

    validate()                        // Tests, typecheck, lint

    commit()                          // Descriptive message, push

    markComplete(task)                // Update Linear status

} while (hasReadyTasks(issue))
```

<p align="center">
  <img src="assets/terminal/execution.svg" alt="Mobius Execution" width="800" />
</p>

**Stop anytime. Resume later.** State lives in Linear, not local files.

---

## Parallel Execution

Mobius supports parallel sub-task execution with git worktree isolation. When sub-tasks have no blocking dependencies, multiple Claude agents work simultaneously.

### How It Works

```
mobius loop MOB-123
    ↓
1. Creates git worktree at ../mobius-worktrees/MOB-123/
2. Creates feature branch off main
3. Builds task dependency graph from Linear
4. Spawns N parallel agents for unblocked tasks
5. Agents share worktree, git operations serialized
6. Loop continues until all tasks complete
7. Worktree cleaned up on success
```

### Task Dependency Visualization

Before execution, Mobius displays the task tree in your terminal:

```
Task Tree for MOB-123:
├── [✓] MOB-124: Setup base types
├── [✓] MOB-125: Create utility functions
├── [→] MOB-126: Implement parser (blocked by: MOB-124, MOB-125)
│   └── [·] MOB-127: Add tests (blocked by: MOB-126)
├── [→] MOB-128: Build CLI interface (blocked by: MOB-125)
└── [·] MOB-129: Integration tests (blocked by: MOB-126, MOB-128)

Legend: [✓] Done  [→] Ready  [·] Blocked  [!] In Progress
Ready for parallel execution: MOB-126, MOB-128 (2 agents)
```

A Mermaid diagram is also posted to the parent Linear issue for team visibility.

### Commands

```bash
mobius loop MOB-123             # Parallel execution (default)
mobius loop MOB-123 --parallel=5  # Override max parallel agents
mobius MOB-123 --sequential     # Sequential execution (bash loop)
```

### Configuration

| Option | Default | Environment Variable | Description |
|--------|---------|---------------------|-------------|
| `max_parallel_agents` | `3` | `MOBIUS_MAX_PARALLEL_AGENTS` | Maximum concurrent Claude agents (1-10) |
| `worktree_path` | `../<repo>-worktrees/` | `MOBIUS_WORKTREE_PATH` | Base directory for worktrees |
| `cleanup_on_success` | `true` | `MOBIUS_CLEANUP_ON_SUCCESS` | Auto-remove worktree on success |
| `base_branch` | `main` | `MOBIUS_BASE_BRANCH` | Branch for feature branches |

### Requirements

- **tmux** - Required for parallel execution display
  - macOS: `brew install tmux`
  - Linux: `apt install tmux`

If tmux is unavailable, use `--sequential` for bash-based execution.

---

## Configuration

<details>
<summary>View configuration options</summary>

### Config File

Edit `~/.config/mobius/config.yaml`:

```yaml
# Issue tracker backend: linear | jira
backend: linear

# Linear configuration (default)
linear:
  # Uses Linear MCP tools (auto-configured via Claude Code)
  # No additional configuration required

# Jira configuration (uncomment when using Jira)
# jira:
#   base_url: https://your-org.atlassian.net
#   project_key: PROJ
#   auth_method: api_token

execution:
  delay_seconds: 3
  max_iterations: 50
  model: opus
  sandbox: true
  container_name: mobius-sandbox

  # Parallel execution settings
  max_parallel_agents: 3
  worktree_path: "../<repo>-worktrees/"
  cleanup_on_success: true
  base_branch: "main"
```

### Environment Variables

Override any setting with environment variables:

```bash
export MOBIUS_BACKEND=linear
export MOBIUS_DELAY_SECONDS=5
export MOBIUS_MAX_ITERATIONS=100
export MOBIUS_MODEL=sonnet
export MOBIUS_SANDBOX_ENABLED=false

# Parallel execution settings
export MOBIUS_MAX_PARALLEL_AGENTS=5
export MOBIUS_WORKTREE_PATH="../custom-worktrees/"
export MOBIUS_CLEANUP_ON_SUCCESS=false
export MOBIUS_BASE_BRANCH=develop
```

### Commands

```bash
mobius config          # Show current configuration
mobius config --edit   # Open config in editor
```

</details>

---

## Jira Setup

<details>
<summary>Configure Mobius for Jira</summary>

### 1. Update Configuration

Edit `~/.config/mobius/config.yaml`:

```yaml
backend: jira

jira:
  base_url: https://your-org.atlassian.net
  project_key: PROJ
  auth_method: api_token
```

### 2. Generate API Token

1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**
3. Give it a name (e.g., "Mobius")
4. Copy the generated token

### 3. Set Environment Variable

```bash
export JIRA_API_TOKEN="your-api-token-here"

# Add to your shell profile for persistence
echo 'export JIRA_API_TOKEN="your-api-token-here"' >> ~/.bashrc
```

### 4. Configure Claude MCP Plugin

The Jira MCP plugin must be configured in your Claude Code settings. Add to your MCP configuration:

```json
{
  "mcpServers": {
    "jira": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-jira"],
      "env": {
        "JIRA_BASE_URL": "https://your-org.atlassian.net",
        "JIRA_EMAIL": "your-email@company.com",
        "JIRA_API_TOKEN": "${JIRA_API_TOKEN}"
      }
    }
  }
}
```

### 5. Verify Setup

```bash
mobius doctor
```

This will confirm Jira connectivity and MCP plugin availability.

### Example Jira Workflow

```bash
# Define a new Jira issue
claude "/define"

# Break down into sub-tasks
claude "/refine PROJ-123"

# Execute sub-tasks (parallel by default)
mobius loop PROJ-123

# Verify implementation
claude "/verify PROJ-123"
```

</details>

---

## Switching Backends

<details>
<summary>How to switch between Linear and Jira</summary>

### Global Switch

Change the `backend` setting in your config:

```yaml
# ~/.config/mobius/config.yaml
backend: jira  # or 'linear'
```

### Per-Session Switch

Use environment variable to override:

```bash
# Use Jira for this session
MOBIUS_BACKEND=jira mobius PROJ-123

# Use Linear for this session
MOBIUS_BACKEND=linear mobius ABC-123
```

### Per-Project Configuration

Create a `mobius.config.yaml` in your project root to override the global config:

```yaml
# /path/to/project/mobius.config.yaml
backend: jira

jira:
  base_url: https://your-org.atlassian.net
  project_key: MYPROJ
```

Project-level config takes precedence over global config.

### Backend Detection Order

Mobius determines the backend in this order:
1. `MOBIUS_BACKEND` environment variable
2. `mobius.config.yaml` in project root
3. `~/.config/mobius/config.yaml`
4. Default: `linear`

</details>

---

## Backend Architecture

<p align="center">
  <img src="assets/diagrams/architecture.svg" alt="Backend Architecture" width="600" />
</p>

Mobius uses a skill-based architecture that abstracts the issue tracker. **Both Linear and Jira are fully supported** through unified skills that detect your configured backend.

The unified skills at `.claude/skills/` use progressive disclosure to provide backend-specific MCP tool documentation while keeping workflow logic backend-agnostic:

| Backend | Status | MCP Plugin |
|---------|--------|------------|
| **Linear** | Supported | `@anthropic/mcp-server-linear` |
| **Jira** | Supported | `@anthropic/mcp-server-jira` |
| GitHub Issues | Planned | — |

---

## Project Setup: AGENTS.md

Copy the template to your project root to provide context each iteration:

```bash
cp /path/to/mobius/templates/AGENTS.md ./AGENTS.md
```

This file tells Claude about your project:
- Build and validation commands
- Codebase patterns and conventions
- Common issues and solutions
- Files that should not be modified

<details>
<summary>Example AGENTS.md</summary>

```markdown
## Build & Validation

- **Tests:** `npm test`
- **Typecheck:** `npm run typecheck`
- **Lint:** `npm run lint`

## Codebase Patterns

- Components: `src/components/` - React, PascalCase
- Services: `src/services/` - Business logic
- Tests: `__tests__/` directories, `.spec.ts` suffix

## Common Issues

- Always reset mocks in `beforeEach`
- Use absolute imports from `@/`
```

</details>

---

## Sandbox Mode

By default, Mobius runs Claude in a Docker container for safer autonomous execution. This isolates file system changes and prevents accidental damage to your system.

```bash
# Run in sandbox (default)
mobius ABC-123

# Run locally (bypass sandbox)
mobius ABC-123 --local
```

To disable sandbox permanently:
```yaml
execution:
  sandbox: false
```

---

## Requirements

| Requirement | Notes |
|-------------|-------|
| **Node.js 18+** | For npm installation |
| **Claude Code CLI** | Install from [claude.ai/code](https://claude.ai/code) |
| **Git** | Required for worktree operations; remote must be configured |
| **Linear or Jira account** | Both backends fully supported |
| **tmux** (optional) | Required for parallel execution; use `--sequential` without it |
| **Docker** (optional) | For sandbox mode |

---

## Environment Variables

| Variable | Backend | Required | Description |
|----------|---------|----------|-------------|
| `LINEAR_API_KEY` | linear | Yes | API key from [Linear Settings > API](https://linear.app/settings/api) |
| `JIRA_API_TOKEN` | jira | Yes | API token from [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_EMAIL` | jira | Yes | Email address associated with your Atlassian account |

Set environment variables in your shell profile:
```bash
export LINEAR_API_KEY="lin_api_xxxxx"
# or for Jira:
export JIRA_API_TOKEN="your-api-token"
export JIRA_EMAIL="you@company.com"
```

---

## CLI Reference

```bash
# Parallel execution (default)
mobius loop ABC-123              # Run parallel loop until complete
mobius loop ABC-123 --parallel=5 # Override max parallel agents
mobius ABC-123                   # Alias for parallel loop

# Sequential execution
mobius ABC-123 --sequential      # Use bash sequential loop
mobius ABC-123 10                # Limit to 10 iterations
mobius ABC-123 --local           # Bypass sandbox
mobius ABC-123 --model=sonnet    # Use specific model

# Management commands
mobius setup                     # Interactive setup wizard
mobius config                    # Show configuration
mobius config --edit             # Edit configuration
mobius doctor                    # Check system requirements
mobius --help                    # Show help
```

---

## Troubleshooting

<details>
<summary>Common issues and solutions</summary>

### "Claude CLI not found"

Install Claude Code CLI from [claude.ai/code](https://claude.ai/code).

### "cclean not found"

The `cclean` utility formats Claude's JSON output. Mobius works without it, but output will be less readable.

### "Git not configured"

Ensure you're in a git repository with a remote configured:
```bash
git remote -v  # Should show origin URL
```

If no remote, add one:
```bash
git remote add origin https://github.com/your/repo.git
```

### Mobius stops unexpectedly

Check iteration limit:
```bash
mobius config
```

Increase `max_iterations` or set to `0` for unlimited.

### Sub-tasks not executing in order

Ensure sub-tasks have proper `blockedBy` relationships. Run `/refine` again if dependencies are missing.

### Linear MCP not configured

Ensure Linear MCP tools are configured in your Claude settings. Check with:
```bash
mobius doctor
```

### Jira MCP not configured

Ensure the Jira MCP plugin is properly configured:

1. Verify your API token:
```bash
echo $JIRA_API_TOKEN
```

2. Check MCP configuration in Claude Code settings
3. Verify base URL is correct (should end with `.atlassian.net`)
4. Run `mobius doctor` to validate connectivity

### Jira authentication failed

Common causes:
- **Invalid API token**: Generate a new token from [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
- **Wrong email**: The `JIRA_EMAIL` must match your Atlassian account email
- **Permissions**: Ensure your account has access to the specified project

### Docker sandbox fails to start

Verify Docker is running:
```bash
docker info
```

If issues persist, run without sandbox:
```bash
mobius ABC-123 --local
```

### Permission denied errors

Ensure `~/.local/bin` is in your PATH and mobius is executable:
```bash
chmod +x ~/.local/bin/mobius
```

### Sub-task implementation fails validation

The task will remain incomplete. Fix the issue manually or run:
```bash
claude "/execute ABC-123"
```

Claude will retry the failed task.

### tmux not found

The parallel `loop` command requires tmux. Install it:
```bash
# macOS
brew install tmux

# Ubuntu/Debian
apt install tmux
```

Or use sequential mode:
```bash
mobius ABC-123 --sequential
```

### Worktree already exists

If a previous run was interrupted, the worktree may still exist:
```bash
# List worktrees
git worktree list

# Remove the stuck worktree
git worktree remove ../mobius-worktrees/ABC-123
```

### Parallel agents failing

If agents are failing in parallel mode:
1. Check the tmux session for error output: `tmux attach -t mobius-ABC-123`
2. Worktree is preserved on failure for debugging
3. Review individual agent logs in the tmux panes

</details>

---

<p align="center">
  <strong>MIT License</strong>
</p>

<p align="center">
  <code>npm install -g mobius-loop && mobius setup</code>
</p>
