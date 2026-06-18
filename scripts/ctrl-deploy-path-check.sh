#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd -P)"

PROD_HOST="${ENTITY_PROD_HOST:-}"
PROD_HTTP_HOST="${ENTITY_PROD_HTTP_HOST:-}"
PROD_PORT="${ENTITY_PROD_PORT:-3000}"
ENTITY_DIR="${ENTITY_PROD_DIR:-}"
PROD_DB="${ENTITY_PROD_DB:-}"
SERVER_DIST="${ENTITY_DIR}/packages/server/dist"
SSH_OPTS=(-o BatchMode=yes -o ConnectTimeout=8 -o StrictHostKeyChecking=accept-new)
MIN_TASKS="${CTRL_DEPLOY_MIN_TASKS:-10}"

fail() {
  echo "[ctrl-deploy] $*" >&2
  exit 1
}

cd "${REPO_ROOT}"

bash -n deploy.sh
bash -n scripts/entity-release-check.sh

missing=()
[[ -n "${PROD_HOST}" ]] || missing+=("ENTITY_PROD_HOST")
[[ -n "${PROD_HTTP_HOST}" ]] || missing+=("ENTITY_PROD_HTTP_HOST")
[[ -n "${ENTITY_DIR}" ]] || missing+=("ENTITY_PROD_DIR")
[[ -n "${PROD_DB}" ]] || missing+=("ENTITY_PROD_DB")
if ((${#missing[@]} > 0)); then
  fail "deploy path check is not configured. Set required environment variables: ${missing[*]}"
fi

if [[ "${PROD_HTTP_HOST}" == http://* || "${PROD_HTTP_HOST}" == https://* ]]; then
  PROD_BASE_URL="${PROD_HTTP_HOST%/}"
else
  PROD_BASE_URL="http://${PROD_HTTP_HOST}:${PROD_PORT}"
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

HTTP_COUNT="$(curl -fsS "${PROD_BASE_URL}/api/tasks" | python3 -c '
import json
import sys

payload = json.load(sys.stdin)
if isinstance(payload, list):
    print(len(payload))
else:
    # /api/tasks may be paginated; compare against total count, not page size.
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
