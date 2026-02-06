---
name: agent-gen
description: Generate a repo-tailored AGENTS.md file by analyzing the project's tech stack, build commands, codebase patterns, git history, and CI configuration. Presents the result for user approval before writing.
invocation: /agent-gen
---

<objective>
Autonomously analyze the current repository and generate a comprehensive, repo-tailored AGENTS.md file. The generated file provides operational context for autonomous Claude execution — build commands, codebase patterns, commit conventions, common issues, and project structure.

Key behavior:
- Detect tech stack from config file markers
- Discover and validate build/test/lint commands by running them
- Analyze git history for commit conventions and common issues
- Detect CI configuration
- Generate all 6 AGENTS.md sections from collected data
- Present complete AGENTS.md for user approval before writing
- Back up existing AGENTS.md before overwriting
</objective>

<quick_start>
<invocation>
```
/agent-gen              # Analyze current repo and generate AGENTS.md
/agent-gen --force      # Regenerate even if AGENTS.md already exists
```
</invocation>

<workflow>
1. **Detect tech stack** - Check for config files (package.json, Cargo.toml, pyproject.toml, go.mod, etc.)
2. **Discover commands** - Parse justfile, package.json scripts, Makefile targets
3. **Validate commands** - Run each discovered command, capture exit code
4. **Analyze codebase** - Directory structure, file patterns, naming conventions
5. **Analyze git history** - Commit conventions, common fixes, frequently changed files
6. **Detect CI** - Read .github/workflows/ and other CI configs
7. **Generate AGENTS.md** - Assemble all 6 sections from collected data
8. **Present for approval** - Show complete AGENTS.md to user
9. **Write file** - Back up existing file, write new AGENTS.md
</workflow>
</quick_start>

<project_detection_phase>
Detect the project's tech stack by checking for config file markers.

<tech_stack_detection>
Check for these config files in the project root:

**Node/TypeScript/Bun:**
- `package.json` - Node.js project
- `bun.lockb` - Bun runtime
- `pnpm-lock.yaml` - pnpm package manager
- `yarn.lock` - Yarn package manager
- `tsconfig.json` - TypeScript configuration

**Rust:**
- `Cargo.toml` - Rust/Cargo project
- `rust-toolchain.toml` - Rust toolchain config

**Python:**
- `pyproject.toml` - Modern Python project
- `requirements.txt` - Python dependencies
- `setup.py` - Legacy Python packaging
- `Pipfile` - Pipenv project

**Go:**
- `go.mod` - Go module
- `go.sum` - Go dependency checksums

**Build tools (cross-language):**
- `justfile` - Just command runner
- `Makefile` - Make build system
- `Taskfile.yml` - Task runner

```bash
# Detection script
for f in package.json bun.lockb pnpm-lock.yaml yarn.lock tsconfig.json \
         Cargo.toml rust-toolchain.toml \
         pyproject.toml requirements.txt setup.py Pipfile \
         go.mod go.sum \
         justfile Makefile Taskfile.yml; do
  if [ -f "$f" ]; then
    echo "DETECTED: $f"
  fi
done
```

Record all detected config files. A project may have multiple stacks (monorepo).
</tech_stack_detection>

<build_tool_priority>
When multiple build tools are detected, use this priority for primary command source:

1. `justfile` - Just command runner (highest priority)
2. `Makefile` - Make
3. `Taskfile.yml` - Task
4. `package.json` scripts - npm/yarn/pnpm/bun
5. Language-specific tools (cargo, go, pytest, etc.)

All detected tools should be documented, but the highest-priority tool's commands are listed first.
</build_tool_priority>
</project_detection_phase>

<command_discovery_phase>
Discover available commands from detected build tools and validate them by running each one.

<parse_justfile>
If `justfile` is detected:

```bash
# List all recipes
just --list 2>/dev/null
```

