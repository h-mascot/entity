#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"
CONFIG_FILE="${ENTITY_CONFIG:-${REPO_ROOT}/entity.config.yaml}"
PROFILE_FILE="${ENTITY_PROFILE_PATH:-}"
if [[ -z "${PROFILE_FILE}" && -n "${ENTITY_PROFILE:-}" ]]; then
  PROFILE_FILE="${REPO_ROOT}/config/profiles/${ENTITY_PROFILE}.yaml"
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
SERVER_PORT="${SERVER_PORT:-3000}"
PROD_DB="${ENTITY_PROD_DB:-${ENTITY_DIR:-}/packages/db/entity-tasks.db}"
SERVER_DIST="${ENTITY_DIR:-}/packages/server/dist"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new)
MIN_TASKS="${CTRL_DEPLOY_MIN_TASKS:-10}"

fail() {
  echo "[ctrl-deploy] $*" >&2
  exit 1
}

cd "${REPO_ROOT}"

bash -n deploy.sh
bash -n scripts/entity-release-check.sh

if [[ "${DEPLOY_MODE}" != "ssh" ]]; then
  echo "[ctrl-deploy] skipped live deploy path check: deploy.mode=${DEPLOY_MODE}. Set an explicit ssh deploy profile/env for Enterprise gate."
  exit 0
fi
if [[ -z "${PROD_HOST}" || -z "${PROD_HTTP_HOST}" || -z "${ENTITY_DIR}" ]]; then
  fail "missing deploy target. Set deploy.sshTarget, deploy.httpHost, deploy.remoteDir or ENTITY_PROD_* env vars"
fi

REMOTE_COUNT="$(ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "set -euo pipefail; test -d '${ENTITY_DIR}'; test -f '${PROD_DB}'; sqlite3 '${PROD_DB}' 'select count(*) from tasks;'" 2>/dev/null || true)"
REMOTE_COUNT="$(printf '%s' "${REMOTE_COUNT}" | tr -d '[:space:]')"
if [[ ! "${REMOTE_COUNT}" =~ ^[0-9]+$ ]]; then
  fail "production DB count was not numeric: ${REMOTE_COUNT:-<empty>}"
fi
if (( REMOTE_COUNT < MIN_TASKS )); then
  fail "production DB has only ${REMOTE_COUNT} task(s), expected at least ${MIN_TASKS}"
fi

EXPECTED_DB_REALPATH="$(ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' '${PROD_DB}' 2>/dev/null || true")"
SYMLINK_TARGET="$(ssh "${SSH_OPTS[@]}" "${PROD_HOST}" "python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' '${SERVER_DIST}/db/entity-tasks.db' 2>/dev/null || true")"
if [[ -z "${EXPECTED_DB_REALPATH}" ]]; then
  fail "could not resolve production DB realpath for ${PROD_DB}"
fi
if [[ "${SYMLINK_TARGET}" != "${EXPECTED_DB_REALPATH}" ]]; then
  fail "server dist DB symlink resolves to ${SYMLINK_TARGET:-<missing>}, expected ${EXPECTED_DB_REALPATH}"
fi

HTTP_COUNT="$(curl -fsS "http://${PROD_HTTP_HOST}:${SERVER_PORT}/api/tasks" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
if isinstance(payload, list):
    print(len(payload))
else:
    print(payload.get("total", len(payload.get("tasks", []))))
')"
HTTP_COUNT="$(printf '%s' "${HTTP_COUNT}" | tr -d '[:space:]')"
if [[ ! "${HTTP_COUNT}" =~ ^[0-9]+$ ]]; then
  fail "live API task count was not numeric: ${HTTP_COUNT:-<empty>}"
fi
if (( HTTP_COUNT < MIN_TASKS )); then
  fail "live API returned only ${HTTP_COUNT} task(s), expected at least ${MIN_TASKS}"
fi

echo "[ctrl-deploy] ok: ${PROD_HOST} DB=${REMOTE_COUNT} task(s), live API=${HTTP_COUNT} task(s), DB symlink intact"
