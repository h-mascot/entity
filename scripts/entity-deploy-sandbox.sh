#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

missing=()
[[ -n "${ENTITY_SANDBOX_HOST:-}" ]] || missing+=("ENTITY_SANDBOX_HOST")
[[ -n "${ENTITY_SANDBOX_HTTP_HOST:-}" ]] || missing+=("ENTITY_SANDBOX_HTTP_HOST")
[[ -n "${ENTITY_SANDBOX_DIR:-}" ]] || missing+=("ENTITY_SANDBOX_DIR")
[[ -n "${ENTITY_SANDBOX_DB:-}" ]] || missing+=("ENTITY_SANDBOX_DB")
if ((${#missing[@]} > 0)); then
  echo "[entity-sandbox] deploy is not configured. Set required environment variables: ${missing[*]}" >&2
  exit 78
fi

# REC-003 immutable-release safety: refuse the unsafe symlink profiles up front.
# ENTITY_SANDBOX_DIR must never point at the `current`/`previous` symlinks: a
# deploy through them rsyncs straight into an existing release directory and
# mutates it in place (historical sandbox identity corruption). Target the
# exact-SHA release directory instead; deploy.sh independently re-verifies the
# destination identity on the remote host.
SANDBOX_DIR_BASENAME="$(basename -- "${ENTITY_SANDBOX_DIR}")"
if [[ "${SANDBOX_DIR_BASENAME}" == "current" || "${SANDBOX_DIR_BASENAME}" == "previous" ]]; then
  echo "[entity-sandbox] ENTITY_SANDBOX_DIR must not point at the '${SANDBOX_DIR_BASENAME}' symlink (${ENTITY_SANDBOX_DIR}). Set it to the fresh exact-SHA release directory so a deploy can never mutate an existing immutable release." >&2
  exit 78
fi

export ENTITY_PROD_HOST="${ENTITY_SANDBOX_HOST}"
export ENTITY_PROD_HTTP_HOST="${ENTITY_SANDBOX_HTTP_HOST}"
export ENTITY_PROD_PORT="${ENTITY_SANDBOX_PORT:-3007}"
export ENTITY_PROD_DIR="${ENTITY_SANDBOX_DIR}"
export ENTITY_PROD_DB="${ENTITY_SANDBOX_DB}"
export ENTITY_PROD_CONFIG_PATH="${ENTITY_SANDBOX_CONFIG_PATH:-$(dirname -- "${ENTITY_SANDBOX_DIR}")/entity.config.yaml}"
export ENTITY_PROD_LOG_PATH="${ENTITY_SANDBOX_LOG_PATH:-/tmp/entity-sandbox.log}"
export ENTITY_PROD_LAUNCHD_SERVICE="${ENTITY_SANDBOX_LAUNCHD_SERVICE:-}"
export ENTITY_RUNTIME_WORKSPACE="${ENTITY_SANDBOX_WORKSPACE:-}"

if [[ "$ENTITY_PROD_HTTP_HOST" == http://* || "$ENTITY_PROD_HTTP_HOST" == https://* ]]; then
  SANDBOX_BASE_URL="${ENTITY_PROD_HTTP_HOST%/}"
else
  SANDBOX_BASE_URL="http://${ENTITY_PROD_HTTP_HOST}:${ENTITY_PROD_PORT}"
fi
export ENTITY_PUBLIC_BASE_URL="${ENTITY_PUBLIC_BASE_URL:-$SANDBOX_BASE_URL}"
export ENTITY_CLOUD_API_BASE="${ENTITY_CLOUD_API_BASE:-$SANDBOX_BASE_URL}"
export VITE_ENTITY_API_BASE="${VITE_ENTITY_API_BASE:-$SANDBOX_BASE_URL}"
export VITE_MC_ORIGIN="${VITE_MC_ORIGIN:-$SANDBOX_BASE_URL}"
if [[ "$SANDBOX_BASE_URL" == https://* ]]; then
  export VITE_ENTITY_WS_URL="${VITE_ENTITY_WS_URL:-wss://${SANDBOX_BASE_URL#https://}}"
else
  export VITE_ENTITY_WS_URL="${VITE_ENTITY_WS_URL:-ws://${SANDBOX_BASE_URL#http://}}"
fi

cd "$ROOT"

# T-038 exact-SHA release proof (R-039): the sandbox must deploy and report the
# exact reviewed candidate SHA. deploy.sh already fails closed when
# ENTITY_RELEASE_SHA != source checkout HEAD; we resolve and export it so the
# deploy path cannot silently accept a drifted tree.
if [[ -z "${ENTITY_RELEASE_SHA:-}" ]]; then
  export ENTITY_RELEASE_SHA="$(git -C "$ROOT" rev-parse HEAD)"
fi
export ENTITY_RELEASE_ENVIRONMENT="${ENTITY_RELEASE_ENVIRONMENT:-sandbox}"

npm run docs:wiki:verify
./deploy.sh --all

# Read back the deployed release identity and prove, fail-closed, that the
# sandbox reports exactly the reviewed candidate SHA. Any drift between the
# candidate SHA and the deployed RELEASE.json/VERSION aborts before live checks.
EXACT_SHA_READBACK_DIR="$(mktemp -d)"
cleanup_exact_sha_readback() {
  rm -rf "${EXACT_SHA_READBACK_DIR}"
}
trap cleanup_exact_sha_readback EXIT
scp -q "${ENTITY_SANDBOX_HOST}:${ENTITY_SANDBOX_DIR}/RELEASE.json" "${EXACT_SHA_READBACK_DIR}/RELEASE.json"
scp -q "${ENTITY_SANDBOX_HOST}:${ENTITY_SANDBOX_DIR}/VERSION" "${EXACT_SHA_READBACK_DIR}/VERSION"
node "${ROOT}/scripts/entity-release-info.mjs" --check \
  --root "${EXACT_SHA_READBACK_DIR}" \
  --expected "${ENTITY_RELEASE_SHA}"
echo "[entity-sandbox] exact-SHA readback verified: sandbox reports ${ENTITY_RELEASE_SHA}"

if [[ "$ENTITY_PROD_HTTP_HOST" == http://* || "$ENTITY_PROD_HTTP_HOST" == https://* ]]; then
  SANDBOX_BASE_URL="${ENTITY_PROD_HTTP_HOST%/}"
else
  SANDBOX_BASE_URL="http://${ENTITY_PROD_HTTP_HOST}:${ENTITY_PROD_PORT}"
fi
CTRL_LIVE_BASE_URL="$SANDBOX_BASE_URL" npm run test:live
