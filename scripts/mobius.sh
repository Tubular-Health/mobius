#!/bin/bash
# Mobius - AI-Powered Development Workflow Tool
#
# Executes sub-tasks of an issue in a loop using Claude skills.
# Supports multiple planning backends (Linear, Jira, etc.)
#
# Usage:
#   mobius VER-159                 # Execute sub-tasks (uses default backend)
#   mobius VER-159 10              # Max 10 iterations
#   mobius VER-159 --no-sandbox    # Run locally (bypass sandbox)
#   mobius VER-159 --backend=jira  # Use Jira backend
#
# Configuration:
#   ~/.config/mobius/config.yaml   # User config (takes precedence)
#   Environment variables          # Override config file settings

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/mobius"
# Support config path from npm wrapper (MOBIUS_CONFIG_FILE env var)
CONFIG_FILE="${MOBIUS_CONFIG_FILE:-$CONFIG_DIR/config.yaml}"
DEFAULT_CONFIG="$PROJECT_ROOT/mobius.config.yaml"

# Default configuration (can be overridden by config file or environment)
DELAY_SECONDS="${MOBIUS_DELAY_SECONDS:-3}"
DEFAULT_BACKEND="${MOBIUS_BACKEND:-linear}"
MAX_ITERATIONS_DEFAULT="${MOBIUS_MAX_ITERATIONS:-50}"
CONTAINER_NAME="${MOBIUS_CONTAINER:-mobius-sandbox}"
MODEL="${MOBIUS_MODEL:-opus}"
USE_SANDBOX="${MOBIUS_SANDBOX_ENABLED:-true}"

# Parallel execution and worktree isolation defaults
MAX_PARALLEL_AGENTS="${MOBIUS_MAX_PARALLEL_AGENTS:-3}"
WORKTREE_PATH="${MOBIUS_WORKTREE_PATH:-../<repo>-worktrees/}"
CLEANUP_ON_SUCCESS="${MOBIUS_CLEANUP_ON_SUCCESS:-true}"
BASE_BRANCH="${MOBIUS_BASE_BRANCH:-main}"

# State file for TUI monitoring
STATE_DIR="${MOBIUS_STATE_DIR:-$HOME/.mobius/state}"

# Backend skill mappings
declare -A BACKEND_SKILLS=(
    [linear]="/execute-issue"
    [jira]="/execute-issue"
)

declare -A BACKEND_ID_PATTERNS=(
    [linear]='^[A-Z][A-Z0-9]*-[0-9]+$'
    [jira]='^[A-Z][A-Z0-9]*-[0-9]+$'
)

# Parse YAML config file (basic parser for simple key: value pairs)
# Supports nested keys like "execution.delay_seconds"
parse_yaml_config() {
    local config_file="$1"

    if [ ! -f "$config_file" ]; then
        return 0
    fi

    local current_section=""

    while IFS= read -r line || [ -n "$line" ]; do
        # Skip comments and empty lines
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "${line// }" ]] && continue

        # Detect section headers (no leading whitespace, ends with colon, no value)
        if [[ "$line" =~ ^([a-zA-Z_][a-zA-Z0-9_]*):$ ]] || [[ "$line" =~ ^([a-zA-Z_][a-zA-Z0-9_]*):[[:space:]]*$ ]]; then
            current_section="${BASH_REMATCH[1]}"
            continue
        fi

        # Parse key: value pairs
        if [[ "$line" =~ ^[[:space:]]*([a-zA-Z_][a-zA-Z0-9_]*):[[:space:]]*(.+)$ ]]; then
            local key="${BASH_REMATCH[1]}"
            local value="${BASH_REMATCH[2]}"

            # Remove comments from value
            value="${value%%#*}"
            # Trim whitespace
            value="${value%"${value##*[![:space:]]}"}"

            # Skip empty values
            [ -z "$value" ] && continue

            # Build full key name
            local full_key="$key"
            if [ -n "$current_section" ]; then
                full_key="${current_section}.${key}"
            fi

            # Map config keys to variables (only if not already set by env)
            case "$full_key" in
                backend)
                    [ -z "${MOBIUS_BACKEND:-}" ] && DEFAULT_BACKEND="$value"
                    ;;
                execution.delay_seconds)
                    [ -z "${MOBIUS_DELAY_SECONDS:-}" ] && DELAY_SECONDS="$value"
                    ;;
                execution.max_iterations)
                    [ -z "${MOBIUS_MAX_ITERATIONS:-}" ] && MAX_ITERATIONS_DEFAULT="$value"
                    ;;
                execution.model)
                    [ -z "${MOBIUS_MODEL:-}" ] && MODEL="$value"
                    ;;
                execution.sandbox)
                    [ -z "${MOBIUS_SANDBOX_ENABLED:-}" ] && USE_SANDBOX="$value"
                    ;;
                execution.container_name)
                    [ -z "${MOBIUS_CONTAINER:-}" ] && CONTAINER_NAME="$value"
                    ;;
                execution.max_parallel_agents)
                    [ -z "${MOBIUS_MAX_PARALLEL_AGENTS:-}" ] && MAX_PARALLEL_AGENTS="$value"
                    ;;
                execution.worktree_path)
                    [ -z "${MOBIUS_WORKTREE_PATH:-}" ] && WORKTREE_PATH="$value"
                    ;;
                execution.cleanup_on_success)
                    [ -z "${MOBIUS_CLEANUP_ON_SUCCESS:-}" ] && CLEANUP_ON_SUCCESS="$value"
                    ;;
                execution.base_branch)
                    [ -z "${MOBIUS_BASE_BRANCH:-}" ] && BASE_BRANCH="$value"
                    ;;
            esac
        fi
    done < "$config_file"
}