Extract recipe names and map to command categories:
- Recipes containing `test` -> Test commands
- Recipes containing `check` or `typecheck` -> Typecheck commands
- Recipes containing `lint` or `clippy` -> Lint commands
- Recipes containing `build` -> Build commands
- Recipes containing `validate` -> Full validation commands
- Recipes containing `dev` -> Development commands
- All other recipes -> Utility commands
</parse_justfile>

<parse_package_json>
If `package.json` is detected:

```bash
# Extract script names
cat package.json | jq -r '.scripts // {} | keys[]' 2>/dev/null
```

Map script names to categories:
- `test`, `test:*` -> Test commands (run with `npm test` / `bun test` etc.)
- `typecheck`, `tsc`, `check-types` -> Typecheck commands
- `lint`, `lint:*`, `eslint` -> Lint commands
- `build`, `build:*` -> Build commands
- `dev`, `start`, `serve` -> Development commands

Use the detected package manager (bun/pnpm/yarn/npm) for the run command prefix.
</parse_package_json>

<parse_makefile>
If `Makefile` is detected:

```bash
# Extract target names (exclude internal targets starting with .)
make -qp 2>/dev/null | grep -E "^[a-zA-Z][a-zA-Z0-9_-]*:" | cut -d: -f1 | sort -u
```

Map target names to categories using the same keyword matching as justfile.
</parse_makefile>

<validate_commands>
**Run each discovered command** to verify it works. This is critical — failed commands must be noted in the generated AGENTS.md, not silently omitted.

```bash
# For each command, run with timeout and capture result
timeout 60 {command} 2>&1
echo "EXIT_CODE: $?"
```

Record for each command:
- **Command string**: The exact command to run
- **Exit code**: 0 = working, non-zero = failing
- **Brief output**: First/last few lines if relevant

**Timeout**: 60 seconds per command. If a command times out, mark it as `(timeout — may need manual configuration)`.

**Commands to validate** (in order of importance):
1. Test command (e.g., `just test`, `npm test`)
2. Typecheck command (e.g., `just typecheck`, `npm run typecheck`)
3. Lint command (e.g., `just lint`, `npm run lint`)
4. Build command (e.g., `just build`, `npm run build`)

**Do NOT validate**:
- Development servers (`dev`, `start`, `serve`) — they don't exit
- Clean/reset commands — they may delete needed files
- Deploy/publish commands — they affect production
</validate_commands>

<command_output_format>
Format validated commands for the AGENTS.md:

Working command:
```
- `just test` - Run all unit tests (validated ✓)
```

Failing command:
```
- `just test` - Run all unit tests (⚠ exits with code 1 — check test configuration)
```

Timed-out command:
```
- `just test` - Run all unit tests (⚠ timed out after 60s — may need manual configuration)
```
</command_output_format>
</command_discovery_phase>

<codebase_analysis_phase>
Analyze the project's directory structure, file patterns, and code conventions.

<directory_structure>
Generate a depth-limited directory tree excluding common noise directories:

```bash
# Generate tree excluding noise directories, depth limited to 3
find . -maxdepth 3 \
  -not -path './.git/*' \
  -not -path './.git' \
  -not -path './node_modules/*' \
  -not -path './node_modules' \
  -not -path './target/*' \
  -not -path './target' \
  -not -path './__pycache__/*' \
  -not -path './__pycache__' \
  -not -path './.venv/*' \
  -not -path './.venv' \
  -not -path './venv/*' \
  -not -path './venv' \
  -not -path './.next/*' \
  -not -path './.next' \
  -not -path './dist/*' \
  -not -path './dist' \
  -not -path './build/*' \
  -not -path './build' \
  -not -path './.cache/*' \
  -not -path './.cache' \
  -not -path './.mobius/*' \
  -not -path './.mobius' \
  -type d \
  | sort | head -60
```

Format as an indented tree with brief annotations for key directories.
</directory_structure>

<file_patterns>
Detect naming conventions and patterns:

