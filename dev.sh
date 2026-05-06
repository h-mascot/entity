#!/usr/bin/env bash
# Entity local dev server. Public-safe by default; reads entity.config.yaml/.env.
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd "${ROOT_DIR}"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

export ENTITY_DB_MODE="${ENTITY_DB_MODE:-LOCAL}"
export ENTITY_CLOUD_API_BASE="${ENTITY_CLOUD_API_BASE:-http://localhost:3000}"
export ENTITY_FS_MULTISOURCE="${ENTITY_FS_MULTISOURCE:-true}"
export ENTITY_AGENT_NATIVE_EDITOR="${ENTITY_AGENT_NATIVE_EDITOR:-true}"
export VITE_ENTITY_FS_MULTISOURCE="${VITE_ENTITY_FS_MULTISOURCE:-${ENTITY_FS_MULTISOURCE}}"
export VITE_ENTITY_AGENT_NATIVE_EDITOR="${VITE_ENTITY_AGENT_NATIVE_EDITOR:-${ENTITY_AGENT_NATIVE_EDITOR}}"

if [[ ! -f entity.config.yaml ]]; then
  echo "[dev] entity.config.yaml not found; running setup first"
  npm run setup
else
  npm run setup -- --check
fi

echo "[dev] Entity server DB mode: ${ENTITY_DB_MODE}"
echo "[dev] API base: ${ENTITY_CLOUD_API_BASE}"

npx ts-node packages/server/src/index.ts &
SERVER_PID=$!
(
  cd packages/app
  npx vite
) &
APP_PID=$!

trap 'kill ${SERVER_PID} ${APP_PID} 2>/dev/null || true' EXIT
wait