# Load configuration (user config takes precedence over defaults)
load_config() {
    # Load default config if it exists
    if [ -f "$DEFAULT_CONFIG" ]; then
        parse_yaml_config "$DEFAULT_CONFIG"
    fi

    # Load user config (overrides defaults)
    if [ -f "$CONFIG_FILE" ]; then
        parse_yaml_config "$CONFIG_FILE"
    fi
}

# Parse arguments
TASK_ID=""
MAX_ITERATIONS=0
RUN_LOCAL=false
BACKEND=""
SHOW_CONFIG=false

parse_args() {
    local args=()
    for arg in "$@"; do
        case "$arg" in
            --no-sandbox)
                RUN_LOCAL=true
                ;;
            --local|-l)
                echo "Warning: --local is deprecated, use --no-sandbox instead" >&2
                RUN_LOCAL=true
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            --version|-v)
                echo "mobius v1.0.0"
                exit 0
                ;;
            --config)
                SHOW_CONFIG=true
                ;;
            --backend=*)
                BACKEND="${arg#*=}"
                ;;
            --model=*)
                MODEL="${arg#*=}"
                ;;
            --delay=*)
                DELAY_SECONDS="${arg#*=}"
                ;;
            --parallel=*)
                MAX_PARALLEL_AGENTS="${arg#*=}"
                ;;
            *)
                args+=("$arg")
                ;;
        esac
    done

    # Show config and exit if requested
    if [ "$SHOW_CONFIG" = "true" ]; then
        show_config
        exit 0
    fi

    if [ ${#args[@]} -eq 0 ]; then
        echo "Error: Task ID required"
        echo "Usage: mobius <TASK-ID> [max-iterations] [options]"
        echo "Run 'mobius --help' for more information."
        exit 1
    fi

    TASK_ID="${args[0]}"

    # Use default backend if not specified via flag
    [ -z "$BACKEND" ] && BACKEND="$DEFAULT_BACKEND"

    # Validate backend
    if [ -z "${BACKEND_SKILLS[$BACKEND]:-}" ]; then
        echo "Error: Unknown backend: $BACKEND"
        echo "Available backends: ${!BACKEND_SKILLS[*]}"
        exit 1
    fi

    # Validate task ID format
    local pattern="${BACKEND_ID_PATTERNS[$BACKEND]}"
    if ! [[ "$TASK_ID" =~ $pattern ]]; then
        echo "Error: Invalid task ID format for $BACKEND: $TASK_ID"
        echo "Expected format: PREFIX-NUMBER (e.g., VER-159)"
        exit 1
    fi

    # Optional max iterations from args (overrides config)
    if [ ${#args[@]} -ge 2 ] && [[ "${args[1]}" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="${args[1]}"
    else
        MAX_ITERATIONS="$MAX_ITERATIONS_DEFAULT"
    fi
}

show_help() {
    cat << EOF
mobius - AI-Powered Development Workflow Tool

Execute sub-tasks of an issue using Claude skills in an autonomous loop.

USAGE:
    mobius <TASK-ID> [max-iterations] [options]

ARGUMENTS:
    TASK-ID              Issue ID (e.g., VER-159 for Linear, PROJ-123 for Jira)
    max-iterations       Maximum iterations (default: from config or 50)

OPTIONS:
    --backend=NAME       Planning backend to use (default: $DEFAULT_BACKEND)
    --model=MODEL        Claude model: opus, sonnet, haiku (default: $MODEL)
    --delay=SECONDS      Delay between iterations (default: $DELAY_SECONDS)
    --parallel=N         Max parallel agents for parallel mode (default: $MAX_PARALLEL_AGENTS)
    --no-sandbox         Bypass container sandbox, run directly on host
    --local, -l          (deprecated) Alias for --no-sandbox
    --config             Show current configuration and exit
    --version, -v        Show version
    --help, -h           Show this help message

AVAILABLE BACKENDS:
    ${!BACKEND_SKILLS[*]}

CONFIGURATION:
    User config:     $CONFIG_FILE
    Default config:  $DEFAULT_CONFIG

    Environment variables override config file settings:
      MOBIUS_BACKEND              Default backend
      MOBIUS_DELAY_SECONDS        Delay between iterations
      MOBIUS_MAX_ITERATIONS       Maximum iterations
      MOBIUS_MODEL                Claude model
      MOBIUS_CONTAINER            Docker container name
      MOBIUS_SANDBOX_ENABLED      Enable sandbox mode (true/false)
      MOBIUS_MAX_PARALLEL_AGENTS  Max concurrent agents (default: 3)
      MOBIUS_WORKTREE_PATH        Worktree base path (default: ../<repo>-worktrees/)
      MOBIUS_CLEANUP_ON_SUCCESS   Remove worktree on success (true/false)
      MOBIUS_BASE_BRANCH          Branch for feature branches (default: main)

EXAMPLES:
    mobius VER-159                    Execute sub-tasks of VER-159 (Linear)
    mobius VER-159 10                 Max 10 iterations
    mobius VER-159 --no-sandbox       Run locally with browser access
    mobius VER-159 --model=sonnet     Use Sonnet model
    mobius PROJ-123 --backend=jira    Use Jira backend

WORKFLOW:
    Each iteration:
      1. Claude runs the backend's execute skill
      2. The skill finds the next ready sub-task and executes it
      3. Sub-task is marked complete in the planning tool
      4. Loop continues until all sub-tasks are done

    The loop reads AGENTS.md from your project root for context.
EOF
}

show_config() {
    echo "Mobius Configuration"
    echo "===================="
    echo ""
    echo "Config files:"
    if [ -f "$CONFIG_FILE" ]; then
        echo "  User:    $CONFIG_FILE (active)"
    else
        echo "  User:    $CONFIG_FILE (not found)"
    fi
    if [ -f "$DEFAULT_CONFIG" ]; then
        echo "  Default: $DEFAULT_CONFIG (active)"
    else
        echo "  Default: $DEFAULT_CONFIG (not found)"
    fi
    echo ""
    echo "Current settings:"
    echo "  backend:              $DEFAULT_BACKEND"
    echo "  model:                $MODEL"
    echo "  delay_seconds:        $DELAY_SECONDS"
    echo "  max_iterations:       $MAX_ITERATIONS_DEFAULT"
    echo "  sandbox:              $USE_SANDBOX"
    echo "  container:            $CONTAINER_NAME"
    echo ""
    echo "Parallel execution:"
    echo "  max_parallel_agents:  $MAX_PARALLEL_AGENTS"
    echo "  worktree_path:        $WORKTREE_PATH"
    echo "  cleanup_on_success:   $CLEANUP_ON_SUCCESS"
    echo "  base_branch:          $BASE_BRANCH"
    echo ""
    echo "Available backends: ${!BACKEND_SKILLS[*]}"
}

log() { echo "[mobius] $1"; }

# ============================================================================
# State File Management for TUI Monitoring
# ============================================================================
# The state file allows a separate TUI process to monitor execution progress.
# Location: ~/.mobius/state/<parent-id>.json
#
# Schema:
# {
#   "parentId": "MOB-11",
#   "parentTitle": "Parent issue title",
#   "activeTasks": [{ "id": "MOB-126", "pid": 12345, "pane": "%0", "startedAt": "ISO-8601" }],
#   "completedTasks": ["MOB-124", "MOB-125"],
#   "failedTasks": [],
#   "startedAt": "ISO-8601",
#   "updatedAt": "ISO-8601"
# }

STATE_FILE=""
STATE_STARTED_AT=""
COMPLETED_TASKS_JSON="[]"
FAILED_TASKS_JSON="[]"
ACTIVE_TASKS_JSON="[]"

# Initialize state directory and file
init_state_file() {
    local parent_id="$1"
    local parent_title="${2:-}"

    # Create state directory if it doesn't exist
    mkdir -p "$STATE_DIR"

    STATE_FILE="$STATE_DIR/${parent_id}.json"
    STATE_STARTED_AT=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
    COMPLETED_TASKS_JSON="[]"
    FAILED_TASKS_JSON="[]"
    ACTIVE_TASKS_JSON="[]"

    write_state_file "$parent_id" "$parent_title"
    log "State file: $STATE_FILE"
}

# Write state file atomically (temp file + rename)
write_state_file() {
    local parent_id="$1"
    local parent_title="${2:-}"
    local updated_at
    updated_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

    # Escape the title for JSON (handle quotes and backslashes)
    local escaped_title
    escaped_title=$(echo "$parent_title" | sed 's/\\/\\\\/g; s/"/\\"/g')

    local json
    json=$(cat <<EOF
{
  "parentId": "${parent_id}",
  "parentTitle": "${escaped_title}",
  "activeTasks": ${ACTIVE_TASKS_JSON},
  "completedTasks": ${COMPLETED_TASKS_JSON},
  "failedTasks": ${FAILED_TASKS_JSON},
  "startedAt": "${STATE_STARTED_AT}",
  "updatedAt": "${updated_at}"
}
EOF
)

    # Atomic write: write to temp file, then rename
    local temp_file="${STATE_FILE}.tmp"
    echo "$json" > "$temp_file"
    mv "$temp_file" "$STATE_FILE"
}

# Add a task to activeTasks when agent spawns
add_active_task() {
    local task_id="$1"
    local pid="$2"
    local pane="${3:-}"
    local worktree="${4:-}"
    local started_at
    started_at=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

    # Build new task JSON
    local task_json="{\"id\":\"${task_id}\",\"pid\":${pid},\"pane\":\"${pane}\",\"startedAt\":\"${started_at}\""
    if [ -n "$worktree" ]; then
        task_json="${task_json},\"worktree\":\"${worktree}\""
    fi
    task_json="${task_json}}"

    # Append to activeTasks array
    if [ "$ACTIVE_TASKS_JSON" = "[]" ]; then
        ACTIVE_TASKS_JSON="[${task_json}]"
    else
        # Remove trailing ] and append new task
        ACTIVE_TASKS_JSON="${ACTIVE_TASKS_JSON%]},${task_json}]"
    fi

    write_state_file "$TASK_ID" ""
}

# Remove a task from activeTasks and add to completedTasks
complete_task() {
    local task_id="$1"

    # Remove from activeTasks using a simple approach
    # This works for arrays with single or multiple entries
    if command -v jq &> /dev/null; then
        ACTIVE_TASKS_JSON=$(echo "$ACTIVE_TASKS_JSON" | jq -c "[.[] | select(.id != \"$task_id\")]")
    else
        # Fallback: if jq not available, reset to empty (less accurate but functional)
        ACTIVE_TASKS_JSON="[]"
    fi

    # Add to completedTasks
    if [ "$COMPLETED_TASKS_JSON" = "[]" ]; then
        COMPLETED_TASKS_JSON="[\"${task_id}\"]"
    else
        COMPLETED_TASKS_JSON="${COMPLETED_TASKS_JSON%]},\"${task_id}\"]"
    fi

    write_state_file "$TASK_ID" ""
}

# Remove a task from activeTasks and add to failedTasks
fail_task() {
    local task_id="$1"

    # Remove from activeTasks
    if command -v jq &> /dev/null; then
        ACTIVE_TASKS_JSON=$(echo "$ACTIVE_TASKS_JSON" | jq -c "[.[] | select(.id != \"$task_id\")]")
    else
        ACTIVE_TASKS_JSON="[]"
    fi

    # Add to failedTasks
    if [ "$FAILED_TASKS_JSON" = "[]" ]; then
        FAILED_TASKS_JSON="[\"${task_id}\"]"
    else
        FAILED_TASKS_JSON="${FAILED_TASKS_JSON%]},\"${task_id}\"]"
    fi

    write_state_file "$TASK_ID" ""
}

# Clear all active tasks (used on clean shutdown)
clear_active_tasks() {
    ACTIVE_TASKS_JSON="[]"
    write_state_file "$TASK_ID" ""
}

# ============================================================================

# Sandbox delegation (optional - requires container setup)
delegate_to_sandbox() {
    local args="$TASK_ID"
    if [ "$MAX_ITERATIONS" -gt 0 ]; then
        args="$TASK_ID $MAX_ITERATIONS"
    fi
    args="$args --backend=$BACKEND"

    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^${CONTAINER_NAME}$"; then
        log "Delegating to sandbox..."
        exec docker exec -it "$CONTAINER_NAME" bash -c "cd /workspace && MOBIUS_SANDBOX=1 ./scripts/mobius.sh $args"
    else
        # Check if sandbox script exists
        if [ -f "$PROJECT_ROOT/scripts/sandbox.sh" ]; then
            log "Starting sandbox..."
            "$PROJECT_ROOT/scripts/sandbox.sh"
            exec docker exec -it "$CONTAINER_NAME" bash -c "cd /workspace && MOBIUS_SANDBOX=1 ./scripts/mobius.sh $args"
        else
            log "No sandbox configured, running locally"
            RUN_LOCAL=true
        fi
    fi
}

# Extract sub-task ID from Claude output
# Looks for "EXECUTION_COMPLETE: MOB-XXX" marker
extract_completed_subtask() {
    local output="$1"
    # Look for EXECUTION_COMPLETE: followed by task ID
    if echo "$output" | grep -qE 'EXECUTION_COMPLETE:[[:space:]]*[A-Z][A-Z0-9]*-[0-9]+'; then
        echo "$output" | grep -oE 'EXECUTION_COMPLETE:[[:space:]]*[A-Z][A-Z0-9]*-[0-9]+' | head -1 | sed 's/EXECUTION_COMPLETE:[[:space:]]*//'
        return 0
    fi
    return 1
}

# Check if execution should stop (all complete, all blocked, verification failed)
should_stop_execution() {
    local output="$1"
    if echo "$output" | grep -qE 'STATUS:[[:space:]]*(ALL_COMPLETE|ALL_BLOCKED|NO_SUBTASKS|VERIFICATION_FAILED)'; then
        return 0
    fi
    return 1
}

# Check if tmux is available and running
check_tmux() {
    if ! command -v tmux &> /dev/null; then
        return 1
    fi
    # Check if tmux server is running (we can create windows even if not attached)
    tmux list-sessions &> /dev/null || tmux new-session -d -s mobius-bg &> /dev/null
    return 0
}

# The main loop
run_loop() {
    # Check tmux availability for TUI pane capture
    local use_tmux=false
    if check_tmux; then
        use_tmux=true
        log "tmux available - TUI will show live agent output"
    else
        log "tmux not available - TUI will not show live output"
    fi

    # Clean up state file and tmux panes on exit
    trap 'echo ""; clear_active_tasks; log "Stopped"; exit 0' INT TERM

    local skill="${BACKEND_SKILLS[$BACKEND]}"

    echo ""
    echo "================================"
    echo "  Mobius - AI Development Workflow"
    echo "================================"
    echo ""
    log "Task: $TASK_ID"
    log "Backend: $BACKEND"
    log "Skill: $skill"
    log "Model: $MODEL"
    if [ "$MAX_ITERATIONS" -gt 0 ]; then
        log "Max iterations: $MAX_ITERATIONS"
    else
        log "Max iterations: unlimited"
    fi
    log "Delay: ${DELAY_SECONDS}s between iterations"
    log "Press Ctrl+C to stop"
    echo ""

    # Initialize state file for TUI monitoring
    init_state_file "$TASK_ID" ""

    local iteration=0
    local current_subtask_id=""
    local claude_pid=""

    while true; do
        # Check max iterations
        if [ "$MAX_ITERATIONS" -gt 0 ] && [ "$iteration" -ge "$MAX_ITERATIONS" ]; then
            echo ""
            log "Reached max iterations: $MAX_ITERATIONS"
            clear_active_tasks
            break
        fi

        iteration=$((iteration + 1))
        echo ""
        echo "--- Iteration $iteration$([ "$MAX_ITERATIONS" -gt 0 ] && echo "/$MAX_ITERATIONS") ($(date +%H:%M:%S)) ---"
        echo ""

        # Run Claude with the backend-specific skill
        local chrome_flag=""
        if [ "$RUN_LOCAL" = "true" ]; then
            chrome_flag="--chrome"
        fi

        # Create a temp file to capture the output for parsing
        local output_file
        output_file=$(mktemp)

        local pane_id=""
        local pane_pid=""

        if [ "$use_tmux" = "true" ]; then
            # Unique signal name for tmux wait-for
            local wait_signal="mobius-$$-$iteration"

            # Run Claude inside a tmux pane so TUI can capture live output
            pane_id=$(tmux new-window -d -P -F '#{pane_id}' \
                "echo '$skill $TASK_ID' | claude -p \
                    --dangerously-skip-permissions \
                    --verbose \
                    --output-format=stream-json \
                    --model $MODEL \
                    $chrome_flag 2>&1 | tee '$output_file' | cclean; \
                tmux wait-for -S '$wait_signal'")

            # Get the PID of the shell running in the tmux pane
            pane_pid=$(tmux display-message -t "$pane_id" -p '#{pane_pid}')

            # Track this task with its tmux pane ID for TUI live output capture
            add_active_task "$TASK_ID" "$pane_pid" "$pane_id" ""

            # Wait for Claude to finish (tmux wait-for blocks until signaled)
            tmux wait-for "$wait_signal" 2>/dev/null || true
        else
            # Fallback: run Claude directly without tmux (no live TUI output)
            echo "$skill $TASK_ID" | claude -p \
                --dangerously-skip-permissions \
                --verbose \
                --output-format=stream-json \
                --model "$MODEL" \
                $chrome_flag 2>&1 | tee "$output_file" | cclean &
            pane_pid=$!

            # Track without pane ID (TUI will show "(available)" placeholder)
            add_active_task "$TASK_ID" "$pane_pid" "" ""

            # Wait for Claude to finish
            wait $pane_pid || true
        fi

        local exit_code=$?

        # Parse output for completion status
        # Look for STATUS markers in the output
        local status_line
        status_line=$(grep -E "^STATUS:|STATUS:" "$output_file" 2>/dev/null | tail -1 || true)

        # Extract completed sub-task ID if present (from "EXECUTION_COMPLETE: MOB-XX")
        local completed_id
        completed_id=$(grep -oE "EXECUTION_COMPLETE: [A-Z][A-Z0-9]*-[0-9]+" "$output_file" 2>/dev/null | tail -1 | cut -d' ' -f2 || true)

        # Extract failed sub-task ID if present (from "Sub-task Failed: MOB-XX")
        local failed_id
        failed_id=$(grep -oE "Sub-task Failed: [A-Z][A-Z0-9]*-[0-9]+" "$output_file" 2>/dev/null | head -1 | sed 's/Sub-task Failed: //' || true)

        # Clean up temp file
        rm -f "$output_file"

        # Update state based on status
        if [[ "$status_line" == *"SUBTASK_COMPLETE"* ]] && [ -n "$completed_id" ]; then
            complete_task "$completed_id"
            log "Sub-task completed: $completed_id"
        elif [[ "$status_line" == *"VERIFICATION_FAILED"* ]]; then
            if [ -n "$failed_id" ]; then
                fail_task "$failed_id"
                log "Sub-task failed: $failed_id"
            else
                clear_active_tasks
            fi
        elif [[ "$status_line" == *"ALL_COMPLETE"* ]]; then
            clear_active_tasks
            log "All sub-tasks completed!"
            break
        elif [[ "$status_line" == *"ALL_BLOCKED"* ]] || [[ "$status_line" == *"NO_SUBTASKS"* ]]; then
            clear_active_tasks
            log "No more sub-tasks to execute"
            break
        else
            # Unknown status or no status marker - just clear active tasks
            clear_active_tasks
        fi

        echo ""
        log "Waiting ${DELAY_SECONDS}s..."
        sleep "$DELAY_SECONDS"
    done
}

# Main
main() {
    cd "$PROJECT_ROOT"

    # Load configuration before parsing args
    load_config

    parse_args "$@"

    # Delegate to sandbox unless already inside, --local flag, or sandbox disabled
    if [ -z "${MOBIUS_SANDBOX:-}" ] && [ "$RUN_LOCAL" = "false" ] && [ "$USE_SANDBOX" = "true" ]; then
        delegate_to_sandbox
    fi

    if [ "$RUN_LOCAL" = "true" ]; then
        log "Running locally (sandbox bypassed)"
    fi

    run_loop
}

main "$@"
