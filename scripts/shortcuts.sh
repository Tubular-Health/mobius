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
#   md          - Define a new issue (launches runtime /define)
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

to_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

runtime_from_config() {
  local config_path="$1"
  local line
  local value

  [ -f "$config_path" ] || return 1

  while IFS= read -r line; do
    case "$line" in
      [[:space:]]*#* | "")
        continue
        ;;
    esac

    if [[ "$line" =~ ^[[:space:]]*runtime:[[:space:]]*([[:alnum:]_-]+)[[:space:]]*$ ]]; then
      value="$(to_lower "${BASH_REMATCH[1]}")"
      case "$value" in
        claude|opencode)
          printf '%s\n' "$value"
          return 0
          ;;
      esac
    fi
  done < "$config_path"

  return 1
}

find_local_config() {
  local dir="${PWD:-$(pwd)}"
  local candidate

  while :; do
    candidate="$dir/mobius.config.yaml"
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi

    if [ "$dir" = "/" ]; then
      break
    fi

    dir="$(dirname "$dir")"
  done

  return 1
}

resolve_selected_runtime() {
  local runtime="claude"
  local configured_runtime
  local local_config
  local config_base
  local global_config

  if [ -n "${MOBIUS_RUNTIME:-}" ]; then
    runtime="$(to_lower "$MOBIUS_RUNTIME")"
    case "$runtime" in
      claude|opencode)
        printf '%s\n' "$runtime"
        return
        ;;
      *)
        runtime="claude"
        ;;
    esac
  fi

  local_config="$(find_local_config 2>/dev/null || true)"
  if [ -n "$local_config" ]; then
    configured_runtime="$(runtime_from_config "$local_config" 2>/dev/null || true)"
    if [ -n "$configured_runtime" ]; then
      printf '%s\n' "$configured_runtime"
      return
    fi
  fi

  config_base="${XDG_CONFIG_HOME:-${HOME}/.config}"
  global_config="$config_base/mobius/config.yaml"
  configured_runtime="$(runtime_from_config "$global_config" 2>/dev/null || true)"
  if [ -n "$configured_runtime" ]; then
    printf '%s\n' "$configured_runtime"
    return
  fi

  printf '%s\n' "$runtime"
}

resolve_opencode_model() {
  local raw_model="${MOBIUS_OPENCODE_MODEL:-${MOBIUS_MODEL:-openai/gpt-5.3-codex}}"
  local normalized

  normalized="$(to_lower "$raw_model")"
  normalized="${normalized// /-}"

  case "$normalized" in
    ""|opus|sonnet|haiku|gpt-5.3|gpt-5.3-codex)
      printf '%s\n' "openai/gpt-5.3-codex"
      ;;
    gpt-5.2)
      printf '%s\n' "openai/gpt-5.2"
      ;;
    gpt-5.2-codex)
      printf '%s\n' "openai/gpt-5.2-codex"
      ;;
    gpt-5.1-codex)
      printf '%s\n' "openai/gpt-5.1-codex"
      ;;
    gpt-5.1-codex-max)
      printf '%s\n' "openai/gpt-5.1-codex-max"
      ;;
    gpt-5.1-codex-mini)
      printf '%s\n' "openai/gpt-5.1-codex-mini"
      ;;
    */*)
      printf '%s\n' "$raw_model"
      ;;
    *)
      printf '%s\n' "$normalized"
      ;;
  esac
}

run_runtime_prompt() {
  local runtime="$1"
  local prompt="$2"

  case "$runtime" in
    claude)
      claude "$prompt"
      ;;
    opencode)
      local model
      model="$(resolve_opencode_model)"
      opencode run "$prompt" --model "$model"
      ;;
    *)
      printf 'Unknown runtime: %s\n' "$runtime" >&2
      return 1
      ;;
  esac
}

md() {
  task
  local runtime
  runtime="$(resolve_selected_runtime)"
  run_runtime_prompt "$runtime" "/define $MOBIUS_TASK_ID"
}

mr() {
  task
  local runtime
  runtime="$(resolve_selected_runtime)"
  run_runtime_prompt "$runtime" "/refine $MOBIUS_TASK_ID"
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
  local selected
  selected=$(mobius list)
  if [ -n "$selected" ]; then
    export MOBIUS_TASK_ID="$selected"
    echo "MOBIUS_TASK_ID=$selected"
  fi
}

mc() {
  mobius clean "$@"
}
