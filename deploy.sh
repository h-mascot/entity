#!/usr/bin/env bash
# Entity Safe Deploy Script
#
# Public repos must not ship a deploy path that silently targets one private
# machine or falls back to a checkout-local sample DB. Configure all production
# values explicitly before running a real deploy.
set -euo pipefail

export PATH=/opt/homebrew/bin:$PATH

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
MODE="--all"
PRINT_CONFIG=0

for arg in "$@"; do
  case "$arg" in
    --all|--server-only|--frontend-only) MODE="$arg" ;;
    --print-config) PRINT_CONFIG=1 ;;
    *)
      echo "ERROR: Unsupported deploy argument: $arg" >&2
      echo "Usage: ENTITY_PROD_HOST=... ENTITY_PROD_DIR=... ENTITY_PROD_DB=... ENTITY_PROD_HTTP_HOST=... [ENTITY_PROD_PORT=3000] ./deploy.sh [--all|--server-only|--frontend-only] [--print-config]" >&2
      exit 64
      ;;
  esac
done

PROD_HOST="${ENTITY_PROD_HOST:-}"
PROD_HTTP_HOST="${ENTITY_PROD_HTTP_HOST:-}"
PROD_PORT="${ENTITY_PROD_PORT:-3000}"
ENTITY_DIR="${ENTITY_PROD_DIR:-}"
PROD_DB="${ENTITY_PROD_DB:-}"
MAC_ENTITY_DIR="${ENTITY_SOURCE_DIR:-${SCRIPT_DIR}}"
RUNTIME_WORKSPACE="${ENTITY_RUNTIME_WORKSPACE:-}"
RUNTIME_LOG_PATH="${ENTITY_PROD_LOG_PATH:-/tmp/entity-server.log}"
RUNTIME_LAUNCHD_SERVICE="${ENTITY_PROD_LAUNCHD_SERVICE:-}"
RUNTIME_NODE_ENTRY="${ENTITY_PROD_NODE_ENTRY:-packages/server/dist/server/src/index.js}"
RELEASE_CHECK_SCRIPT="${SCRIPT_DIR}/scripts/entity-release-check.sh"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)
SERVER_DIST="${ENTITY_DIR}/packages/server/dist"
FRONTEND_DIST="${ENTITY_DIR}/packages/app/dist"
SKIP_MAC_BUILD="${ENTITY_SKIP_MAC_BUILD:-0}"
DRY_RUN="${ENTITY_DEPLOY_DRY_RUN:-0}"
SKIP_RESTART="${ENTITY_DEPLOY_SKIP_RESTART:-0}"
RELEASE_SHA="${ENTITY_RELEASE_SHA:-}"
RELEASE_BRANCH="${ENTITY_RELEASE_BRANCH:-}"
RELEASE_ENVIRONMENT="${ENTITY_RELEASE_ENVIRONMENT:-sandbox-or-prod-agnostic}"
MIN_TASKS="${ENTITY_DEPLOY_MIN_TASKS:-10}"
if [[ -z "$PROD_HTTP_HOST" ]]; then
  PROD_BASE_URL=""