```bash
# Count file extensions
find . -type f \
  -not -path './.git/*' \
  -not -path './node_modules/*' \
  -not -path './target/*' \
  -not -path './__pycache__/*' \
  -not -path './.venv/*' \
  | sed 's/.*\.//' | sort | uniq -c | sort -rn | head -15
```

From the extension counts and directory structure, identify:
- **Source code location**: Where main source files live
- **Test patterns**: How tests are organized (co-located, separate directory, naming convention)
- **Type definitions**: Where types/interfaces are defined
- **Component patterns**: UI component organization (if applicable)
- **Naming conventions**: camelCase, snake_case, PascalCase for files/directories
</file_patterns>

<key_files>
Identify important files that agents should know about:

- Entry points (main.rs, index.ts, app.py, main.go)
- Configuration files (tsconfig.json, Cargo.toml, pyproject.toml)
- CI configuration (.github/workflows/*.yml)
- Environment files (.env.example, .env.local)
- Lock files and their package manager

```bash
# Find likely entry points
for f in src/main.rs src/main.ts src/index.ts src/index.js \
         src/app.ts src/app.py main.go cmd/main.go \
         src/lib.rs src/mod.rs; do
  if [ -f "$f" ]; then
    echo "ENTRY: $f"
  fi
done
```
</key_files>
</codebase_analysis_phase>

<git_analysis_phase>
Analyze git history for commit conventions, common issues, and frequently changed files.

<commit_conventions>
Detect commit message patterns:

```bash
# Get recent commit messages
git log --oneline -20 2>/dev/null
```

Analyze the output to detect:
- **Conventional commits**: `type(scope): description` pattern
- **Issue references**: `MOB-123`, `JIRA-456`, `#123` patterns
- **Prefix patterns**: `feat:`, `fix:`, `chore:` etc.
- **Free-form**: No consistent pattern

Generate a summary of the convention with examples from actual commits.
</commit_conventions>

<common_issues>
Find common fix patterns from git history:

```bash
# Recent fix commits
git log --oneline --grep='fix' -20 2>/dev/null

# Recent revert commits
git log --oneline --grep='revert' -10 2>/dev/null
```

Analyze fix/revert commits to identify recurring issues:
- What areas of the codebase need frequent fixes?
- Are there common patterns (e.g., type errors, test failures, import issues)?
- Generate actionable guidance from these patterns.
</common_issues>

<hot_files>
Identify frequently changed files:

```bash
# Most frequently modified files in recent history
git log --name-only --pretty=format: -50 2>/dev/null | \
  grep -v '^$' | sort | uniq -c | sort -rn | head -10
```

These files are important context — they're where most development activity happens.
</hot_files>

<no_git_handling>
If git history is not available (new repo, no commits):

```bash
# Check if git is initialized and has commits
git rev-parse HEAD 2>/dev/null
```

If no git history:
- Skip commit conventions section (or note "No commit history yet")
- Skip common issues section
- Skip hot files analysis
- Include a note: "Git history analysis will be more useful after initial development"
</no_git_handling>
</git_analysis_phase>

<ci_detection_phase>
Detect CI/CD configuration.

<github_actions>
Check for GitHub Actions workflows:

```bash
# List workflow files
ls .github/workflows/*.yml .github/workflows/*.yaml 2>/dev/null
```

For each workflow file, extract:
- **Trigger events**: push, pull_request, schedule, workflow_dispatch
- **Key jobs**: build, test, lint, deploy
- **Required checks**: What must pass before merge

```bash
# For each workflow file
for f in .github/workflows/*.yml .github/workflows/*.yaml; do
  if [ -f "$f" ]; then
    echo "=== $f ==="
    head -20 "$f"
  fi
done
```
</github_actions>

<other_ci>
Check for other CI systems:

```bash
# Check for common CI configs
for f in .circleci/config.yml .travis.yml Jenkinsfile \
         .gitlab-ci.yml bitbucket-pipelines.yml \
         azure-pipelines.yml .buildkite/pipeline.yml; do
  if [ -f "$f" ]; then
    echo "CI_DETECTED: $f"
  fi
done
```

If detected, read the config file header to identify key jobs and triggers.
</other_ci>
</ci_detection_phase>

<generation_phase>
Assemble the complete AGENTS.md from all collected data. The generated file MUST follow the 6-section template structure.

<section_1_build_validation>
## Build & Validation

Generate from validated commands. Group by category:

```markdown
## Build & Validation

Run these commands after implementing changes to get immediate feedback:

**Build & Validation:**
- `{command}` - {description} ({validation status})
...

**Development:**
- `{command}` - {description}
...

**Utilities:**
- `{command}` - {description}
...
```

Rules:
- List validated (working) commands first
- Note failing commands with their error
- Include the exact command string to run
- Group logically (validation, development, utilities)
- If a command runner (just/make) is detected, show its commands prominently
</section_1_build_validation>

<section_2_operational_notes>
## Operational Notes

Generate from commit conventions and general guidelines:

```markdown
## Operational Notes

Guidelines for autonomous execution:

- **Commit convention**: {detected convention with examples}
- Always run validation commands after making changes
- Commit frequently with descriptive messages
- If tests fail, fix them before moving to the next sub-task
- When blocked, add a comment to the issue explaining the blocker
- Prefer small, focused changes over large refactors
```

Rules:
- Include detected commit convention with real examples from git log
- Include standard autonomous execution guidelines
- Add any project-specific notes detected from README or CONTRIBUTING files
</section_2_operational_notes>

<section_3_codebase_patterns>
## Codebase Patterns

Generate from file pattern analysis:

```markdown
## Codebase Patterns

- **{category}**: `{path}` - {description}, {naming convention}
...
```

Rules:
- Document actual detected patterns, not template placeholders
- Include naming conventions (camelCase, snake_case, PascalCase)
- Note test file patterns (co-located, separate dir, naming suffix)
- Include type/interface patterns
- Mention key architectural patterns (if detectable)
</section_3_codebase_patterns>

<section_4_common_issues>
## Common Issues

Generate from git history analysis:

```markdown
## Common Issues

Known gotchas and their solutions:

- **{issue}**: {description and solution}
...
```

Rules:
- Derive from actual fix/revert commits in git history
- Include actionable solutions, not just problem descriptions
- If no git history, include general best practices for the detected stack
- Note any workspace/path issues detected from project structure
</section_4_common_issues>

<section_5_project_structure>
## Project Structure

Generate from directory tree analysis:

```markdown
## Project Structure

```
{project-name}/
├── {dir}/               # {annotation}
│   ├── {subdir}/        # {annotation}
...
```
```

Rules:
- Use the depth-limited tree from codebase analysis
- Annotate key directories with their purpose
- Exclude noise directories (.git, node_modules, target, __pycache__, .venv)
- Limit depth to 3 levels to keep it concise
</section_5_project_structure>

<section_6_mobius_specific>
## Mobius-Specific Instructions

Generate based on `.mobius/` directory presence:

```markdown
## Mobius-Specific Instructions

{instructions for the autonomous Mobius loop}
```

If `.mobius/` directory exists:
- Note the issue tracking backend (from `mobius.config.yaml` if present)
- Reference any files that should not be modified
- Include branch naming conventions if detectable
- Note any special loop configuration

If `.mobius/` directory does NOT exist:
- Include generic Mobius instructions
- Note that the project can be configured with `mobius init`
</section_6_mobius_specific>

<assembly>
Assemble the final AGENTS.md with:

1. Title: `# AGENTS.md`
2. Description line: `Operational guide for autonomous {tool} execution.` (where {tool} is detected from .mobius/ presence or defaults to "Claude")
3. All 6 sections in order
4. No template placeholder content — every line must contain real detected data or be omitted entirely
</assembly>
</generation_phase>

<approval_phase>
Present the complete generated AGENTS.md for user review before writing.

**Use AskUserQuestion** to show the generated content and get approval:

```
Question: "Here is the generated AGENTS.md for your project. Should I write it?"
Options:
  - "Write it" (description: "Write the AGENTS.md file to the project root")
  - "Edit first" (description: "Let me make changes to the content before writing")
  - "Cancel" (description: "Don't write the file")
```

Before presenting, output the complete generated AGENTS.md content so the user can review it.

**If "Write it"**: Proceed to file write phase.
**If "Edit first"**: Ask what changes the user wants, apply them, then present again.
**If "Cancel"**: Stop execution without writing.
</approval_phase>

<file_write_phase>
Write the approved AGENTS.md to the project root.

<backup>
Before writing, check if AGENTS.md already exists:

```bash
if [ -f "AGENTS.md" ]; then
  cp AGENTS.md AGENTS.md.bak
  echo "Backed up existing AGENTS.md to AGENTS.md.bak"
fi
```

Always back up before overwriting.
</backup>

<write>
Write the approved content to `AGENTS.md` in the project root using the Write tool.

After writing, confirm:
```bash
test -f AGENTS.md && echo "AGENTS.md written successfully" || echo "AGENTS.md write failed"
```
</write>
</file_write_phase>

<edge_cases>
Handle these scenarios gracefully:

| Scenario | Handling |
|----------|----------|
| **Monorepo** | Detect multiple config files at root and in subdirectories. Document each stack separately in Build & Validation. Note workspace/package structure in Project Structure. |
| **No build tool** | Skip command validation. List detected source file types. Note "No build tool detected — consider adding a justfile or Makefile." |
| **Command failure** | Include failed commands in AGENTS.md with error note (e.g., `(⚠ exits with code 1)`). Do NOT silently omit them. |
| **Large repo** | Limit directory tree to depth 3 and 60 entries. Limit git log analysis to 50 recent commits. Skip file extension counting if >10,000 files. |
| **No git history** | Skip commit conventions, common issues, and hot files sections. Note "No git history available" in Operational Notes. |
</edge_cases>

<anti_patterns>
**Don't skip command validation**: Every discovered command must be run and its result recorded. Failed commands are valuable information.

**Don't generate template placeholders**: Every section must contain real detected data. If a section would only have placeholder content, omit it entirely.

**Don't hardcode repo-specific content**: The skill must work on any supported project. All content comes from detection, not assumptions.

**Don't modify any project files** (except AGENTS.md): This skill only reads the codebase and writes AGENTS.md. It should never modify source code, configs, or other files.

**Don't run destructive commands**: Never run clean, reset, deploy, or publish commands during validation.

**Don't skip the approval gate**: Always present the generated AGENTS.md for user approval before writing. Never write without asking.

**Don't include development server commands in validation**: Commands like `dev`, `start`, `serve` don't exit and will timeout. Document them but don't run them.
</anti_patterns>

<success_criteria>
A successful execution achieves:

- [ ] Tech stack detected from config file markers
- [ ] Build/test/lint/typecheck commands discovered from build tool
- [ ] Discovered commands validated by running them (with exit code captured)
- [ ] Directory structure generated excluding noise directories (.git, node_modules, target, __pycache__, .venv)
- [ ] Commit conventions detected from git log analysis
- [ ] Common issues identified from fix/revert commit patterns
- [ ] CI configuration detected from .github/workflows/
- [ ] All 6 AGENTS.md sections generated with real detected data
- [ ] Existing AGENTS.md backed up to AGENTS.md.bak before overwriting
- [ ] Complete AGENTS.md presented for user approval via AskUserQuestion
- [ ] File written only after user approval
- [ ] No template placeholder content in final output — every section has real data or is omitted
</success_criteria>
