#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"
readonly DEFAULT_WORKFLOW=".github/workflows/ci.yml"
readonly DEFAULT_BASELINE_LIMIT=20
readonly DEFAULT_POST_LIMIT=20

usage() {
  cat <<'EOF'
Compute CI runtime medians and percent improvement from GitHub Actions runs.

Usage:
  scripts/ci-runtime-benchmark.sh [options]

Options:
  --baseline-limit N   Number of older runs used as baseline (default: 20)
  --post-limit N       Number of newest runs used as post-change sample (default: 20)
  --event NAME[,NAME]  Filter by event(s), e.g. push or push,pull_request
  --workflow PATH      Workflow name/path for gh run list (default: .github/workflows/ci.yml)
  --branch NAME        Optional branch filter
  --repo OWNER/REPO    Optional repository override
  --format FORMAT      Output format: human|json (default: human)
  --help               Show this help text

Notes:
  - Requires: gh, jq, and GitHub CLI authentication.
  - The newest N runs are treated as post-change; the next N older runs are baseline.
EOF
}

error() {
  printf 'ERROR: %s\n' "$1" >&2
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    error "Missing required command: $1"
    exit 1
  fi
}

is_positive_int() {
  [[ "$1" =~ ^[1-9][0-9]*$ ]]
}

median_from_lines() {
  local values
  values="$(cat)"
  if [[ -z "$values" ]]; then
    return 1
  fi

  local sorted count middle low high
  sorted="$(printf '%s\n' "$values" | sort -n)"
  count="$(printf '%s\n' "$sorted" | awk 'NF { c += 1 } END { print c + 0 }')"
  if [[ "$count" -eq 0 ]]; then
    return 1
  fi

  if (( count % 2 == 1 )); then
    middle=$((count / 2 + 1))
    printf '%s\n' "$sorted" | awk -v idx="$middle" 'NR == idx { print $1; exit }'
  else
    low=$((count / 2))
    high=$((low + 1))
    printf '%s\n' "$sorted" | awk -v a="$low" -v b="$high" '
      NR == a { x = $1 }
      NR == b { y = $1 }
      END {
        if (x == "" || y == "") {
          exit 1
        }
        printf "%.2f\n", (x + y) / 2
      }
    '
  fi
}

seconds_to_mmss() {
  awk -v value="$1" 'BEGIN {
    sec = value + 0
    minutes = int(sec / 60)
    rem = sec - (minutes * 60)
    printf "%dm %.2fs", minutes, rem
  }'
}

baseline_limit="$DEFAULT_BASELINE_LIMIT"
post_limit="$DEFAULT_POST_LIMIT"
event_filter=""
workflow="$DEFAULT_WORKFLOW"
branch=""
repo=""
format="human"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --baseline-limit)
      baseline_limit="${2:-}"
      shift 2
      ;;
    --post-limit)
      post_limit="${2:-}"
      shift 2
      ;;
    --event)
      event_filter="${2:-}"
      shift 2
      ;;
    --workflow)
      workflow="${2:-}"
      shift 2
      ;;
    --branch)
      branch="${2:-}"
      shift 2
      ;;
    --repo)
      repo="${2:-}"
      shift 2
      ;;
    --format)
      format="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      error "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if ! is_positive_int "$baseline_limit"; then
  error "--baseline-limit must be a positive integer"
  exit 1
fi

if ! is_positive_int "$post_limit"; then
  error "--post-limit must be a positive integer"
  exit 1
fi

if [[ "$format" != "human" && "$format" != "json" ]]; then
  error "--format must be one of: human, json"
  exit 1
fi

require_cmd gh
require_cmd jq
require_cmd date

if ! gh auth status >/dev/null 2>&1; then
  error "GitHub CLI is not authenticated. Run: gh auth login"
  exit 1
fi

total_needed=$((baseline_limit + post_limit))
fetch_limit=$((total_needed * 4))
if (( fetch_limit < 40 )); then
  fetch_limit=40
fi

gh_args=(run list --workflow "$workflow" --limit "$fetch_limit" --json databaseId,event,startedAt,updatedAt,status,url)

if [[ -n "$branch" ]]; then
  gh_args+=(--branch "$branch")
fi

if [[ -n "$repo" ]]; then
  gh_args+=(--repo "$repo")
fi

raw_runs_json="$(gh "${gh_args[@]}")"

