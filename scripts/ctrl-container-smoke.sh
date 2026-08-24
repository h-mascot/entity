#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
cd "$ROOT"

if [[ "${ENTITY_CONTAINER_ALLOW_DIRTY:-0}" != "1" ]] && [[ -n "$(git status --porcelain)" ]]; then
  echo "[container-smoke] refusing dirty source; commit/stash first" >&2
  exit 78
fi

SHA="$(git rev-parse HEAD)"
BRANCH="$(git branch --show-current)"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]]
IMAGE="entity-curacel-smoke:${SHA}"
NAME="entity-curacel-smoke-${$}"
DATA_VOLUME="${NAME}-data"
WORKSPACE_VOLUME="${NAME}-workspace"
PORT="${ENTITY_CONTAINER_SMOKE_PORT:-3310}"
API_TOKEN="$(openssl rand -hex 32)"
DOC_TOKEN="$(openssl rand -hex 32)"
CUSTOMER_TOKEN="ect_$(openssl rand -hex 32)"
BASIC_USER="curacel-smoke"
BASIC_PASSWORD="$(openssl rand -hex 18)"

cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker volume rm "$DATA_VOLUME" "$WORKSPACE_VOLUME" >/dev/null 2>&1 || true
  rm -f /tmp/entity-container-create-${$}.json
}
trap cleanup EXIT
cleanup

docker build \
  --build-arg "SOURCE_COMMIT=${SHA}" \
  --build-arg "ENTITY_RELEASE_BRANCH=${BRANCH:-detached}" \
  --tag "$IMAGE" \
  . >/dev/null

BASIC_HASH="$(docker run --rm --entrypoint caddy "$IMAGE" hash-password --plaintext "$BASIC_PASSWORD")"
docker volume create "$DATA_VOLUME" >/dev/null
docker volume create "$WORKSPACE_VOLUME" >/dev/null

start_container() {
  docker run -d --name "$NAME" \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --tmpfs /tmp:size=256m,mode=1777 \
    -p "127.0.0.1:${PORT}:8080" \
    -v "$DATA_VOLUME:/data" \
    -v "$WORKSPACE_VOLUME:/workspace" \
    -e "ENTITY_API_TOKEN=${API_TOKEN}" \
    -e "ENTITY_DEFAULT_DOCUMENTS_TOKEN=${DOC_TOKEN}" \
    -e "ENTITY_CUSTOMER_ACCESS_TOKEN=${CUSTOMER_TOKEN}" \
    -e "ENTITY_BASIC_AUTH_USER=${BASIC_USER}" \
    -e "ENTITY_BASIC_AUTH_HASH=${BASIC_HASH}" \
    -e ENTITY_WORKSPACE_ORG_ID=curacel \
    -e ENTITY_WORKSPACE_TEAM_ID=pilot \
    -e ENTITY_API_PRINCIPAL_ID=curacel-deployment-admin \
    "$IMAGE" >/dev/null

  for _ in $(seq 1 60); do
    local health
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$NAME")"
    [[ "$health" == "healthy" ]] && return 0
    if [[ "$health" == "unhealthy" ]]; then
      docker logs --tail 100 "$NAME" >&2
      return 1
    fi
    sleep 2
  done
  docker logs --tail 100 "$NAME" >&2
  return 1
}

basic_curl=(curl -fsS --user "${BASIC_USER}:${BASIC_PASSWORD}")
start_container

UNAUTH_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/")"
[[ "$UNAUTH_CODE" == "401" ]]

ROOT_CODE="$("${basic_curl[@]}" -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/")"
[[ "$ROOT_CODE" == "200" ]]

HEALTH="$("${basic_curl[@]}" "http://127.0.0.1:${PORT}/api/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).status))')"
[[ "$HEALTH" == "ok" ]]

VERSION="$("${basic_curl[@]}" "http://127.0.0.1:${PORT}/api/version" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).gitSha))')"
[[ "$VERSION" == "$SHA" ]]

EDITOR_ENABLED="$("${basic_curl[@]}" "http://127.0.0.1:${PORT}/api/runtime" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Boolean(JSON.parse(s).agentNativeEditorEnabled)))')"
[[ "$EDITOR_ENABLED" == "false" ]]

CREATE_CODE="$("${basic_curl[@]}" \
  -o "/tmp/entity-container-create-${$}.json" \
  -w '%{http_code}' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Container persistence proof","description":"Container smoke evidence.","column":"todo","assignee":"Curacel Ops","org_id":"curacel","team_id":"pilot","created_by_principal_id":"curacel-pilot-service","initiator_principal_id":"curacel-pilot-service","initiator_type":"system","owner_principal_id":"curacel-pilot-service","owner_principal_type":"system","assignment_state":"unassigned","worktype":"general","risk_level":"low","agent_trust_level":"standard"}' \
  "http://127.0.0.1:${PORT}/api/tasks")"
[[ "$CREATE_CODE" == "201" ]]

COUNT_BEFORE="$("${basic_curl[@]}" "http://127.0.0.1:${PORT}/api/tasks" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);console.log(Array.isArray(x)?x.length:(x.total??x.tasks?.length??0))})')"
[[ "$COUNT_BEFORE" -ge 1 ]]

# Prove native runtime modules load in final pruned image.
docker exec "$NAME" node -e "require('better-sqlite3'); require('node-pty');" >/dev/null

# Prove WebSocket upgrade survives the Basic Auth proxy and injected bearer.
ENTITY_WS_URL="ws://127.0.0.1:${PORT}/ws" \
ENTITY_WS_BASIC="$(printf '%s:%s' "$BASIC_USER" "$BASIC_PASSWORD" | base64)" \
node - <<'NODE'
const WebSocket = require('ws');
const ws = new WebSocket(process.env.ENTITY_WS_URL, {
  headers: { Authorization: `Basic ${process.env.ENTITY_WS_BASIC}` },
});
const timer = setTimeout(() => { console.error('websocket timeout'); process.exit(1); }, 5000);
ws.once('open', () => { clearTimeout(timer); ws.close(); });
ws.once('close', () => process.exit(0));
ws.once('error', (error) => { clearTimeout(timer); console.error(error.message); process.exit(1); });
NODE

docker stop --time 15 "$NAME" >/dev/null
docker rm "$NAME" >/dev/null
start_container

COUNT_AFTER="$("${basic_curl[@]}" "http://127.0.0.1:${PORT}/api/tasks" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s);console.log(Array.isArray(x)?x.length:(x.total??x.tasks?.length??0))})')"
[[ "$COUNT_AFTER" == "$COUNT_BEFORE" ]]

RUN_USER="$(docker inspect --format '{{.Config.User}}' "$NAME")"
[[ "$RUN_USER" == "node" ]]

printf '[container-smoke] passed sha=%s health=%s root=%s unauth=%s tasks=%s restart=%s user=%s\n' \
  "$SHA" "$HEALTH" "$ROOT_CODE" "$UNAUTH_CODE" "$COUNT_BEFORE" "$COUNT_AFTER" "$RUN_USER"
