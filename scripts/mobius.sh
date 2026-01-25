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
      MOBIUS_BACKEND          Default backend
      MOBIUS_DELAY_SECONDS    Delay between iterations
      MOBIUS_MAX_ITERATIONS   Maximum iterations
      MOBIUS_MODEL            Claude model
      MOBIUS_CONTAINER        Docker container name
      MOBIUS_SANDBOX_ENABLED  Enable sandbox mode (true/false)

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
    echo "  backend:         $DEFAULT_BACKEND"
    echo "  model:           $MODEL"
    echo "  delay_seconds:   $DELAY_SECONDS"
    echo "  max_iterations:  $MAX_ITERATIONS_DEFAULT"
    echo "  sandbox:         $USE_SANDBOX"
    echo "  container:       $CONTAINER_NAME"
    echo ""
    echo "Available backends: ${!BACKEND_SKILLS[*]}"
}

log() { echo "[mobius] $1"; }

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

# The main loop
run_loop() {
    trap 'echo ""; log "Stopped"; exit 0' INT TERM

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

    local iteration=0

    while true; do
        # Check max iterations
        if [ "$MAX_ITERATIONS" -gt 0 ] && [ "$iteration" -ge "$MAX_ITERATIONS" ]; then
            echo ""
            log "Reached max iterations: $MAX_ITERATIONS"
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

        # The skill will find the next ready sub-task and execute it
        # If no sub-tasks remain, Claude will indicate completion
        echo "$skill $TASK_ID" | claude -p \
            --dangerously-skip-permissions \
            --verbose \
            --output-format=stream-json \
            --model "$MODEL" \
            $chrome_flag | cclean

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
