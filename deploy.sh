#!/usr/bin/env bash
# Entity deploy script. Public-safe by default: SSH deployment requires explicit deploy config/env.
# Usage: ./deploy.sh [--server-only | --frontend-only | --all]
set -euo pipefail

export PATH=/opt/homebrew/bin:$PATH

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
CONFIG_FILE="${ENTITY_CONFIG:-${SCRIPT_DIR}/entity.config.yaml}"
PROFILE_FILE="${ENTITY_PROFILE_PATH:-}"
if [[ -z "${PROFILE_FILE}" && -n "${ENTITY_PROFILE:-}" ]]; then
  PROFILE_FILE="${SCRIPT_DIR}/config/profiles/${ENTITY_PROFILE}.yaml"
fi

read_config_value() {
  local key="$1"
  node --input-type=module - "$key" "$CONFIG_FILE" "$PROFILE_FILE" <<'NODE'
import fs from 'node:fs';
import YAML from 'yaml';
const [key, configFile, profileFile] = process.argv.slice(2);
function read(file) {
  if (!file || !fs.existsSync(file)) return {};
  return YAML.parse(fs.readFileSync(file, 'utf8')) || {};
}
function merge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b === undefined ? a : b;
  const out = { ...(a && typeof a === 'object' && !Array.isArray(a) ? a : {}) };
  for (const [k, v] of Object.entries(b)) out[k] = merge(out[k], v);
  return out;
}
const config = merge(read(profileFile), read(configFile));
const value = key.split('.').reduce((acc, part) => acc?.[part], config);
if (value !== undefined && value !== null) process.stdout.write(String(value));
NODE
}

DEPLOY_MODE="${ENTITY_DEPLOY_MODE:-$(read_config_value deploy.mode)}"
DEPLOY_MODE="${DEPLOY_MODE:-local}"
PROD_HOST="${ENTITY_PROD_HOST:-$(read_config_value deploy.sshTarget)}"
PROD_HTTP_HOST="${ENTITY_PROD_HTTP_HOST:-$(read_config_value deploy.httpHost)}"
ENTITY_DIR="${ENTITY_PROD_DIR:-$(read_config_value deploy.remoteDir)}"
SERVER_PORT="${ENTITY_SERVER_PORT:-$(read_config_value server.port)}"
WORKSPACE_ROOT="${ENTITY_WORKSPACE_ROOT:-$(read_config_value server.workspaceRoot)}"
LOG_PATH="${ENTITY_SERVER_LOG_PATH:-$(read_config_value server.logPath)}"
MAC_ENTITY_DIR="${ENTITY_SOURCE_DIR:-${SCRIPT_DIR}}"
RELEASE_CHECK_SCRIPT="${SCRIPT_DIR}/scripts/entity-release-check.sh"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)
SERVER_PORT="${SERVER_PORT:-3000}"
LOG_PATH="${LOG_PATH:-./logs/entity.log}"
PROD_DB="${ENTITY_PROD_DB:-${ENTITY_DIR:-}/packages/db/entity-tasks.db}"
SERVER_DIST="${ENTITY_DIR:-}/packages/server/dist"
FRONTEND_DIST="${ENTITY_DIR:-}/packages/app/dist"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

MODE="${1:---all}"
SKIP_MAC_BUILD="${ENTITY_SKIP_MAC_BUILD:-0}"

if [[ "${DEPLOY_MODE}" != "ssh" ]]; then
  error "deploy.mode=${DEPLOY_MODE}; SSH deploy requires explicit deploy.mode=ssh plus deploy.sshTarget/remoteDir/httpHost in entity.config.yaml/profile or ENTITY_PROD_* env vars"
fi
if [[ -z "${PROD_HOST}" || -z "${PROD_HTTP_HOST}" || -z "${ENTITY_DIR}" ]]; then
  error "missing deploy target. Set deploy.sshTarget, deploy.httpHost, deploy.remoteDir or ENTITY_PROD_HOST/ENTITY_PROD_HTTP_HOST/ENTITY_PROD_DIR"
