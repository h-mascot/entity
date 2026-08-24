#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

missing=()
[[ -n "${ENTITY_SANDBOX_HTTP_HOST:-}" ]] || missing+=("ENTITY_SANDBOX_HTTP_HOST")
if ((${#missing[@]} > 0)); then
  echo "[entity-sandbox] verify is not configured. Set required environment variables: ${missing[*]}" >&2
  exit 78
fi

SANDBOX_PORT="${ENTITY_SANDBOX_PORT:-3007}"
if [[ "${ENTITY_SANDBOX_HTTP_HOST}" == http://* || "${ENTITY_SANDBOX_HTTP_HOST}" == https://* ]]; then
  SANDBOX_BASE_URL="${ENTITY_SANDBOX_HTTP_HOST%/}"
else
  SANDBOX_BASE_URL="http://${ENTITY_SANDBOX_HTTP_HOST}:${SANDBOX_PORT}"
fi

cd "$ROOT"
CTRL_LIVE_BASE_URL="$SANDBOX_BASE_URL" npm run test:live

# T-039 — Live sandbox verification of Entity Document Integrations against the exact release
# SHA. Probes the canonical /api/document-integrations surface capability-honestly for the
# critical Google (google_workspace), Microsoft (microsoft_365), and local (local_office)
# workflows. It classifies each provider as enabled / fail-closed-negative / unverified and
# never claims a disabled or unconfigured cell passed. When the exact candidate SHA is known
# (deploy exports ENTITY_RELEASE_SHA, or the caller pins ENTITY_SANDBOX_EXPECTED_SHA) it is
# asserted against /api/version so verification is provably "against the exact SHA".
EXPECTED_SHA="${ENTITY_SANDBOX_EXPECTED_SHA:-${ENTITY_RELEASE_SHA:-}}"
if [[ -n "$EXPECTED_SHA" ]]; then
  ENTITY_SANDBOX_EXPECTED_SHA="$EXPECTED_SHA" bash "$ROOT/scripts/proof/entity-document-integrations-smoke.sh"
else
  echo "[entity-sandbox] ENTITY_SANDBOX_EXPECTED_SHA not set; running document-integrations smoke without an exact-SHA pin (report gitSha readback only)." >&2
  bash "$ROOT/scripts/proof/entity-document-integrations-smoke.sh"
fi
