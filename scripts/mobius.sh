#!/bin/bash
# Mobius - AI-Powered Development Workflow Tool
#
# Executes sub-tasks of an issue in a loop using Claude skills.
# Supports multiple planning backends (Linear, Jira, etc.)
#
# Usage:
#   mobius VER-159                 # Execute sub-tasks (uses default backend)
#   mobius VER-159 10              # Max 10 iterations
#   mobius VER-159 --local         # Run locally (bypass sandbox)
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

# State file for TUI dashboard
STATE_DIR="${MOBIUS_STATE_DIR:-$HOME/.mobius/state}"

# Backend skill mappings
declare -A BACKEND_SKILLS=(
    [linear]="/execute-linear-issue"
    [jira]="/execute-jira-issue"  # Future: implement Jira skill
)

declare -A BACKEND_ID_PATTERNS=(
    [linear]='^[A-Z]+-[0-9]+$'
    [jira]='^[A-Z]+-[0-9]+$'
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
            --local|-l)
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
    --local, -l          Run locally (bypass container sandbox)
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
    mobius VER-159 --local            Run locally with browser access
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
# State file management for TUI dashboard
# ============================================================================

# Global state variables
STATE_FILE=""
LOOP_START_TIME=""
PARENT_TITLE=""
ACTIVE_TASKS_JSON="[]"
COMPLETED_TASKS_JSON="[]"
FAILED_TASKS_JSON="[]"

# Ensure state directory exists
ensure_state_dir() {
    mkdir -p "$STATE_DIR"
}

# Get state file path for a task
get_state_file() {
    echo "$STATE_DIR/${TASK_ID}.json"
}

# Write state file atomically (temp file + rename)
write_state_file() {
    local state_json="$1"
    local temp_file="${STATE_FILE}.tmp.$$"

    echo "$state_json" > "$temp_file"
    mv "$temp_file" "$STATE_FILE"
}

# Initialize state file at loop start
init_state_file() {
    ensure_state_dir
    STATE_FILE="$(get_state_file)"
    LOOP_START_TIME="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

    # Fetch parent title from Linear if possible (fallback to task ID)
    PARENT_TITLE="$TASK_ID"

    local state_json
    state_json=$(cat << EOF
{
  "parentId": "$TASK_ID",
  "parentTitle": "$PARENT_TITLE",
  "activeTasks": [],
  "completedTasks": [],
  "failedTasks": [],
  "startedAt": "$LOOP_START_TIME",
  "updatedAt": "$LOOP_START_TIME"
}
EOF
)

    write_state_file "$state_json"
    log "State file initialized: $STATE_FILE"
}

# Update state file with current task status
update_state_file() {
    local now
    now="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

    local state_json
    state_json=$(cat << EOF
{
  "parentId": "$TASK_ID",
  "parentTitle": "$PARENT_TITLE",
  "activeTasks": $ACTIVE_TASKS_JSON,
  "completedTasks": $COMPLETED_TASKS_JSON,
  "failedTasks": $FAILED_TASKS_JSON,
  "startedAt": "$LOOP_START_TIME",
  "updatedAt": "$now"
}
EOF
)

    write_state_file "$state_json"
}

# Add task to active tasks (called when agent starts)
# Usage: add_active_task "MOB-126" "12345" "%0"
add_active_task() {
    local task_id="$1"
    local pid="$2"
    local pane="${3:-}"
    local now
    now="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"

    # Build the active task JSON object
    local task_json
    if [ -n "$pane" ]; then
        task_json="{\"id\": \"$task_id\", \"pid\": $pid, \"pane\": \"$pane\", \"startedAt\": \"$now\"}"
    else
        task_json="{\"id\": \"$task_id\", \"pid\": $pid, \"startedAt\": \"$now\"}"
    fi

    # For single-agent mode, we just replace with a single-item array
    ACTIVE_TASKS_JSON="[$task_json]"

    update_state_file
}

# Remove task from active tasks and add to completed
# Usage: complete_active_task "MOB-126"
complete_active_task() {
    local task_id="$1"

    # Clear active tasks (single-agent mode)
    ACTIVE_TASKS_JSON="[]"

    # Add to completed tasks array
    if [ "$COMPLETED_TASKS_JSON" = "[]" ]; then
        COMPLETED_TASKS_JSON="[\"$task_id\"]"
    else
        # Remove trailing ] and append
        COMPLETED_TASKS_JSON="${COMPLETED_TASKS_JSON%]}, \"$task_id\"]"
    fi

    update_state_file
}

# Remove task from active tasks and add to failed
# Usage: fail_active_task "MOB-126"
fail_active_task() {
    local task_id="$1"

    # Clear active tasks (single-agent mode)
    ACTIVE_TASKS_JSON="[]"

    # Add to failed tasks array
    if [ "$FAILED_TASKS_JSON" = "[]" ]; then
        FAILED_TASKS_JSON="[\"$task_id\"]"
    else
        # Remove trailing ] and append
        FAILED_TASKS_JSON="${FAILED_TASKS_JSON%]}, \"$task_id\"]"
    fi

    update_state_file
}

# Clear all active tasks (called on clean exit)
clear_active_tasks() {
    ACTIVE_TASKS_JSON="[]"
    update_state_file
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
    if echo "$output" | grep -qE 'EXECUTION_COMPLETE:[[:space:]]*[A-Z]+-[0-9]+'; then
        echo "$output" | grep -oE 'EXECUTION_COMPLETE:[[:space:]]*[A-Z]+-[0-9]+' | head -1 | sed 's/EXECUTION_COMPLETE:[[:space:]]*//'
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

# The main loop
run_loop() {
    # Initialize state file before starting
    init_state_file

    # Clean up state on exit
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
    log "State file: $STATE_FILE"
    log "Press Ctrl+C to stop"
    echo ""

    local iteration=0

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

        # Mark task as active (using iteration as pseudo-subtask ID until we parse output)
        # In single-agent mode, we use the iteration number as a placeholder
        # The actual sub-task ID will be extracted from Claude's output
        add_active_task "iteration-$iteration" "$$" ""

        # Capture Claude output for status parsing
        local output_file
        output_file=$(mktemp)

        # The skill will find the next ready sub-task and execute it
        # If no sub-tasks remain, Claude will indicate completion
        echo "$skill $TASK_ID" | claude -p \
            --dangerously-skip-permissions \
            --verbose \
            --output-format=stream-json \
            --model "$MODEL" \
            $chrome_flag | tee "$output_file" | cclean

        local claude_exit_code=${PIPESTATUS[0]}
        local output
        output=$(cat "$output_file")
        rm -f "$output_file"

        # Parse output to determine what happened
        local completed_task
        if completed_task=$(extract_completed_subtask "$output"); then
            log "Sub-task completed: $completed_task"
            complete_active_task "$completed_task"
        elif should_stop_execution "$output"; then
            log "Execution complete - stopping loop"
            clear_active_tasks
            break
        elif [ "$claude_exit_code" -ne 0 ]; then
            log "Claude exited with error code: $claude_exit_code"
            fail_active_task "iteration-$iteration"
        else
            # No clear status - clear active task and continue
            ACTIVE_TASKS_JSON="[]"
            update_state_file
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