fi
if [[ -z "${WORKSPACE_ROOT}" ]]; then
  error "missing server.workspaceRoot/ENTITY_WORKSPACE_ROOT for remote runtime"
fi

if [[ "${ENTITY_ALLOW_DIRTY_DEPLOY:-0}" != "1" ]]; then
  if [[ -x "${RELEASE_CHECK_SCRIPT}" ]]; then
    "${RELEASE_CHECK_SCRIPT}"
  else
    warn "Release safety check script not found at ${RELEASE_CHECK_SCRIPT}; continuing without it"
  fi
else
  warn "ENTITY_ALLOW_DIRTY_DEPLOY=1 set, skipping release safety checks"
fi

log "Pre-flight: checking production DB on ${PROD_HOST}..."
TASK_COUNT=$(ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "sqlite3 '${PROD_DB}' 'select count(*) from tasks;'" 2>/dev/null || echo "0")
TASK_COUNT=$(printf '%s' "${TASK_COUNT}" | tr -d '[:space:]')
log "Production DB has ${TASK_COUNT} tasks"

if [[ ! "${TASK_COUNT}" =~ ^[0-9]+$ ]]; then
  error "Production DB count was not numeric: ${TASK_COUNT}"
fi

if [ "$TASK_COUNT" -lt "${ENTITY_DEPLOY_MIN_TASKS:-10}" ]; then
  error "Production DB looks wrong (only ${TASK_COUNT} tasks). Aborting."
fi

BACKUP_TS=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${PROD_DB}.backup.${BACKUP_TS}"
log "Backing up production DB on gateway..."
ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; cp '${PROD_DB}' '${BACKUP_PATH}'; sqlite3 '${PROD_DB}' 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null; cp '${PROD_DB}' '${BACKUP_PATH}.post-checkpoint'"
log "Backed up DB to ${BACKUP_PATH} (${TASK_COUNT} tasks)"

if [[ "$MODE" == "--all" || "$MODE" == "--server-only" ]]; then
  if [[ "$SKIP_MAC_BUILD" == "1" ]]; then
    warn "Skipping DB + Server build because ENTITY_SKIP_MAC_BUILD=1"
  else
    log "Building DB + Server from source..."
    cd "${MAC_ENTITY_DIR}"
    npm --prefix packages/db run build
    npm --prefix packages/server run build
  fi
fi

if [[ "$MODE" == "--all" || "$MODE" == "--frontend-only" ]]; then
  if [[ "$SKIP_MAC_BUILD" == "1" ]]; then
    warn "Skipping frontend build because ENTITY_SKIP_MAC_BUILD=1"
  else
    log "Building Frontend from source..."
    cd "${MAC_ENTITY_DIR}"
    npm --prefix packages/app run build
  fi
fi

log "Syncing built files to ${PROD_HOST}:${ENTITY_DIR} (DB files EXCLUDED)..."

