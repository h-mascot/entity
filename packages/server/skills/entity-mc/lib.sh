#!/usr/bin/env bash
set -euo pipefail

ENTITY_MC_SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTITY_MC_VERSION="$(cat "$ENTITY_MC_SKILL_DIR/VERSION" 2>/dev/null || printf 'unknown')"
ENTITY_MC_INSTALL_DIR="${ENTITY_MC_INSTALL_DIR:-${HOME}/.entity-mc}"
ENTITY_MC_BIN_DIR="${ENTITY_MC_BIN_DIR:-${HOME}/.local/bin}"
ENTITY_MC_ENTITY_URL="${ENTITY_MC_ENTITY_URL:-}"
ENTITY_MC_ONBOARDING_TOKEN="${ENTITY_MC_ONBOARDING_TOKEN:-}"

entity_mc_fail() {
  echo "ENTITY_MC_ERROR: $*" >&2
  exit 1
}

entity_mc_usage() {
  cat <<'USAGE'
Usage:
  install.sh [--entity-url URL] [--token TOKEN] [--install-dir DIR] [--bin-dir DIR]
  verify.sh [--entity-url URL] [--token TOKEN] [--install-dir DIR]
  rollback.sh [--install-dir DIR] [--bin-dir DIR]
  entity-mc <manifest|config|tasks|task|move-task|add-activity|progress>
USAGE
}

entity_mc_config_file() {
  printf '%s/config.env\n' "$ENTITY_MC_INSTALL_DIR"
}

entity_mc_load_config() {
  local config
  config="$(entity_mc_config_file)"
  if [[ -f "$config" ]]; then
    # shellcheck disable=SC1090
    source "$config"
  fi
}

entity_mc_parse_common_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --entity-url)
        ENTITY_MC_ENTITY_URL="${2:-}"
        shift 2
        ;;
      --token)
        ENTITY_MC_ONBOARDING_TOKEN="${2:-}"
        shift 2
        ;;
      --install-dir)
        ENTITY_MC_INSTALL_DIR="${2:-}"
        shift 2
        ;;
      --bin-dir)
        ENTITY_MC_BIN_DIR="${2:-}"
        shift 2
        ;;
      -h|--help)
        entity_mc_usage
        exit 0
        ;;
      *)
        entity_mc_fail "unknown argument: $1"
        ;;
    esac
  done
}

entity_mc_write_config() {
  mkdir -p "$ENTITY_MC_INSTALL_DIR"
  {
    printf 'ENTITY_MC_ENTITY_URL=%q\n' "$ENTITY_MC_ENTITY_URL"
    printf 'ENTITY_MC_ONBOARDING_TOKEN=%q\n' "$ENTITY_MC_ONBOARDING_TOKEN"
    printf 'ENTITY_MC_INSTALL_DIR=%q\n' "$ENTITY_MC_INSTALL_DIR"
    printf 'ENTITY_MC_BIN_DIR=%q\n' "$ENTITY_MC_BIN_DIR"
  } > "$(entity_mc_config_file)"
}

entity_mc_base_url() {
  entity_mc_load_config
  [[ -n "$ENTITY_MC_ENTITY_URL" ]] || entity_mc_fail "ENTITY_MC_ENTITY_URL is required"
  printf '%s' "${ENTITY_MC_ENTITY_URL%/}"
}

entity_mc_token() {
  entity_mc_load_config
  [[ -n "$ENTITY_MC_ONBOARDING_TOKEN" ]] || entity_mc_fail "ENTITY_MC_ONBOARDING_TOKEN is required"
  printf '%s' "$ENTITY_MC_ONBOARDING_TOKEN"
}

entity_mc_json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

entity_mc_request() {
  local method="$1"
  local request_path="$2"
  local body="${3:-}"
  local url
  url="$(entity_mc_base_url)$request_path"
  if [[ -n "$body" ]]; then
    curl -fsS -X "$method" "$url" \
      -H 'Content-Type: application/json' \
      -H 'X-Entity-Actor: entity-mc-agent' \
      --data "$body"
  else
    curl -fsS -X "$method" "$url" \
      -H 'X-Entity-Actor: entity-mc-agent'
  fi
}

entity_mc_status_json() {
  printf '{"version":"%s","installDir":"%s","binDir":"%s","entityUrl":"%s"}\n' \
    "$(entity_mc_json_escape "$ENTITY_MC_VERSION")" \
    "$(entity_mc_json_escape "$ENTITY_MC_INSTALL_DIR")" \
    "$(entity_mc_json_escape "$ENTITY_MC_BIN_DIR")" \
    "$(entity_mc_json_escape "$ENTITY_MC_ENTITY_URL")"
}
