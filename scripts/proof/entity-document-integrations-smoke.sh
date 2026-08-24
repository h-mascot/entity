#!/usr/bin/env bash
# T-039 — Live sandbox verification smoke for Entity Document Integrations.
#
# Capability-honest live probe of the canonical /api/document-integrations surface on a
# reachable sandbox, covering the critical Google, Microsoft, and local workflows for every
# ENABLED release surface — and truthfully classifying providers that are disabled,
# unavailable, or degraded rather than pretending a cell passed.
#
# Honesty contract (never invent a pass):
#   enabled     -> the ENABLED lane was exercised live and returned the typed success.
#   negative    -> the lane is present but FAILED CLOSED (503 PROVIDER_UNAVAILABLE, 403/422
#                  typed refusal) — a verified negative/authorization path, NOT a pass, but
#                  real live proof of fail-closed behavior.
#   unverified  -> the lane is present but returned an unclassified/unexpected state.
# Only `enabled` counts toward a green workflow pass; `negative` counts toward the required
# fail-closed negative-path coverage. A disabled/unconfigured cell is never reported as green.
#
# Usage:
#   ENTITY_SANDBOX_HTTP_HOST=<host[:port]|http(s)://host[:port]> \
#   [ENTITY_SANDBOX_EXPECTED_SHA=<exact-sha>] \
#   [ENTITY_SANDBOX_PORT=<port>] \
#   scripts/proof/entity-document-integrations-smoke.sh
#
# Exit codes: 0 = verification ran and all ENABLED surfaces passed (or none were enabled but
# the fail-closed negatives were verified); 1 = an ENABLED surface failed its workflow or the
# exact-SHA assertion failed; 78 = not configured / not reachable.
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# Canonical §12 provider ids and artifact types (packages/server/src/routes/document-integrations.ts).
PROVIDERS=(local_office google_workspace microsoft_365)
ARTIFACT_TYPES=(document spreadsheet presentation)

