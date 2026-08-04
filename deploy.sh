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
REMOTE_NODE_BIN="${ENTITY_REMOTE_NODE_BIN:-}"
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

[[ -x "${RELEASE_CHECK_SCRIPT}" ]] || error "Required release safety check is missing or not executable: ${RELEASE_CHECK_SCRIPT}"
[[ -d "${MAC_ENTITY_DIR}" ]] || error "Configured source checkout does not exist: ${MAC_ENTITY_DIR}"
SOURCE_ROOT="$(git -C "${MAC_ENTITY_DIR}" rev-parse --show-toplevel 2>/dev/null)" || error "Configured source is not a git checkout: ${MAC_ENTITY_DIR}"
SOURCE_DIR_REAL="$(cd "${MAC_ENTITY_DIR}" && pwd -P)"
SOURCE_ROOT_REAL="$(cd "${SOURCE_ROOT}" && pwd -P)"
[[ "${SOURCE_DIR_REAL}" == "${SOURCE_ROOT_REAL}" ]] || error "ENTITY_SOURCE_DIR must be the exact checkout root: configured ${SOURCE_DIR_REAL}, git root ${SOURCE_ROOT_REAL}"
SOURCE_SHA="$(git -C "${MAC_ENTITY_DIR}" rev-parse HEAD 2>/dev/null)" || error "Cannot determine source SHA: ${MAC_ENTITY_DIR}"
SOURCE_BRANCH="$(git -C "${MAC_ENTITY_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null)" || error "Cannot determine source branch: ${MAC_ENTITY_DIR}"
if [[ -n "${RELEASE_SHA}" && "${RELEASE_SHA}" != "${SOURCE_SHA}" ]]; then
  error "ENTITY_RELEASE_SHA ${RELEASE_SHA} does not match configured source checkout ${SOURCE_SHA}"
fi
if [[ "${SOURCE_BRANCH}" == "HEAD" ]]; then
  [[ -n "${RELEASE_BRANCH}" ]] || error "Detached source checkout requires ENTITY_RELEASE_BRANCH for truthful release identity"
  git check-ref-format --branch "${RELEASE_BRANCH}" >/dev/null 2>&1 || error "Invalid ENTITY_RELEASE_BRANCH: ${RELEASE_BRANCH}"
  RELEASE_BRANCH_SHA="$(git -C "${MAC_ENTITY_DIR}" rev-parse --verify "refs/remotes/origin/${RELEASE_BRANCH}^{commit}" 2>/dev/null || git -C "${MAC_ENTITY_DIR}" rev-parse --verify "refs/heads/${RELEASE_BRANCH}^{commit}" 2>/dev/null)" || error "Detached source SHA ${SOURCE_SHA} cannot be resolved at branch ${RELEASE_BRANCH}"
  [[ "${RELEASE_BRANCH_SHA}" == "${SOURCE_SHA}" ]] || error "Detached source SHA ${SOURCE_SHA} does not match branch ${RELEASE_BRANCH} tip ${RELEASE_BRANCH_SHA}"
else
  if [[ -n "${RELEASE_BRANCH}" && "${RELEASE_BRANCH}" != "${SOURCE_BRANCH}" ]]; then
    error "ENTITY_RELEASE_BRANCH ${RELEASE_BRANCH} does not match configured source branch ${SOURCE_BRANCH}"
  fi
  RELEASE_BRANCH="${SOURCE_BRANCH}"
fi
RELEASE_SHA="${SOURCE_SHA}"
"${RELEASE_CHECK_SCRIPT}" "${MAC_ENTITY_DIR}"
log "Verifying generated OpenWiki documentation against exact deploy source..."
(cd "${MAC_ENTITY_DIR}" && npm run docs:wiki:verify) || error "OpenWiki verification failed for ${MAC_ENTITY_DIR}"
if [[ -z "${REMOTE_NODE_BIN}" ]]; then
  REMOTE_NODE_BIN="$(ssh "${SSH_OPTS[@]}" "${PROD_HOST}" 'for candidate in /opt/homebrew/opt/node@22/bin/node /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do if [ -x "$candidate" ]; then printf "%s\n" "$candidate"; exit 0; fi; done; command -v node')" || error "Could not resolve Node.js on remote target ${PROD_HOST}"
