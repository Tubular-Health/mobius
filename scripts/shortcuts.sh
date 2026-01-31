#!/bin/bash
# Mobius Workflow Shortcuts
#
# Sourceable shell script providing shorthand commands for the
# define-refine-execute-submit workflow.
#
# Usage:
#   source scripts/shortcuts.sh   # or add to your .bashrc/.zshrc
#
# Commands:
#   md          - Define a new issue (launches Claude /define)
#   mr          - Refine the current issue into sub-tasks
#   me [args]   - Execute sub-tasks for the current issue
#   ms [args]   - Submit/PR the current issue
#
# Workflow:
#   md                    # Define issue, sets MOBIUS_TASK_ID
#   mr                    # Refine into sub-tasks
#   me                    # Execute sub-tasks
#   me --parallel=3       # Execute with parallelism
#   ms                    # Submit PR

md() {
  claude "/define"
  printf "Enter issue ID: "
  read -r issue_id
  export MOBIUS_TASK_ID="$issue_id"
  echo "MOBIUS_TASK_ID set to $MOBIUS_TASK_ID"
}

mr() {
  if [ -z "${MOBIUS_TASK_ID:-}" ]; then
    echo "Error: MOBIUS_TASK_ID is not set. Run 'md' first to define an issue."
    return 1
  fi
  claude "/refine $MOBIUS_TASK_ID"
}

me() {
  if [ -z "${MOBIUS_TASK_ID:-}" ]; then
    echo "Error: MOBIUS_TASK_ID is not set. Run 'md' first to define an issue."
    return 1
  fi
  mobius "$MOBIUS_TASK_ID" "$@"
}

ms() {
  if [ -z "${MOBIUS_TASK_ID:-}" ]; then
    echo "Error: MOBIUS_TASK_ID is not set. Run 'md' first to define an issue."
    return 1
  fi
  mobius submit "$MOBIUS_TASK_ID" "$@"
}