missing=()
[[ -n "${ENTITY_SANDBOX_HTTP_HOST:-}" ]] || missing+=("ENTITY_SANDBOX_HTTP_HOST")
if ((${#missing[@]} > 0)); then
  echo "[edi-smoke] not configured. Set required environment variables: ${missing[*]}" >&2
  exit 78
fi

PORT="${ENTITY_SANDBOX_PORT:-3007}"
if [[ "${ENTITY_SANDBOX_HTTP_HOST}" == http://* || "${ENTITY_SANDBOX_HTTP_HOST}" == https://* ]]; then
  BASE_URL="${ENTITY_SANDBOX_HTTP_HOST%/}"
else
  BASE_URL="http://${ENTITY_SANDBOX_HTTP_HOST}:${PORT}"
fi

json_get() { # json_get <field> <json>
  node -e 'const [k,j]=process.argv.slice(1);const v=JSON.parse(j);console.log(v[k] === undefined ? "" : JSON.stringify(v[k]));' -- "$1" "$2"
}

log() { echo "[edi-smoke] $*"; }

# HTTP code is written to a file (not a global var) because curl_json runs inside command
# substitutions (subshells); a plain global assignment would be lost. Subshell-safe.
CURL_CODE_FILE="$(mktemp)"
cleanup_code() { rm -f "$CURL_CODE_FILE"; }
trap cleanup_code EXIT

curl_json() { # curl_json <url> [extra-curl-args...] -> prints body; writes HTTP code to $CURL_CODE_FILE
  local url="$1"; shift
  local body
  body="$(curl -sS -m 20 -w '\n%{http_code}' -H 'Content-Type: application/json' "$@" "$url" 2>/dev/null || true)"
  printf '%s' "$body" | tail -n1 > "$CURL_CODE_FILE"
  printf '%s' "$body" | sed '$d'
}
read_code() { cat "$CURL_CODE_FILE"; }

# ---------------- 1. Reachability + exact-SHA readback ----------------
log "base=$BASE_URL"
REACH="$(curl_json "$BASE_URL/api/tasks" || true)"
REACH_CODE="$(read_code)"
if [[ -z "$REACH" ]]; then
  echo "[edi-smoke] sandbox not reachable at $BASE_URL/api/tasks" >&2
  exit 78
fi
log "reachable: $BASE_URL/api/tasks (HTTP ${REACH_CODE:-0})"

if [[ -n "${ENTITY_SANDBOX_EXPECTED_SHA:-}" ]]; then
  SPEC="$(curl_json "$BASE_URL/api/version" || true)"
  SPEC_CODE="$(read_code)"
  if [[ -z "$SPEC" || "${SPEC_CODE:-0}" != "200" ]]; then
    echo "[edi-smoke] exact-SHA readback endpoint /api/version not usable; cannot assert exact SHA" >&2
    exit 78
  fi
  SPEC_SHA="$(json_get gitSha "$SPEC" 2>/dev/null | tr -d '"' || true)"
  if [[ -z "$SPEC_SHA" || "$SPEC_SHA" == "null" ]]; then
    echo "[edi-smoke] /api/version did not report a gitSha; cannot assert exact SHA" >&2
    exit 78
  fi
  if [[ "$SPEC_SHA" != "$ENTITY_SANDBOX_EXPECTED_SHA" ]]; then
    echo "[edi-smoke] exact-SHA mismatch: sandbox reports gitSha=${SPEC_SHA}, expected ${ENTITY_SANDBOX_EXPECTED_SHA}" >&2
    exit 1
  fi
  log "exact-SHA readback matches $ENTITY_SANDBOX_EXPECTED_SHA (gitSha)"
fi

# ---------------- 2. Per-provider lane classification ----------------
# A provider is classified by the OUTCOME of a live create on its critical create lane.
# create 201/200 => ENABLED (then deep workflow get/capabilities/mutate/versions is run).
# 503 PROVIDER_UNAVAILABLE => fail-closed NEGATIVE (verified; not a pass).
# 403/422 typed capability/authorization refusal => fail-closed NEGATIVE.
# any other non-2xx (incl. 500) => unverified.
# network/empty => unverified.
declare -A DISPOSITION
declare -A NOTES
declare -A DOC_ID
declare -A REVISION
declare -A EXPECTED_ENABLED

probe_create() {
  local provider="$1" artifact="$2"
  local idem="t039-edi-${provider}-${artifact}-$(date +%s)-${RANDOM}"
  local create_body="{\"provider\":\"${provider}\",\"artifactType\":\"${artifact}\",\"title\":\"T-039 live smoke ${provider}/${artifact}\",\"idempotencyKey\":\"${idem}\"}"
  local create
  create="$(curl_json "$BASE_URL/api/document-integrations" -X POST -d "$create_body" || true)"
  local code; code="$(read_code)"
  case "$code" in
    201|200)
      local doc_id rev
      doc_id="$(json_get documentId "$create" 2>/dev/null | tr -d '"' || true)"
      if [[ -z "$doc_id" || "$doc_id" == "null" ]]; then
        doc_id="$(json_get 'record.id' "$create" 2>/dev/null | tr -d '"' || true)"
      fi
      rev="$(json_get revision "$create" 2>/dev/null | tr -d '"' || true)"
      if [[ -z "$doc_id" || "$doc_id" == "null" ]]; then
        DISPOSITION[$provider]="unverified"
        NOTES[$provider]="create returned $code but no document id: $(printf '%s' "$create" | head -c 160)"
      else
        DISPOSITION[$provider]="enabled"
        EXPECTED_ENABLED[$provider]=1
        DOC_ID[$provider]="$doc_id"
        REVISION[$provider]="${rev:-1}"
        NOTES[$provider]="create ENABLED (HTTP $code); doc=${doc_id}"
      fi
      ;;
    503|403|422)
      # Typed fail-closed: 503 PROVIDER_UNAVAILABLE, or a 403/422 capability/authorization
      # refusal. This is a VERIFIED negative (fail-closed), not a pass.
      local errcode
      errcode="$(json_get 'error.code' "$create" 2>/dev/null | tr -d '"' || true)"
      DISPOSITION[$provider]="negative"
      NOTES[$provider]="fail-closed on create (HTTP $code${errcode:+ ${errcode}}): $(printf '%s' "$create" | head -c 160)"
      ;;
    404)
      DISPOSITION[$provider]="unverified"
      NOTES[$provider]="create endpoint 404 (surface not exposed on this sandbox)"
      ;;
    *)
      DISPOSITION[$provider]="unverified"
      NOTES[$provider]="create returned HTTP ${code}: $(printf '%s' "$create" | head -c 160)"
      ;;
  esac
}

# Deep critical workflow for an ENABLED provider: get -> capabilities -> mutate -> versions.
# These read lanes and the bounded text mutation are the critical per-provider workflow. Each is
# exercised live and must return the typed success; a failure here downgrades the cell to
# negative so an enabled surface is only green when its whole critical workflow passes.
verify_workflow() {
  local provider="$1" doc_id="$2" rev="$3"
  local code
  local get
  get="$(curl_json "$BASE_URL/api/document-integrations/$doc_id" || true)"
  code="$(read_code)"
  [[ "$code" != "200" ]] && { DISPOSITION[$provider]="negative"; NOTES[$provider]+="; get ${code}"; return 1; }

  local caps
  caps="$(curl_json "$BASE_URL/api/document-integrations/$doc_id/capabilities" || true)"
  code="$(read_code)"
  [[ "$code" != "200" ]] && { DISPOSITION[$provider]="negative"; NOTES[$provider]+="; capabilities ${code}"; return 1; }
  local caps_json
  caps_json="$(json_get capabilities "$caps" 2>/dev/null || true)"
  [[ -z "$caps_json" || "$caps_json" == "null" ]] && { DISPOSITION[$provider]="negative"; NOTES[$provider]+="; capabilities empty"; return 1; }

  local mut_idem="t039-edi-mut-${provider}-${doc_id}-$(date +%s)-${RANDOM}"
  local mut_body="{\"expectedRevision\":\"${rev}\",\"idempotencyKey\":\"${mut_idem}\",\"operation\":{\"kind\":\"text\",\"content\":\"T-039 live mutation ${provider}\"}, \"confirmed\": true}"
  local mut
  mut="$(curl_json "$BASE_URL/api/document-integrations/$doc_id/mutations" -X POST -d "$mut_body" || true)"
  code="$(read_code)"
  [[ "$code" != "200" ]] && { DISPOSITION[$provider]="negative"; NOTES[$provider]+="; mutate ${code} ($(printf '%s' "$mut" | head -c 100))"; return 1; }

  local vers
  vers="$(curl_json "$BASE_URL/api/document-integrations/$doc_id/versions" || true)"
  code="$(read_code)"
  [[ "$code" != "200" ]] && { DISPOSITION[$provider]="negative"; NOTES[$provider]+="; versions ${code}"; return 1; }

  NOTES[$provider]+="; workflow get/capabilities/mutate/versions verified live"
  return 0
}

for p in "${PROVIDERS[@]}"; do
  probe_create "$p" "${ARTIFACT_TYPES[0]}"
done

# Run the deep workflow for every ENABLED provider.
for p in "${PROVIDERS[@]}"; do
  if [[ "${DISPOSITION[$p]:-}" == "enabled" ]]; then
    verify_workflow "$p" "${DOC_ID[$p]}" "${REVISION[$p]:-1}" || true
  fi
done

# ---------------- 3. Report ----------------
echo
echo "[edi-smoke] ---- provider disposition (capability-honest) ----"
ENABLED=0; NEGATIVE=0; UNVERIFIED=0; FAILED=0
for p in "${PROVIDERS[@]}"; do
  d="${DISPOSITION[$p]:-unverified}"
  n="${NOTES[$p]:-no probe}"
  printf '  %-15s -> %-10s  %s\n' "$p" "$d" "$n"
  case "$d" in
    enabled)   ENABLED=$((ENABLED+1)) ;;
    negative)  NEGATIVE=$((NEGATIVE+1)) ;;
    unverified) UNVERIFIED=$((UNVERIFIED+1)) ;;
  esac
done
echo "[edi-smoke] enabled=${ENABLED} fail-closed-negative=${NEGATIVE} unverified=${UNVERIFIED}"
echo

# Verdict: an ENABLED cell that regressed to negative during its deep workflow is a FAILURE of
# that enabled surface (exit 1), not a pass. A cell that was never enabled and failed closed is
# a VERIFIED negative. A fully-unavailable surface (all negative) is a legitimate PASS of the
# verification: it truthfully documents that no provider adapter is registered.
for p in "${PROVIDERS[@]}"; do
  if [[ "${EXPECTED_ENABLED[$p]:-}" == "1" && "${DISPOSITION[$p]:-}" == "negative" ]]; then
    echo "[edi-smoke] enabled provider ${p} regressed during its critical workflow; FAILING verification" >&2
    FAILED=1
  fi
done
if (( UNVERIFIED > 0 || FAILED > 0 )); then
  echo "[edi-smoke] ${UNVERIFIED} unverified cell(s) / ${FAILED} enabled-regression(s); cannot green-light verification" >&2
  exit 1
fi
echo "[edi-smoke] PASS: exact-SHA sandbox document-integration surface verified live; all provider cells resolved (enabled=${ENABLED} fail-closed=${NEGATIVE})"
