#!/bin/bash
# capture-agent-todos.sh - PostToolUse hook for capturing agent todo progress
#
# Reads Claude Code PostToolUse hook JSON from stdin, resolves the calling
# agent's subtask ID via PPID lookup in runtime.json, and writes todo data
# to .mobius/issues/{parentId}/execution/todos/{subtaskId}.json for TUI display.
#
# Exit codes: Always exits 0 to avoid interrupting Claude Code.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

log() { echo "[capture-todos] $1" >&2; }

# --------------------------------------------------------------------------
# Pre-flight: check for jq
# --------------------------------------------------------------------------
if ! command -v jq &> /dev/null; then
    log "ERROR: jq is required but not installed"
    exit 0
fi

# --------------------------------------------------------------------------
# Read hook JSON from stdin
# --------------------------------------------------------------------------
HOOK_JSON=$(cat)

if [ -z "$HOOK_JSON" ]; then
    exit 0
fi

TOOL_NAME=$(echo "$HOOK_JSON" | jq -r '.tool_name // empty' 2>/dev/null)

if [ -z "$TOOL_NAME" ]; then
    exit 0
fi

# --------------------------------------------------------------------------
# Early exit if tool_name is not one we care about
# --------------------------------------------------------------------------
case "$TOOL_NAME" in
    TodoWrite|TaskCreate|TaskUpdate) ;;
    *) exit 0 ;;
esac

# --------------------------------------------------------------------------
# Resolve PPID to find the Claude Code process
# --------------------------------------------------------------------------
AGENT_PID="$PPID"

# --------------------------------------------------------------------------
# Find runtime.json by scanning .mobius/issues/*/execution/runtime.json
# --------------------------------------------------------------------------
MOBIUS_DIR="$PROJECT_ROOT/.mobius"
RUNTIME_FILE=""
PARENT_ID=""

for candidate in "$MOBIUS_DIR"/issues/*/execution/runtime.json; do
    [ -f "$candidate" ] || continue
    RUNTIME_FILE="$candidate"
    # Extract parentId from the runtime.json
    PARENT_ID=$(jq -r '.parentId // empty' "$candidate" 2>/dev/null)
    if [ -n "$PARENT_ID" ]; then
        break
    fi
done

if [ -z "$RUNTIME_FILE" ] || [ -z "$PARENT_ID" ]; then
    log "WARNING: No runtime.json found with parentId in $MOBIUS_DIR/issues/*/execution/"
    exit 0
fi

# --------------------------------------------------------------------------
# Find matching subtask ID by walking up the process tree
# --------------------------------------------------------------------------
SUBTASK_ID=""

# Try matching PPID directly against activeTasks PIDs
SUBTASK_ID=$(jq -r --argjson pid "$AGENT_PID" \
    '.activeTasks[]? | select(.pid == $pid) | .id // empty' \
    "$RUNTIME_FILE" 2>/dev/null)

# If no direct match, walk up the process tree (PPID -> parent -> grandparent)
if [ -z "$SUBTASK_ID" ]; then
    CURRENT_PID="$AGENT_PID"
    for _ in 1 2 3 4 5; do
        CURRENT_PID=$(ps -o ppid= -p "$CURRENT_PID" 2>/dev/null | tr -d ' ')
        [ -z "$CURRENT_PID" ] || [ "$CURRENT_PID" = "1" ] && break
        SUBTASK_ID=$(jq -r --argjson pid "$CURRENT_PID" \
            '.activeTasks[]? | select(.pid == $pid) | .id // empty' \
            "$RUNTIME_FILE" 2>/dev/null)
        [ -n "$SUBTASK_ID" ] && break
    done
fi

if [ -z "$SUBTASK_ID" ]; then
    log "WARNING: PID $AGENT_PID (and ancestors) not found in activeTasks of $RUNTIME_FILE"
    exit 0
fi

# --------------------------------------------------------------------------
# Extract todo data from hook input and build output JSON
# --------------------------------------------------------------------------
UPDATED_AT=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

# Build output JSON depending on tool type
if [ "$TOOL_NAME" = "TodoWrite" ]; then
    # TodoWrite provides a todos array in tool_input
    TASKS_JSON=$(echo "$HOOK_JSON" | jq -c '
        [.tool_input.todos[]? | {
            subject: .content,
            status: .status,
            description: (.description // null)
        }]' 2>/dev/null)
else
    # TaskCreate/TaskUpdate - extract what we can
    TASKS_JSON=$(echo "$HOOK_JSON" | jq -c '
        [.tool_input | {
            subject: (.description // .title // "unknown"),
            status: (.status // "pending"),
            description: null
        }]' 2>/dev/null)
fi

if [ -z "$TASKS_JSON" ] || [ "$TASKS_JSON" = "null" ]; then
    TASKS_JSON="[]"
fi

OUTPUT_JSON=$(jq -n \
    --arg subtaskId "$SUBTASK_ID" \
    --arg updatedAt "$UPDATED_AT" \
    --argjson tasks "$TASKS_JSON" \
    '{subtaskId: $subtaskId, updatedAt: $updatedAt, tasks: $tasks}')

# --------------------------------------------------------------------------
# Write output atomically to todos directory
# --------------------------------------------------------------------------
TODOS_DIR="$MOBIUS_DIR/issues/$PARENT_ID/execution/todos"
mkdir -p "$TODOS_DIR"

OUTPUT_FILE="$TODOS_DIR/${SUBTASK_ID}.json"
TEMP_FILE="${OUTPUT_FILE}.tmp"

echo "$OUTPUT_JSON" > "$TEMP_FILE"
mv "$TEMP_FILE" "$OUTPUT_FILE"

exit 0
