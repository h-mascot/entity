#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

missing=()
[[ -n "${ENTITY_SANDBOX_HTTP_HOST:-}" ]] || missing+=("ENTITY_SANDBOX_HTTP_HOST")
if ((${#missing[@]} > 0)); then
  echo "[entity-sandbox] verify is not configured. Set required environment variables: ${missing[*]}" >&2
  exit 78
fi

SANDBOX_PORT="${ENTITY_SANDBOX_PORT:-3007}"
if [[ "${ENTITY_SANDBOX_HTTP_HOST}" == http://* || "${ENTITY_SANDBOX_HTTP_HOST}" == https://* ]]; then
  SANDBOX_BASE_URL="${ENTITY_SANDBOX_HTTP_HOST%/}"
else
  SANDBOX_BASE_URL="http://${ENTITY_SANDBOX_HTTP_HOST}:${SANDBOX_PORT}"
fi

cd "$ROOT"
CTRL_LIVE_BASE_URL="$SANDBOX_BASE_URL" npm run test:live
