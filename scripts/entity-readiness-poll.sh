#!/usr/bin/env bash
# Bounded post-restart readiness poll for the live /api/tasks contract.
#
# deploy.sh restarts the server without a fixed sleep because a normal startup may
# take longer than a naive pause, and a crash-loop must surface as a real
# ready-timeout rather than a false task-count failure.
#
# Readiness contract: the server is ready only when /api/tasks returns a NUMERIC
# task count that is AT LEAST the preflight TASK_COUNT. A numeric response alone
# (e.g. 0 while the configured 49-task DB is still hydrating) is NOT readiness,
# and must not abort as a false "TASK COUNT DROPPED". We keep polling until the
# count is numeric AND >= the preflight expectation, and fail closed (non-zero
# exit, after the bounded attempt window) on a persistent crash, a count that
# never reaches the preflight value, or a deadline expiry. This is the exact
# behaviour deploy.sh needs, kept here so it is deterministically testable.
#
# Usage: entity-readiness-poll.sh <base-url> <preflight-task-count>
#   base-url             the origin (e.g. http://sandbox:3000) to poll /api/tasks on
#   preflight-task-count the numeric task count taken from the preflight DB check
# Environment: ENTITY_DEPLOY_READY_ATTEMPTS (default 20) bounds total polls.
# Prints the ready numeric task count on stdout on success; fails closed otherwise.
set -euo pipefail

BASE_URL="${1:-}"
EXPECTED="${2:-}"

if [[ -z "${BASE_URL}" ]]; then
  echo "[readiness] missing base URL" >&2
  exit 2
fi
if [[ ! "${EXPECTED}" =~ ^[0-9]+$ ]]; then
  echo "[readiness] preflight task count is not numeric: ${EXPECTED}" >&2
  exit 2
fi

ATTEMPTS="${ENTITY_DEPLOY_READY_ATTEMPTS:-20}"
if [[ ! "${ATTEMPTS}" =~ ^[0-9]+$ || "${ATTEMPTS}" -lt 1 ]]; then
  echo "[readiness] attempts must be a positive integer: ${ATTEMPTS}" >&2
  exit 2
fi

latest=""
saw_numeric=""
max_seen=-1
for attempt in $(seq 1 "${ATTEMPTS}"); do
  count=""
  count="$(curl --noproxy "*" -sS --max-time 5 "${BASE_URL}/api/tasks" 2>/dev/null \
    | python3 -c "import sys, json; raw = sys.stdin.read().strip(); payload = json.loads(raw) if raw else {}; print(len(payload) if isinstance(payload, list) else payload.get('total', len(payload.get('tasks', [])) if isinstance(payload.get('tasks'), list) else 0))" \
    2>/dev/null || echo "")"
  count="$(printf '%s' "${count}" | tr -d '[:space:]')"

  if [[ "${count}" =~ ^[0-9]+$ ]]; then
    saw_numeric="1"
    latest="${count}"
    if (( count > max_seen )); then
      max_seen="${count}"
    fi
    if (( count >= EXPECTED )); then
      printf '%s\n' "${count}"
      exit 0
    fi
  fi

  if [[ "$attempt" -lt "${ATTEMPTS}" ]]; then
    sleep 2
  fi
done

# Fail closed with a truthful reason rather than a false task-count claim.
if [[ -n "${saw_numeric}" ]]; then
  echo "[readiness] server never reported >= ${EXPECTED} tasks within ${ATTEMPTS} attempts (max ${max_seen}); failing closed" >&2
else
  echo "[readiness] server never became ready with a numeric task count within ${ATTEMPTS} attempts; failing closed" >&2
fi
exit 1
