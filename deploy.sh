#!/usr/bin/env bash
# Entity Safe Deploy Script
# Builds from Mac source-of-truth, deploys to ada-gateway WITHOUT touching the DB
# Usage: ./deploy.sh [--server-only | --frontend-only | --all]
set -euo pipefail

export PATH=/opt/homebrew/bin:$PATH

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"

PROD_HOST="${ENTITY_PROD_HOST:-enterprise@100.104.229.62}"
PROD_HTTP_HOST="${ENTITY_PROD_HTTP_HOST:-100.104.229.62}"
ENTITY_DIR="${ENTITY_PROD_DIR:-/Users/enterprise/Services/entity}"
MAC_ENTITY_DIR="${ENTITY_SOURCE_DIR:-${SCRIPT_DIR}}"
RELEASE_CHECK_SCRIPT="${SCRIPT_DIR}/scripts/entity-release-check.sh"
SSH_OPTS=(-o BatchMode=yes -o StrictHostKeyChecking=accept-new)
PROD_DB="${ENTITY_DIR}/packages/db/entity-tasks.db"
SERVER_DIST="${ENTITY_DIR}/packages/server/dist"
FRONTEND_DIST="${ENTITY_DIR}/packages/app/dist"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

MODE="${1:---all}"
SKIP_MAC_BUILD="${ENTITY_SKIP_MAC_BUILD:-0}"

if [[ "${ENTITY_ALLOW_DIRTY_DEPLOY:-0}" != "1" ]]; then
  if [[ -x "${RELEASE_CHECK_SCRIPT}" ]]; then
    "${RELEASE_CHECK_SCRIPT}"
  else
    warn "Release safety check script not found at ${RELEASE_CHECK_SCRIPT}; continuing without it"
  fi
else
  warn "ENTITY_ALLOW_DIRTY_DEPLOY=1 set, skipping release safety checks"
fi


# ============================================================
# STEP 0: Pre-flight checks on production host
# ============================================================
log "Pre-flight: checking production DB on ${PROD_HOST}..."
TASK_COUNT=$(ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "sqlite3 '${PROD_DB}' 'select count(*) from tasks;'" 2>/dev/null || echo "0")
TASK_COUNT=$(printf '%s' "${TASK_COUNT}" | tr -d '[:space:]')
log "Production DB has ${TASK_COUNT} tasks"

if [[ ! "${TASK_COUNT}" =~ ^[0-9]+$ ]]; then
  error "Production DB count was not numeric: ${TASK_COUNT}"
fi

if [ "$TASK_COUNT" -lt 10 ]; then
  error "Production DB looks wrong (only ${TASK_COUNT} tasks). Aborting."
fi

# ============================================================
# STEP 1: Backup production DB on gateway (always, before any deploy)
# ============================================================
BACKUP_TS=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${PROD_DB}.backup.${BACKUP_TS}"
log "Backing up production DB on gateway..."
ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; cp '${PROD_DB}' '${BACKUP_PATH}'; sqlite3 '${PROD_DB}' 'PRAGMA wal_checkpoint(TRUNCATE);' >/dev/null; cp '${PROD_DB}' '${BACKUP_PATH}.post-checkpoint'"
log "Backed up DB to ${BACKUP_PATH} (${TASK_COUNT} tasks)"

# ============================================================
# STEP 2: Build on Mac source-of-truth
# ============================================================
if [[ "$MODE" == "--all" || "$MODE" == "--server-only" ]]; then
  if [[ "$SKIP_MAC_BUILD" == "1" ]]; then
    warn "Skipping Mac DB + Server build because ENTITY_SKIP_MAC_BUILD=1"
  else
    log "Building DB + Server on Mac source-of-truth..."
    cd "${MAC_ENTITY_DIR}"
    npm --prefix packages/db run build
    npm --prefix packages/server run build
  fi
fi

if [[ "$MODE" == "--all" || "$MODE" == "--frontend-only" ]]; then
  if [[ "$SKIP_MAC_BUILD" == "1" ]]; then
    warn "Skipping Mac frontend build because ENTITY_SKIP_MAC_BUILD=1"
  else
    log "Building Frontend on Mac source-of-truth..."
    cd "${MAC_ENTITY_DIR}"
    npm --prefix packages/app run build
  fi
fi

# ============================================================
# STEP 3: Sync from Mac to gateway (EXCLUDING all .db files)
# ============================================================
log "Syncing built files from Mac to gateway (DB files EXCLUDED)..."

# Sync plugin source manifests/routes so runtime plugin discovery sees newly added plugins
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
  warn "MC-SOURCE.html missing on Mac source-of-truth; skipping sync"
fi

# ============================================================
# STEP 4: Verify symlink is intact on gateway
# ============================================================
SYMLINK_TARGET=$(ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "readlink -f '${SERVER_DIST}/db/entity-tasks.db' 2>/dev/null || echo NOT_A_SYMLINK")
if [ "$SYMLINK_TARGET" != "${PROD_DB}" ]; then
  warn "DB symlink was broken on gateway. Fixing..."
  ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "rm -f '${SERVER_DIST}/db/entity-tasks.db' && ln -s '${PROD_DB}' '${SERVER_DIST}/db/entity-tasks.db'"
  log "Symlink restored: ${SERVER_DIST}/db/entity-tasks.db -> ${PROD_DB}"
fi

# ============================================================
# STEP 5: Restart server on gateway
# ============================================================
log "Restarting Entity server on gateway..."
ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; UID_NUM=\$(id -u); if launchctl print \"gui/\${UID_NUM}/com.claw.entity-server\" >/dev/null 2>&1; then launchctl kickstart -k \"gui/\${UID_NUM}/com.claw.entity-server\"; else lsof -i :3000 -t 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 2; cd '${ENTITY_DIR}' && PORT=3000 WORKSPACE=/Users/enterprise/clawd nohup node packages/server/dist/server/src/index.js > /tmp/entity-server.log 2>&1 & fi"
sleep 4

# ============================================================
# STEP 6: Post-deploy verification
# ============================================================
NEW_COUNT=$(curl -s "http://${PROD_HTTP_HOST}:3000/api/tasks" | python3 -c "
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

log "✅ Deploy complete! ${NEW_COUNT} tasks, server running on :3000"