fi
[[ -n "${REMOTE_NODE_BIN}" ]] || error "Remote Node.js path is empty for ${PROD_HOST}"
[[ "${REMOTE_NODE_BIN}" =~ ^/[A-Za-z0-9._/+@-]+$ ]] || error "Remote Node.js path contains unsupported characters: ${REMOTE_NODE_BIN}"
[[ "${ENTITY_DIR}" =~ ^/[A-Za-z0-9._/+@-]+$ ]] || error "Remote Entity path contains unsupported characters: ${ENTITY_DIR}"
REMOTE_NODE_VERSION="$(ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "'${REMOTE_NODE_BIN}' --version" 2>/dev/null)" || error "Remote Node.js preflight failed for ${REMOTE_NODE_BIN} on ${PROD_HOST}"
[[ "${REMOTE_NODE_VERSION}" =~ ^v([0-9]+)(\.[0-9]+){2}$ ]] || error "Remote Node.js preflight returned an invalid version from ${REMOTE_NODE_BIN}: ${REMOTE_NODE_VERSION}"
(( BASH_REMATCH[1] >= 20 )) || error "Remote Node.js ${REMOTE_NODE_VERSION} is unsupported; Entity requires Node 20 or newer"

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
ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; mkdir -p '${ENTITY_DIR}/packages/server/src/plugins' '${ENTITY_DIR}/packages/db/dist' '${SERVER_DIST}' '${FRONTEND_DIST}' '${ENTITY_DIR}/openwiki' '${ENTITY_DIR}/scripts'"
if [[ "$MODE" == "--all" || "$MODE" == "--server-only" ]]; then
  rsync -avz -e "ssh ${SSH_OPTS[*]}" --delete --exclude='*.db' --exclude='*.db-*' --exclude='*.db-shm' --exclude='*.db-wal' "${MAC_ENTITY_DIR}/packages/server/src/plugins/" "${PROD_HOST}:${ENTITY_DIR}/packages/server/src/plugins/"
  rsync -avz -e "ssh ${SSH_OPTS[*]}" --exclude='*.db' --exclude='*.db-*' --exclude='*.db-shm' --exclude='*.db-wal' "${MAC_ENTITY_DIR}/packages/db/dist/" "${PROD_HOST}:${ENTITY_DIR}/packages/db/dist/"
  rsync -avz -e "ssh ${SSH_OPTS[*]}" --exclude='db/' --exclude='app/' "${MAC_ENTITY_DIR}/packages/server/dist/" "${PROD_HOST}:${SERVER_DIST}/"
  ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; mkdir -p '${SERVER_DIST}/db/src'; cp '${ENTITY_DIR}'/packages/db/dist/*.js '${SERVER_DIST}/db/src/'"
fi

if [[ "$MODE" == "--all" || "$MODE" == "--frontend-only" ]]; then
  rsync -avz --delete -e "ssh ${SSH_OPTS[*]}" --exclude='*.db' --exclude='*.db-*' --exclude='*.db-shm' --exclude='*.db-wal' "${MAC_ENTITY_DIR}/packages/app/dist/" "${PROD_HOST}:${FRONTEND_DIST}/"
fi

log "Syncing generated OpenWiki documentation and release metadata writer."
rsync -avz --delete -e "ssh ${SSH_OPTS[*]}" "${MAC_ENTITY_DIR}/openwiki/" "${PROD_HOST}:${ENTITY_DIR}/openwiki/"
rsync -avz -e "ssh ${SSH_OPTS[*]}" "${MAC_ENTITY_DIR}/scripts/entity-release-info.mjs" "${MAC_ENTITY_DIR}/scripts/entity-release-info-stdin.mjs" "${PROD_HOST}:${ENTITY_DIR}/scripts/"

if [[ -n "$RELEASE_SHA" ]]; then
  log "Syncing runtime dependencies into immutable release..."
  rsync -az --delete -e "ssh ${SSH_OPTS[*]}"     --exclude='.cache/'     --exclude='*.log'     "${MAC_ENTITY_DIR}/node_modules/" "${PROD_HOST}:${ENTITY_DIR}/node_modules/"
fi

SYMLINK_TARGET=$(ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' '${SERVER_DIST}/db/entity-tasks.db' 2>/dev/null || echo NOT_A_SYMLINK")
if [[ "$SYMLINK_TARGET" != "$PROD_DB" ]]; then
  warn "DB symlink was broken. Restoring explicit configured DB target."
  ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "rm -f '${SERVER_DIST}/db/entity-tasks.db' && ln -s '${PROD_DB}' '${SERVER_DIST}/db/entity-tasks.db'"
fi

log "Writing server runtime .env for configured TTS providers..."
RUNTIME_ENV_TMP=$(mktemp)
cleanup_runtime_env() {
  if [[ -n "${RUNTIME_ENV_TMP:-}" ]]; then
    rm -f "${RUNTIME_ENV_TMP}"
  fi
}
trap cleanup_runtime_env EXIT
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
cleanup_runtime_env
RUNTIME_ENV_TMP=""
trap - EXIT

if [[ -n "$RELEASE_SHA" ]]; then
  log "Writing release identity metadata for ${RELEASE_SHA} on ${PROD_HOST}..."
  RELEASE_METADATA_PAYLOAD="$(python3 - "${ENTITY_DIR}" "${RELEASE_SHA}" "${RELEASE_BRANCH}" "${RELEASE_ENVIRONMENT}" <<'PY'
import json
import sys
root, sha, branch, environment = sys.argv[1:]
print(json.dumps({
    "script": f"{root}/scripts/entity-release-info.mjs",
    "root": root,
    "sha": sha,
    "branch": branch,
    "environment": environment,
}))
PY
)"
  printf '%s' "${RELEASE_METADATA_PAYLOAD}" | ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "'${REMOTE_NODE_BIN}' '${ENTITY_DIR}/scripts/entity-release-info-stdin.mjs'" >/dev/null
fi

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

ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; UID_NUM=\$(id -u); if [[ -n '${RUNTIME_LAUNCHD_SERVICE}' ]] && launchctl print \"gui/\${UID_NUM}/${RUNTIME_LAUNCHD_SERVICE}\" >/dev/null 2>&1; then launchctl kickstart -k \"gui/\${UID_NUM}/${RUNTIME_LAUNCHD_SERVICE}\"; else lsof -i :'${PROD_PORT}' -t 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 2; mkdir -p \"\$(dirname '${RUNTIME_LOG_PATH}')\"; cd '${ENTITY_DIR}' && ${REMOTE_ENV} nohup '${REMOTE_NODE_BIN}' '${RUNTIME_NODE_ENTRY}' > '${RUNTIME_LOG_PATH}' 2>&1 & fi"
sleep 4

NEW_COUNT=$(curl --noproxy "*" -sS "${PROD_BASE_URL}/api/tasks" | python3 -c "import sys, json; raw = sys.stdin.read().strip(); payload = json.loads(raw) if raw else {}; print(len(payload) if isinstance(payload, list) else payload.get('total', len(payload.get('tasks', [])) if isinstance(payload.get('tasks'), list) else 0))" 2>/dev/null || echo "0")
NEW_COUNT=$(printf '%s' "${NEW_COUNT}" | tr -d '[:space:]')
log "Post-deploy: ${NEW_COUNT} tasks (was ${TASK_COUNT})"

if [[ ! "${NEW_COUNT}" =~ ^[0-9]+$ ]]; then
  error "Post-deploy task count was not numeric: ${NEW_COUNT}"
fi

if [[ "$NEW_COUNT" -lt "$TASK_COUNT" ]]; then
  error "TASK COUNT DROPPED from ${TASK_COUNT} to ${NEW_COUNT}!"
fi

log "Deploy complete: ${NEW_COUNT} tasks"
