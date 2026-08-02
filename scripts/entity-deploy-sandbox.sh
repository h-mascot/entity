#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

missing=()
[[ -n "${ENTITY_SANDBOX_HOST:-}" ]] || missing+=("ENTITY_SANDBOX_HOST")
[[ -n "${ENTITY_SANDBOX_HTTP_HOST:-}" ]] || missing+=("ENTITY_SANDBOX_HTTP_HOST")
[[ -n "${ENTITY_SANDBOX_DIR:-}" ]] || missing+=("ENTITY_SANDBOX_DIR")
[[ -n "${ENTITY_SANDBOX_DB:-}" ]] || missing+=("ENTITY_SANDBOX_DB")
if ((${#missing[@]} > 0)); then
  echo "[entity-sandbox] deploy is not configured. Set required environment variables: ${missing[*]}" >&2
  exit 78
fi

export ENTITY_PROD_HOST="${ENTITY_SANDBOX_HOST}"
export ENTITY_PROD_HTTP_HOST="${ENTITY_SANDBOX_HTTP_HOST}"
export ENTITY_PROD_PORT="${ENTITY_SANDBOX_PORT:-3007}"
export ENTITY_PROD_DIR="${ENTITY_SANDBOX_DIR}"
export ENTITY_PROD_DB="${ENTITY_SANDBOX_DB}"
export ENTITY_PROD_LOG_PATH="${ENTITY_SANDBOX_LOG_PATH:-/tmp/entity-sandbox.log}"
export ENTITY_PROD_LAUNCHD_SERVICE="${ENTITY_SANDBOX_LAUNCHD_SERVICE:-}"
export ENTITY_RUNTIME_WORKSPACE="${ENTITY_SANDBOX_WORKSPACE:-}"

if [[ "$ENTITY_PROD_HTTP_HOST" == http://* || "$ENTITY_PROD_HTTP_HOST" == https://* ]]; then
  SANDBOX_BASE_URL="${ENTITY_PROD_HTTP_HOST%/}"
else
  SANDBOX_BASE_URL="http://${ENTITY_PROD_HTTP_HOST}:${ENTITY_PROD_PORT}"
fi
export ENTITY_PUBLIC_BASE_URL="${ENTITY_PUBLIC_BASE_URL:-$SANDBOX_BASE_URL}"
export ENTITY_CLOUD_API_BASE="${ENTITY_CLOUD_API_BASE:-$SANDBOX_BASE_URL}"
export VITE_ENTITY_API_BASE="${VITE_ENTITY_API_BASE:-$SANDBOX_BASE_URL}"
export VITE_MC_ORIGIN="${VITE_MC_ORIGIN:-$SANDBOX_BASE_URL}"
if [[ "$SANDBOX_BASE_URL" == https://* ]]; then
  export VITE_ENTITY_WS_URL="${VITE_ENTITY_WS_URL:-wss://${SANDBOX_BASE_URL#https://}}"
else
  export VITE_ENTITY_WS_URL="${VITE_ENTITY_WS_URL:-ws://${SANDBOX_BASE_URL#http://}}"
fi

cd "$ROOT"
./deploy.sh --all
if [[ "$ENTITY_PROD_HTTP_HOST" == http://* || "$ENTITY_PROD_HTTP_HOST" == https://* ]]; then
  SANDBOX_BASE_URL="${ENTITY_PROD_HTTP_HOST%/}"
else
  SANDBOX_BASE_URL="http://${ENTITY_PROD_HTTP_HOST}:${ENTITY_PROD_PORT}"
fi
CTRL_LIVE_BASE_URL="$SANDBOX_BASE_URL" npm run test:live