events_json='[]'
if [[ -n "$event_filter" ]]; then
  IFS=',' read -r -a event_items <<< "$event_filter"
  cleaned_events=()
  for e in "${event_items[@]}"; do
    trimmed="$(printf '%s' "$e" | xargs)"
    if [[ -n "$trimmed" ]]; then
      cleaned_events+=("$trimmed")
    fi
  done
  if (( ${#cleaned_events[@]} == 0 )); then
    error "--event provided but no valid event names found"
    exit 1
  fi
  events_json="$(printf '%s\n' "${cleaned_events[@]}" | jq -R . | jq -s .)"
fi

duration_lines="$(jq -r --argjson events "$events_json" '
  [ .[]
    | select(.status == "completed")
    | select(.startedAt != null and .updatedAt != null)
    | select(($events | length == 0) or ((.event // "") as $ev | ($events | index($ev)) != null))
    | {
        id: (.databaseId | tostring),
        event: (.event // ""),
        startEpoch: (.startedAt | fromdateiso8601),
        endEpoch: (.updatedAt | fromdateiso8601),
        url: (.url // "")
      }
    | select(.endEpoch >= .startEpoch)
    | "\(.id)\t\(.event)\t\(.startEpoch)\t\(.endEpoch)\t\(.url)"
  ]
  | .[]
' <<< "$raw_runs_json")"

if [[ -z "$duration_lines" ]]; then
  error "No usable workflow runs found for the selected filters"
  exit 1
fi

post_values=""
baseline_values=""
post_count=0
baseline_count=0
post_example_url=""
baseline_example_url=""

while IFS=$'\t' read -r run_id run_event start_epoch end_epoch run_url; do
  duration=$((end_epoch - start_epoch))

  if (( post_count < post_limit )); then
    post_values+="${duration}"$'\n'
    post_count=$((post_count + 1))
    if [[ -z "$post_example_url" ]]; then
      post_example_url="$run_url"
    fi
  elif (( baseline_count < baseline_limit )); then
    baseline_values+="${duration}"$'\n'
    baseline_count=$((baseline_count + 1))
    if [[ -z "$baseline_example_url" ]]; then
      baseline_example_url="$run_url"
    fi
  fi

  if (( post_count >= post_limit && baseline_count >= baseline_limit )); then
    break
  fi
done <<< "$duration_lines"

if (( post_count < post_limit || baseline_count < baseline_limit )); then
  error "Insufficient run data: need ${post_limit} post and ${baseline_limit} baseline runs; found post=${post_count}, baseline=${baseline_count}"
  exit 1
fi

post_median="$(printf '%s' "$post_values" | median_from_lines)"
baseline_median="$(printf '%s' "$baseline_values" | median_from_lines)"

if [[ -z "$post_median" || -z "$baseline_median" ]]; then
  error "Failed to compute medians from collected run durations"
  exit 1
fi

improvement_pct="$(awk -v base="$baseline_median" -v post="$post_median" 'BEGIN {
  if (base <= 0) {
    print "0.00"
  } else {
    printf "%.2f", ((base - post) / base) * 100
  }
}')"

if [[ "$format" == "json" ]]; then
  jq -n \
    --arg workflow "$workflow" \
    --arg event_filter "$event_filter" \
    --arg branch "$branch" \
    --arg repo "$repo" \
    --arg baseline_median_seconds "$baseline_median" \
    --arg post_median_seconds "$post_median" \
    --arg improvement_percent "$improvement_pct" \
    --arg baseline_count "$baseline_count" \
    --arg post_count "$post_count" \
    --arg baseline_example_url "$baseline_example_url" \
    --arg post_example_url "$post_example_url" \
    '{
      workflow: $workflow,
      event_filter: (if $event_filter == "" then null else $event_filter end),
      branch: (if $branch == "" then null else $branch end),
      repo: (if $repo == "" then null else $repo end),
      baseline_count: ($baseline_count | tonumber),
      post_count: ($post_count | tonumber),
      baseline_median_seconds: ($baseline_median_seconds | tonumber),
      post_median_seconds: ($post_median_seconds | tonumber),
      improvement_percent: ($improvement_percent | tonumber),
      baseline_example_url: (if $baseline_example_url == "" then null else $baseline_example_url end),
      post_example_url: (if $post_example_url == "" then null else $post_example_url end)
    }'
  exit 0
fi

printf 'CI Runtime Benchmark\n'
printf 'Workflow: %s\n' "$workflow"
if [[ -n "$event_filter" ]]; then
  printf 'Event filter: %s\n' "$event_filter"
fi
if [[ -n "$branch" ]]; then
  printf 'Branch filter: %s\n' "$branch"
fi
if [[ -n "$repo" ]]; then
  printf 'Repository: %s\n' "$repo"
fi
printf '\n'
printf 'Baseline median: %s sec (%s) from %d runs\n' "$baseline_median" "$(seconds_to_mmss "$baseline_median")" "$baseline_count"
printf 'Post median:     %s sec (%s) from %d runs\n' "$post_median" "$(seconds_to_mmss "$post_median")" "$post_count"
printf 'Improvement:     %s%%\n' "$improvement_pct"
printf '\n'
printf 'BASELINE_MEDIAN_SECONDS=%s\n' "$baseline_median"
printf 'POST_MEDIAN_SECONDS=%s\n' "$post_median"
printf 'IMPROVEMENT_PERCENT=%s\n' "$improvement_pct"
printf 'BASELINE_COUNT=%d\n' "$baseline_count"
printf 'POST_COUNT=%d\n' "$post_count"
printf 'BASELINE_EXAMPLE_URL=%s\n' "$baseline_example_url"
printf 'POST_EXAMPLE_URL=%s\n' "$post_example_url"
