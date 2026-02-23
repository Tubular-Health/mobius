#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ISSUE_ID="DEMO-1"
ISSUE_DIR="$PROJECT_ROOT/.mobius/issues/$ISSUE_ID"
TASKS_DIR="$ISSUE_DIR/tasks"

mkdir -p "$TASKS_DIR"

cat > "$ISSUE_DIR/parent.json" <<'JSON'
{
  "id": "DEMO-1",
  "identifier": "DEMO-1",
  "title": "Demo workflow: parallel execution with verification",
  "description": "Seeded local demo issue used to rebuild the workflow GIF.",
  "gitBranchName": "demo/demo-1-workflow",
  "status": "in progress",
  "labels": ["demo"],
  "url": "https://example.local/mobius/demo/DEMO-1"
}
JSON

cat > "$TASKS_DIR/task-001.json" <<'JSON'
{
  "id": "task-001",
  "identifier": "task-001",
  "title": "[DEMO-1] Prepare demo task graph",
  "description": "Create deterministic local state for the workflow recording.",
  "status": "pending",
  "gitBranchName": "demo/demo-1-task-001",
  "blockedBy": [],
  "blocks": [
    {
      "id": "task-002",
      "identifier": "task-002"
    },
    {
      "id": "task-003",
      "identifier": "task-003"
    }
  ]
}
JSON

cat > "$TASKS_DIR/task-002.json" <<'JSON'
{
  "id": "task-002",
  "identifier": "task-002",
  "title": "[DEMO-1] Simulate implementation branch A",
  "description": "Represents the first independent implementation sub-task.",
  "status": "pending",
  "gitBranchName": "demo/demo-1-task-002",
  "blockedBy": [
    {
      "id": "task-001",
      "identifier": "task-001"
    }
  ],
  "blocks": [
    {
      "id": "task-004",
      "identifier": "task-004"
    }
  ]
}
JSON

cat > "$TASKS_DIR/task-003.json" <<'JSON'
{
  "id": "task-003",
  "identifier": "task-003",
  "title": "[DEMO-1] Simulate implementation branch B",
  "description": "Represents the second independent implementation sub-task.",
  "status": "pending",
  "gitBranchName": "demo/demo-1-task-003",
  "blockedBy": [
    {
      "id": "task-001",
      "identifier": "task-001"
    }
  ],
  "blocks": [
    {
      "id": "task-004",
      "identifier": "task-004"
    }
  ]
}
JSON

cat > "$TASKS_DIR/task-004.json" <<'JSON'
{
  "id": "task-004",
  "identifier": "task-004",
  "title": "[DEMO-1] Verification Gate",
  "description": "Final gate task that runs after implementation tasks are complete.",
  "status": "pending",
  "gitBranchName": "demo/demo-1-task-004",
  "blockedBy": [
    {
      "id": "task-002",
      "identifier": "task-002"
    },
    {
      "id": "task-003",
      "identifier": "task-003"
    }
  ],
  "blocks": []
}
JSON

printf 'Seeded local demo issue at %s\n' "$ISSUE_DIR"
