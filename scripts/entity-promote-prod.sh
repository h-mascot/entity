#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

APPROVED=0
if [[ "${1:-}" == "--yes" ]]; then
  APPROVED=1
fi
if [[ "${ENTITY_PROD_APPROVED:-0}" == "1" ]]; then
  APPROVED=1
fi
if [[ "$APPROVED" != "1" ]]; then
  echo "[entity-promote] refusing prod deploy without explicit approval. Re-run with --yes or ENTITY_PROD_APPROVED=1 after sandbox verification." >&2
  exit 78
fi

missing=()
[[ -n "${ENTITY_PROD_HOST:-}" ]] || missing+=("ENTITY_PROD_HOST")
[[ -n "${ENTITY_PROD_HTTP_HOST:-}" ]] || missing+=("ENTITY_PROD_HTTP_HOST")
[[ -n "${ENTITY_PROD_DIR:-}" ]] || missing+=("ENTITY_PROD_DIR")
[[ -n "${ENTITY_PROD_DB:-}" ]] || missing+=("ENTITY_PROD_DB")
if ((${#missing[@]} > 0)); then
  echo "[entity-promote] deploy is not configured. Set required environment variables: ${missing[*]}" >&2
  exit 78
fi

export ENTITY_PROD_PORT="${ENTITY_PROD_PORT:-3000}"
export ENTITY_PROD_LOG_PATH="${ENTITY_PROD_LOG_PATH:-/tmp/entity-server.log}"
export ENTITY_PROD_LAUNCHD_SERVICE="${ENTITY_PROD_LAUNCHD_SERVICE:-}"
export ENTITY_RUNTIME_WORKSPACE="${ENTITY_RUNTIME_WORKSPACE:-}"

cd "$ROOT"
./deploy.sh --all
if [[ "$ENTITY_PROD_HTTP_HOST" == http://* || "$ENTITY_PROD_HTTP_HOST" == https://* ]]; then
  PROD_BASE_URL="${ENTITY_PROD_HTTP_HOST%/}"
else
  PROD_BASE_URL="http://${ENTITY_PROD_HTTP_HOST}:${ENTITY_PROD_PORT}"
fi
CTRL_LIVE_BASE_URL="$PROD_BASE_URL" npm run test:live
npm run test:deploy
