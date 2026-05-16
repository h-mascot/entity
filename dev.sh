#!/bin/bash
# Entity dev server - local-only development defaults
# No hardcoded Enterprise paths, IPs, or remote connections

set -e

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}" && pwd -P)"

# Load .env if present
if [[ -f "${REPO_ROOT}/.env" ]]; then
  set -a
  source "${REPO_ROOT}/.env"
  set +a
fi

# Safe local-only defaults
export ENTITY_DB_MODE="${ENTITY_DB_MODE:-LOCAL}"
export ENTITY_CLOUD_API_BASE="${ENTITY_CLOUD_API_BASE:-http://localhost:3000}"
export ENTITY_FS_MULTISOURCE="${ENTITY_FS_MULTISOURCE:-true}"
export ENTITY_AGENT_NATIVE_EDITOR="${ENTITY_AGENT_NATIVE_EDITOR:-true}"
export ENTITY_WORKSPACE_ROOT="${ENTITY_WORKSPACE_ROOT:-${HOME}/entity-workspace}"

cd "${REPO_ROOT}"

# Check prerequisites
if [[ ! -f "packages/server/dist/server/src/index.js" ]]; then
  echo "[dev] Server not built. Run: npm run build"
  exit 1
fi

echo "Entity dev server (local mode)"
echo "  DB mode: ${ENTITY_DB_MODE}"
echo "  API: ${ENTITY_CLOUD_API_BASE}"
echo "  Workspace: ${ENTITY_WORKSPACE_ROOT}"
echo ""

# Start server in background
cd packages/server && npx ts-node src/index.ts &
SERVER_PID=$!

# Trap to kill server on exit
trap "kill $SERVER_PID 2>/dev/null" EXIT

# Wait for server
sleep 3

echo "Server running at ${ENTITY_CLOUD_API_BASE}"
echo "Press Ctrl+C to stop"

wait $SERVER_PID
