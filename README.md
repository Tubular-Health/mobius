<p align="center">
  <img src="mobius.svg" alt="Mobius" width="180" />
</p>

<h1 align="center">Mobius</h1>

<p align="center">
  <strong>Autonomous AI development that works with your existing workflow</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/mobius"><img src="https://img.shields.io/npm/v/mobius?style=flat-square" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=flat-square" alt="Node.js 18+"></a>
</p>

<p align="center">
  Define issues in Linear. Let Claude implement them. Review and ship.
</p>

---

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [The Execution Loop](#the-execution-loop)
- [Why Mobius?](#why-mobius)
- [The 4 Skills](#the-4-skills)
- [Configuration](#configuration)
- [Backend Architecture](#backend-architecture)
- [Project Setup](#project-setup-agentsmd)
- [Sandbox Mode](#sandbox-mode)
- [Requirements](#requirements)
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

## The Solution

Mobius uses **your existing Linear issues** as the source of truth. No new systems to learn. No state files to merge. Your team already knows how to use Linear.

| What You Do | What Mobius Does |
|-------------|------------------|
| Create a Linear issue | Break it into focused sub-tasks |
| Run `mobius ABC-123` | Execute each sub-task autonomously |
| Review the PR | Validate against acceptance criteria |

---

## How It Works

<p align="center">
  <img src="assets/diagrams/workflow.svg" alt="Mobius Workflow" width="700" />
</p>

---

## Quick Start

Get from zero to executing your first issue:

```bash
npm install -g mobius
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
git clone https://github.com/your-username/mobius.git
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

## Why Mobius?

| Feature | Mobius | GSD | Beads |
|---------|--------|-----|-------|
| **State management** | Linear (existing tracker) | PROJECT.md, STATE.md files | .beads/ SQLite + daemon |
| **Setup** | `npm install -g mobius` | Clone + configure file structure | Clone + daemon + database |
| **Team workflow** | Works with existing process | Requires learning new system | Requires syncing database |
| **Merge conflicts** | None — state is external | Frequent on state files | Database sync issues |
| **Resumability** | Stop/resume anytime | Manual state management | Daemon must be running |
| **Sandbox mode** | Docker isolation built-in | None | None |

---

## The 4 Skills

Mobius provides four skills for the complete issue lifecycle. Currently implemented for Linear; the architecture supports additional backends.

<details>
<summary><code>/linear:define</code> — Create well-defined issues</summary>

Through Socratic questioning, Claude helps you create issues with:
- Clear title and description
- Measurable acceptance criteria
- Appropriate labels and priority

```bash
claude "/linear:define"
```

</details>

<details>
<summary><code>/linear:refine</code> — Break into sub-tasks</summary>

Analyzes your codebase and creates sub-tasks that are:
- Small enough for single-file focus
- Ordered with blocking dependencies
- Detailed with specific files and changes

```bash
claude "/linear:refine ABC-123"
```

</details>

<details>
<summary><code>/linear:execute</code> — Implement one sub-task</summary>

Executes the next ready sub-task:
1. Reads parent issue context
2. Implements the change
3. Runs validation commands
4. Commits and pushes
5. Marks sub-task complete

```bash
claude "/linear:execute ABC-123"
```

Or use the CLI for continuous execution:
```bash
mobius ABC-123
```

</details>

<details>
<summary><code>/linear:verify</code> — Validate completion</summary>

Reviews implementation against acceptance criteria:
- Compares changes to requirements
- Runs final validation
- Adds review notes as Linear comment
- Marks issue complete if passing

```bash
claude "/linear:verify ABC-123"
```

</details>

---

## Configuration

<details>
<summary>View configuration options</summary>

### Config File

Edit `~/.config/mobius/config.yaml`:

```yaml
backend: linear

execution:
  delay_seconds: 3
  max_iterations: 50
  model: opus
  sandbox: true
  container_name: mobius-sandbox
```

### Environment Variables

Override any setting with environment variables:

```bash
export MOBIUS_BACKEND=linear
export MOBIUS_DELAY_SECONDS=5
export MOBIUS_MAX_ITERATIONS=100
export MOBIUS_MODEL=sonnet
export MOBIUS_SANDBOX_ENABLED=false
```

### Commands

```bash
mobius config          # Show current configuration
mobius config --edit   # Open config in editor
```

</details>

---

## Backend Architecture

<p align="center">
  <img src="assets/diagrams/architecture.svg" alt="Backend Architecture" width="600" />
</p>

Mobius uses a skill-based architecture that abstracts the issue tracker. While **Linear is the primary supported backend**, the architecture is designed for extensibility.

Each backend has corresponding skills at `.claude/skills/<backend>/`. The pattern supports adding new backends (Jira, GitHub Issues, etc.) by implementing the skill interface:

| Backend | Status | Skills Location |
|---------|--------|-----------------|
| **Linear** | Supported | `.claude/skills/*-linear-issue/` |
| Jira | Planned | `.claude/skills/*-jira-issue/` |
| GitHub Issues | Planned | `.claude/skills/*-github-issue/` |

---

## Project Setup: AGENTS.md

Copy the template to your project root to provide context each iteration:

```bash
cp /path/to/mobius/AGENTS.md ./AGENTS.md
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
| **Linear account** | Primary supported backend; architecture supports additional backends |
| **Docker** (optional) | For sandbox mode |

---

## CLI Reference

```bash
mobius <issue-id> [iterations]   # Execute sub-tasks
mobius ABC-123                   # Run until complete
mobius ABC-123 10                # Limit to 10 iterations
mobius ABC-123 --local           # Bypass sandbox
mobius ABC-123 --model=sonnet    # Use specific model

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

### Mobius stops unexpectedly

Check iteration limit:
```bash
mobius config
```

Increase `max_iterations` or set to `0` for unlimited.

### Sub-tasks not executing in order

Ensure sub-tasks have proper `blockedBy` relationships. Run `/linear:refine` again if dependencies are missing.

### Linear MCP not configured

Ensure Linear MCP tools are configured in your Claude settings. Check with:
```bash
mobius doctor
```

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
claude "/linear:execute ABC-123"
```

Claude will retry the failed task.

</details>

---

<p align="center">
  <strong>MIT License</strong>
</p>

<p align="center">
  <code>npm install -g mobius && mobius setup</code>
</p>