if [[ "$MODE" == "--all" || "$MODE" == "--server-only" ]]; then
  rsync -avz -e "ssh ${SSH_OPTS[*]}" --delete --exclude='*.db' --exclude='*.db-*' --exclude='*.db-shm' --exclude='*.db-wal' \
    "${MAC_ENTITY_DIR}/packages/server/src/plugins/" \
    "${PROD_HOST}:${ENTITY_DIR}/packages/server/src/plugins/"

  rsync -avz -e "ssh ${SSH_OPTS[*]}" --exclude='*.db' --exclude='*.db-*' --exclude='*.db-shm' --exclude='*.db-wal' \
    "${MAC_ENTITY_DIR}/packages/db/dist/" \
    "${PROD_HOST}:${ENTITY_DIR}/packages/db/dist/"

  rsync -avz -e "ssh ${SSH_OPTS[*]}" --exclude='db/' --exclude='app/' \
    "${MAC_ENTITY_DIR}/packages/server/dist/" \
    "${PROD_HOST}:${SERVER_DIST}/"

  ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; mkdir -p '${SERVER_DIST}/db/src'; cp ${ENTITY_DIR}/packages/db/dist/*.js '${SERVER_DIST}/db/src/'"
  log "Server synced (DB JS copied to server dist)"
fi

if [[ "$MODE" == "--all" || "$MODE" == "--frontend-only" ]]; then
  rsync -avz --delete -e "ssh ${SSH_OPTS[*]}" --exclude='*.db' \
    "${MAC_ENTITY_DIR}/packages/app/dist/" \
    "${PROD_HOST}:${FRONTEND_DIST}/"
  log "Frontend synced"
fi

if [ -f "${MAC_ENTITY_DIR}/MC-SOURCE.html" ]; then
  rsync -avz -e "ssh ${SSH_OPTS[*]}" "${MAC_ENTITY_DIR}/MC-SOURCE.html" "${PROD_HOST}:${ENTITY_DIR}/MC-SOURCE.html"
else
  warn "MC-SOURCE.html missing in source checkout; skipping sync"
fi

SYMLINK_TARGET=$(ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' '${SERVER_DIST}/db/entity-tasks.db' 2>/dev/null || echo NOT_A_SYMLINK")
if [ "$SYMLINK_TARGET" != "${PROD_DB}" ]; then
  warn "DB symlink was broken on remote. Fixing..."
  ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "rm -f '${SERVER_DIST}/db/entity-tasks.db' && ln -s '${PROD_DB}' '${SERVER_DIST}/db/entity-tasks.db'"
  log "Symlink restored: ${SERVER_DIST}/db/entity-tasks.db -> ${PROD_DB}"
fi

log "Restarting Entity server on remote..."
ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; UID_NUM=\$(id -u); if launchctl print \"gui/\${UID_NUM}/com.claw.entity-server\" >/dev/null 2>&1; then launchctl kickstart -k \"gui/\${UID_NUM}/com.claw.entity-server\"; else lsof -i :${SERVER_PORT} -t 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 2; cd '${ENTITY_DIR}' && mkdir -p \"\$(dirname '${LOG_PATH}')\" && PORT=${SERVER_PORT} WORKSPACE='${WORKSPACE_ROOT}' nohup node packages/server/dist/server/src/index.js > '${LOG_PATH}' 2>&1 & fi"
sleep 4

NEW_COUNT=$(curl -s "http://${PROD_HTTP_HOST}:${SERVER_PORT}/api/tasks" | python3 -c "
import sys, json
raw = sys.stdin.read().strip()
if not raw:
    print(0)
    raise SystemExit(0)
payload = json.loads(raw)
if isinstance(payload, list):
    print(len(payload))
elif isinstance(payload, dict):
    total = payload.get('total')
    if isinstance(total, int):
        print(total)
    elif isinstance(payload.get('tasks'), list):
        print(len(payload['tasks']))
    else:
        raise ValueError('tasks response did not contain an array or numeric total')
else:
    raise ValueError('tasks response was not a list or object')
" 2>/dev/null || echo "0")
NEW_COUNT=$(printf '%s' "${NEW_COUNT}" | tr -d '[:space:]')

log "Post-deploy: ${NEW_COUNT} tasks (was ${TASK_COUNT})"

if [[ ! "${NEW_COUNT}" =~ ^[0-9]+$ ]]; then
  error "Post-deploy task count was not numeric: ${NEW_COUNT}"
fi

if [ "$NEW_COUNT" -lt "$TASK_COUNT" ]; then
  error "TASK COUNT DROPPED from ${TASK_COUNT} to ${NEW_COUNT}! Check server logs."
fi

log "✅ Deploy complete! ${NEW_COUNT} tasks, server running on :${SERVER_PORT}"
