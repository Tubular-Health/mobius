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
#   ml          - List all local issues
#   mc [args]   - Clean completed issues from local storage
#
# Workflow:
#   md                    # Define issue, sets MOBIUS_TASK_ID
#   mr                    # Refine into sub-tasks
#   me                    # Execute sub-tasks
#   me --parallel=3       # Execute with parallelism
#   ms                    # Submit PR

task() {
  if [ -z "${MOBIUS_TASK_ID:-}" ]; then
    printf "Enter issue ID: "
    read -r issue_id
    export MOBIUS_TASK_ID="$issue_id"
  fi
}

md() {
  task
  claude "/define $MOBIUS_TASK_ID"
}

mr() {
  task
  claude "/refine $MOBIUS_TASK_ID"
}

me() {
  task
  mobius "$MOBIUS_TASK_ID" "$@"
}

ms() {
  task
  mobius submit "$MOBIUS_TASK_ID" "$@"
}

ml() {
  mobius list
}

mc() {
  mobius clean "$@"
}
