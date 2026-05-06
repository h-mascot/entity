#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
source "$INSTALL_DIR/lib.sh"

command="${1:-help}"
shift || true

usage() {
  cat <<'USAGE'
Entity MC

Commands:
  manifest                         Fetch onboarding manifest
  progress <id> <status> [message] Update onboarding progress
  config                           Fetch effective Entity config
  tasks                            List tasks
  task <id>                        Show one task
  move-task <id> <column>          Move a Mission Control card
  add-activity <id> <note>         Add a technical activity note
  help                             Show this help

Global env:
  ENTITY_MC_ENTITY_URL
  ENTITY_MC_ONBOARDING_TOKEN
USAGE
}

case "$command" in
  manifest)
    entity_mc_request GET "/api/onboarding/agent-session/$(entity_mc_token)/manifest"
    ;;
  progress)
    id="${1:-}"
    status="${2:-}"
    message="${3:-}"
    [[ -n "$id" && -n "$status" ]] || entity_mc_fail "usage: entity-mc progress <id> <status> [message]"
    body="{\"id\":\"$(entity_mc_json_escape "$id")\",\"status\":\"$(entity_mc_json_escape "$status")\""
    if [[ -n "$message" ]]; then
      body="$body,\"message\":\"$(entity_mc_json_escape "$message")\""
    fi
    body="$body}"
    entity_mc_request PATCH "/api/onboarding/agent-session/$(entity_mc_token)/progress" "$body"
    ;;
  config)
    entity_mc_request GET "/api/config/effective"
    ;;
  tasks)
    entity_mc_request GET "/api/tasks"
    ;;
  task)
    id="${1:-}"
    [[ -n "$id" ]] || entity_mc_fail "usage: entity-mc task <id>"
    entity_mc_request GET "/api/tasks/$id"
    ;;
  move-task)
    id="${1:-}"
    column="${2:-}"
    [[ -n "$id" && -n "$column" ]] || entity_mc_fail "usage: entity-mc move-task <id> <column>"
    entity_mc_request PUT "/api/tasks/$id/move" "{\"column\":\"$(entity_mc_json_escape "$column")\"}"
    ;;
  add-activity)
    id="${1:-}"
    note="${2:-}"
    [[ -n "$id" && -n "$note" ]] || entity_mc_fail "usage: entity-mc add-activity <id> <note>"
    entity_mc_request POST "/api/tasks/$id/activity" "{\"type\":\"technical\",\"body\":\"$(entity_mc_json_escape "$note")\",\"actor\":\"entity-mc-agent\"}"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    usage >&2
    entity_mc_fail "unknown command: $command"
    ;;
esac