elif [[ "$PROD_HTTP_HOST" == http://* || "$PROD_HTTP_HOST" == https://* ]]; then
  PROD_BASE_URL="${PROD_HTTP_HOST%/}"
else
  PROD_BASE_URL="http://${PROD_HTTP_HOST}:${PROD_PORT}"
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1" >&2; exit "${2:-1}"; }

missing=()
[[ -n "$PROD_HOST" ]] || missing+=("ENTITY_PROD_HOST")
[[ -n "$PROD_HTTP_HOST" ]] || missing+=("ENTITY_PROD_HTTP_HOST")
[[ -n "$ENTITY_DIR" ]] || missing+=("ENTITY_PROD_DIR")
[[ -n "$PROD_DB" ]] || missing+=("ENTITY_PROD_DB")

if [[ "$PRINT_CONFIG" == "1" ]]; then
  cat <<EOF
mode=${MODE}
dryRun=${DRY_RUN}
sourceDir=${MAC_ENTITY_DIR}
prodHost=${PROD_HOST:-<missing>}
prodHttpHost=${PROD_HTTP_HOST:-<missing>}
prodPort=${PROD_PORT}
prodBaseUrl=${PROD_BASE_URL:-<missing>}
prodDir=${ENTITY_DIR:-<missing>}
prodDb=${PROD_DB:-<missing>}
runtimeWorkspace=${RUNTIME_WORKSPACE:-<unset>}
runtimeLogPath=${RUNTIME_LOG_PATH}
runtimeLaunchdService=${RUNTIME_LAUNCHD_SERVICE:-<unset>}
runtimeNodeEntry=${RUNTIME_NODE_ENTRY}
skipMacBuild=${SKIP_MAC_BUILD}
skipRestart=${SKIP_RESTART}
releaseSha=${RELEASE_SHA:-<unset>}
releaseBranch=${RELEASE_BRANCH:-<unset>}
releaseEnvironment=${RELEASE_ENVIRONMENT}
EOF
fi

if ((${#missing[@]} > 0)); then
  error "Deploy is not configured. Set required environment variables: ${missing[*]}. Refusing to use public repo defaults for a production target or DB." 78
fi

if [[ ! "${MIN_TASKS}" =~ ^[0-9]+$ ]]; then
  error "ENTITY_DEPLOY_MIN_TASKS must be numeric, got: ${MIN_TASKS}"
fi

if [[ "$PRINT_CONFIG" == "1" && "$DRY_RUN" == "1" ]]; then
  log "Dry-run config check complete; no deploy performed."
  exit 0
fi

if [[ "$DRY_RUN" == "1" ]]; then
  log "ENTITY_DEPLOY_DRY_RUN=1 set; no deploy performed."
  exit 0
fi

if [[ "${ENTITY_ALLOW_DIRTY_DEPLOY:-0}" != "1" ]]; then
  if [[ -x "${RELEASE_CHECK_SCRIPT}" ]]; then
    "${RELEASE_CHECK_SCRIPT}"
  else
    warn "Release safety check script not found; continuing."
  fi
fi

log "Pre-flight: checking production DB on ${PROD_HOST}..."
TASK_COUNT=$(ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "sqlite3 '${PROD_DB}' 'select count(*) from tasks;'" 2>/dev/null || echo "0")
TASK_COUNT=$(printf '%s' "${TASK_COUNT}" | tr -d '[:space:]')
log "Production DB has ${TASK_COUNT} tasks"

if [[ ! "${TASK_COUNT}" =~ ^[0-9]+$ ]]; then
  error "Production DB count was not numeric: ${TASK_COUNT}"
fi

if [[ "$TASK_COUNT" -lt "$MIN_TASKS" ]]; then
  error "Production DB looks wrong (only ${TASK_COUNT} tasks, minimum ${MIN_TASKS}). Aborting before sync."
fi

BACKUP_TS=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${PROD_DB}.backup.${BACKUP_TS}"
log "Backing up production DB..."
ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; cp '${PROD_DB}' '${BACKUP_PATH}'; sqlite3 '${PROD_DB}' 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null; cp '${PROD_DB}' '${BACKUP_PATH}.post-checkpoint'"
log "Backed up DB to ${BACKUP_PATH}"

if [[ "$MODE" == "--all" || "$MODE" == "--server-only" ]]; then
  if [[ "$SKIP_MAC_BUILD" != "1" ]]; then
    log "Building DB + Server..."
    cd "${MAC_ENTITY_DIR}"
    npm --prefix packages/db run build
    npm --prefix packages/server run build
  fi
fi

if [[ "$MODE" == "--all" || "$MODE" == "--frontend-only" ]]; then
  if [[ "$SKIP_MAC_BUILD" != "1" ]]; then
    log "Building Frontend..."
    cd "${MAC_ENTITY_DIR}"
    npm --prefix packages/app run build
  fi
fi

log "Syncing built files to configured target; DB files are excluded."
ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; mkdir -p '${ENTITY_DIR}/packages/server/src/plugins' '${ENTITY_DIR}/packages/db/dist' '${SERVER_DIST}' '${FRONTEND_DIST}'"
if [[ "$MODE" == "--all" || "$MODE" == "--server-only" ]]; then
  rsync -avz -e "ssh ${SSH_OPTS[*]}" --delete --exclude='*.db' --exclude='*.db-*' --exclude='*.db-shm' --exclude='*.db-wal' "${MAC_ENTITY_DIR}/packages/server/src/plugins/" "${PROD_HOST}:${ENTITY_DIR}/packages/server/src/plugins/"
  rsync -avz -e "ssh ${SSH_OPTS[*]}" --exclude='*.db' --exclude='*.db-*' --exclude='*.db-shm' --exclude='*.db-wal' "${MAC_ENTITY_DIR}/packages/db/dist/" "${PROD_HOST}:${ENTITY_DIR}/packages/db/dist/"
  rsync -avz -e "ssh ${SSH_OPTS[*]}" --exclude='db/' --exclude='app/' "${MAC_ENTITY_DIR}/packages/server/dist/" "${PROD_HOST}:${SERVER_DIST}/"
  ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; mkdir -p '${SERVER_DIST}/db/src'; cp '${ENTITY_DIR}'/packages/db/dist/*.js '${SERVER_DIST}/db/src/'"
fi

if [[ "$MODE" == "--all" || "$MODE" == "--frontend-only" ]]; then
  rsync -avz --delete -e "ssh ${SSH_OPTS[*]}" --exclude='*.db' --exclude='*.db-*' --exclude='*.db-shm' --exclude='*.db-wal' "${MAC_ENTITY_DIR}/packages/app/dist/" "${PROD_HOST}:${FRONTEND_DIST}/"
fi

if [[ -n "$RELEASE_SHA" ]]; then
  log "Syncing runtime dependencies into immutable release..."
  rsync -az --delete -e "ssh ${SSH_OPTS[*]}"     --exclude='.cache/'     --exclude='*.log'     "${MAC_ENTITY_DIR}/node_modules/" "${PROD_HOST}:${ENTITY_DIR}/node_modules/"
fi

SYMLINK_TARGET=$(ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' '${SERVER_DIST}/db/entity-tasks.db' 2>/dev/null || echo NOT_A_SYMLINK")
if [[ "$SYMLINK_TARGET" != "$PROD_DB" ]]; then
  warn "DB symlink was broken. Restoring explicit configured DB target."
  ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "rm -f '${SERVER_DIST}/db/entity-tasks.db' && ln -s '${PROD_DB}' '${SERVER_DIST}/db/entity-tasks.db'"
fi

if [[ -n "$RELEASE_SHA" ]]; then
  log "Writing release identity metadata for ${RELEASE_SHA}..."
  node "${SCRIPT_DIR}/scripts/entity-release-info.mjs" --root "${ENTITY_DIR}" --sha "${RELEASE_SHA}" --branch "${RELEASE_BRANCH}" --environment "${RELEASE_ENVIRONMENT}" --write >/dev/null
fi

log "Writing server runtime .env for configured TTS providers..."
RUNTIME_ENV_TMP=$(mktemp)
python3 - "${RUNTIME_ENV_TMP}" <<'PY'
import os
import sys
from shlex import quote
keys = [
    'KOKORO_TTS_BASE_URL',
    'KOKORO_TTS_DEFAULT_VOICE',
    'OPENAI_API_KEY',
    'OPENAI_TTS_MODEL',
    'OPENAI_TTS_VOICE',
    'EDGE_TTS_COMMAND',
    'EDGE_TTS_VOICE',
    'EDGE_TTS_TIMEOUT_MS',
    'DEEPGRAM_API_KEY',
    'DEEPGRAM_TTS_VOICE',
    'ELEVENLABS_API_KEY',
    'ELEVENLABS_TTS_VOICE',
    'TTS_MAX_CHARS',
    'ENTITY_PUBLIC_BASE_URL',
    'ENTITY_API_BASE_URL',
    'ENTITY_CLOUD_API_BASE',
    'VITE_ENTITY_API_BASE',
    'VITE_MC_ORIGIN',
    'ENTITY_WS_BASE_URL',
    'VITE_ENTITY_WS_URL',
]
with open(sys.argv[1], 'w') as fh:
    fh.write('# Generated by Entity deploy.sh. Do not commit.\n')
    for key in keys:
        value = os.environ.get(key, '')
        if value:
            fh.write(f'{key}={quote(value)}\n')
PY
ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; mkdir -p '${ENTITY_DIR}/packages/server/dist'"
rsync -az -e "ssh ${SSH_OPTS[*]}" "${RUNTIME_ENV_TMP}" "${PROD_HOST}:${ENTITY_DIR}/packages/server/.env"
rsync -az -e "ssh ${SSH_OPTS[*]}" "${RUNTIME_ENV_TMP}" "${PROD_HOST}:${ENTITY_DIR}/packages/server/dist/.env"
rm -f "${RUNTIME_ENV_TMP}"

if [[ "$SKIP_RESTART" == "1" ]]; then
  log "ENTITY_DEPLOY_SKIP_RESTART=1 set; skipping service restart and live API verification."
  log "Deploy complete without restart: ${TASK_COUNT} preflight tasks"
  exit 0
fi

log "Restarting server..."
REMOTE_ENV="PORT=${PROD_PORT}"
if [[ -n "$RUNTIME_WORKSPACE" ]]; then
  REMOTE_ENV="${REMOTE_ENV} WORKSPACE='${RUNTIME_WORKSPACE}'"
fi

ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; UID_NUM=\$(id -u); if [[ -n '${RUNTIME_LAUNCHD_SERVICE}' ]] && launchctl print \"gui/\${UID_NUM}/${RUNTIME_LAUNCHD_SERVICE}\" >/dev/null 2>&1; then launchctl kickstart -k \"gui/\${UID_NUM}/${RUNTIME_LAUNCHD_SERVICE}\"; else lsof -i :'${PROD_PORT}' -t 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 2; mkdir -p \"\$(dirname '${RUNTIME_LOG_PATH}')\"; cd '${ENTITY_DIR}' && ${REMOTE_ENV} nohup node '${RUNTIME_NODE_ENTRY}' > '${RUNTIME_LOG_PATH}' 2>&1 & fi"
sleep 4

NEW_COUNT=$(curl -s "${PROD_BASE_URL}/api/tasks" | python3 -c "import sys, json; raw = sys.stdin.read().strip(); payload = json.loads(raw) if raw else {}; print(len(payload) if isinstance(payload, list) else payload.get('total', len(payload.get('tasks', [])) if isinstance(payload.get('tasks'), list) else 0))" 2>/dev/null || echo "0")
NEW_COUNT=$(printf '%s' "${NEW_COUNT}" | tr -d '[:space:]')
log "Post-deploy: ${NEW_COUNT} tasks (was ${TASK_COUNT})"

if [[ ! "${NEW_COUNT}" =~ ^[0-9]+$ ]]; then
  error "Post-deploy task count was not numeric: ${NEW_COUNT}"
fi

if [[ "$NEW_COUNT" -lt "$TASK_COUNT" ]]; then
  error "TASK COUNT DROPPED from ${TASK_COUNT} to ${NEW_COUNT}!"
fi

log "Deploy complete: ${NEW_COUNT} tasks"
