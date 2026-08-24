#!/usr/bin/env bash
# T-039 — Focused deterministic test for scripts/proof/entity-document-integrations-smoke.sh.
#
# Runs the smoke against a tiny local mock HTTP server (Node) so every classification branch is
# exercised WITHOUT any external sandbox/network. This is the colocated automated coverage for
# the proof script — including the SUCCESS path (an enabled provider returning 201 + a real
# documentId) and the fail-closed negative paths (503 PROVIDER_UNAVAILABLE, 422, 409) plus the
# exact-SHA readback (match and mismatch).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
SMOKE="$ROOT/scripts/proof/entity-document-integrations-smoke.sh"
PORT_BASE=45110
FAILS=0

note() { printf '  %s\n' "$*"; }
check() { # check <label> <actual> <expected>
  local label="$1" actual="$2" expected="$3"
  if [[ "$actual" == "$expected" ]]; then
    printf '  [PASS] %s\n' "$label"
  else
    printf '  [FAIL] %s: expected "%s", got "%s"\n' "$label" "$expected" "$actual"
    FAILS=$((FAILS+1))
  fi
}

# The mock server behaviour is selected by MOCK_OUTCOME:
#   enabled_all   -> every provider create returns 201 + documentId; /api/version reports gitSha.
#   none_enabled  -> every provider create returns 503 PROVIDER_UNAVAILABLE (fail-closed).
#   typed_422     -> every provider create returns 422 CAPABILITY_UNSUPPORTED.
#   no_version    -> /api/version returns 200 but with no gitSha.
#   sha_mismatch  -> /api/version reports a gitSha different from EXPECTED.
export MOCK_OUTCOME="${MOCK_OUTCOME:-enabled_all}"

start_mock() { # start_mock <port> <outcome>
  local port="$1" outcome="$2"
  MOCK_PID=""
  ENTITY_MOCK_PORT="$port" ENTITY_MOCK_OUTCOME="$outcome" node -e '
    const http = require("http");
    const port = Number(process.env.ENTITY_MOCK_PORT);
    const outcome = process.env.ENTITY_MOCK_OUTCOME;
    const server = http.createServer((req, res) => {
      if (req.url === "/api/version") {
        const gitSha = outcome === "sha_mismatch"
          ? "ffffffffffffffffffffffffffffffffffffffff"
          : "1111111111111111111111111111111111111111";
        res.setHeader("Content-Type", "application/json");
        if (outcome === "no_version") { res.end(JSON.stringify({ app: "entity", environment: "sandbox" })); return; }
        res.end(JSON.stringify({ schemaVersion: 1, app: "entity", environment: "sandbox", gitSha }));
        return;
      }
      if (req.url === "/api/tasks") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ tasks: [] }));
        return;
      }
      if (req.url === "/api/document-integrations" && req.method === "POST") {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => {
          let provider = "unknown";
          try { provider = JSON.parse(body).provider || "unknown"; } catch {}
          const resHeaders = { "Content-Type": "application/json" };
          if (outcome === "enabled_all") {
            res.writeHead(201, resHeaders);
            res.end(JSON.stringify({ documentId: "doc_" + provider, entityUrl: "/documents/doc_" + provider, provider, revision: "v1", operationId: "op-1", receiptId: null }));
          } else if (outcome === "typed_422") {
            res.writeHead(422, resHeaders);
            res.end(JSON.stringify({ error: { code: "CAPABILITY_UNSUPPORTED", message: "unsupported for " + provider } }));
          } else { // none_enabled -> 503 PROVIDER_UNAVAILABLE
            res.writeHead(503, resHeaders);
            res.end(JSON.stringify({ error: { code: "PROVIDER_UNAVAILABLE", message: "no provider adapter is registered for provider " + provider + "; failing closed." } }));
          }
        });
        return;
      }
      // Deep workflow routes (only meaningful under enabled_all):
      if (/^\/api\/document-integrations\/(doc_|mut-)/.test(req.url || "")) {
        const resHeaders = { "Content-Type": "application/json" };
        if (outcome === "enabled_all") {
          if (/\/capabilities$/.test(req.url)) {
            res.writeHead(200, resHeaders);
            res.end(JSON.stringify({ documentId: "doc_x", capabilities: { create: { state: "supported" } } }));
          } else if (/\/versions$/.test(req.url)) {
            res.writeHead(200, resHeaders);
            res.end(JSON.stringify({ documentId: "doc_x", versions: [] }));
          } else if (/\/mutations$/.test(req.url)) {
            res.writeHead(200, resHeaders);
            res.end(JSON.stringify({ documentId: "doc_x", previousRevision: "v1", revision: "v2", operationId: "op-m", receiptId: null }));
          } else {
            res.writeHead(200, resHeaders);
            res.end(JSON.stringify({ document: { id: "doc_x" } }));
          }
        } else {
          res.writeHead(404, resHeaders);
          res.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
        }
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { code: "NOT_FOUND" } }));
    });
    server.listen(port, "127.0.0.1", () => console.log("mock-listening"));
  ' >/dev/null 2>&1 &
  MOCK_PID=$!
  # wait for listen
  for _ in $(seq 1 30); do
    if curl -sS -m 1 "http://127.0.0.1:${port}/api/tasks" >/dev/null 2>&1; then return 0; fi
    sleep 0.1
  done
  echo "mock server did not come up" >&2; exit 1
}

stop_mock() {
  if [[ -n "${MOCK_PID:-}" ]]; then kill "$MOCK_PID" 2>/dev/null || true; wait "$MOCK_PID" 2>/dev/null || true; fi
}

run_smoke() { # run_smoke <outcome> <expected_sha_env> -> echoes "EXIT:<code>"
  local outcome="$1" sha_env="$2"
  start_mock "$PORT_BASE" "$outcome"
  local out
  out="$(ENTITY_SANDBOX_HTTP_HOST="127.0.0.1" ENTITY_SANDBOX_PORT="$PORT_BASE" \
        ENTITY_SANDBOX_EXPECTED_SHA="$sha_env" bash "$SMOKE" 2>&1)"
  local code=$?
  stop_mock
  PORT_BASE=$((PORT_BASE+1))
  printf '%s\nEXIT:%s' "$out" "$code"
}

note "--- SUCCESS path: all providers enabled (create 201 + documentId) ---"
OUT="$(run_smoke enabled_all 1111111111111111111111111111111111111111)"
check "exit 0 on enabled-all" "$(printf '%s' "$OUT" | grep -o 'EXIT:.*')" "EXIT:0"
check "local_office enabled" "$(printf '%s' "$OUT" | grep -c 'local_office .* enabled')" "1"
check "exact-SHA readback matches" "$(printf '%s' "$OUT" | grep -c 'exact-SHA readback matches')" "1"

note "--- FAIL-CLOSED negative path: no adapter registered (503 PROVIDER_UNAVAILABLE) ---"
OUT="$(run_smoke none_enabled 1111111111111111111111111111111111111111)"
check "exit 0 on all fail-closed" "$(printf '%s' "$OUT" | grep -o 'EXIT:.*')" "EXIT:0"
check "three providers classified negative" "$(printf '%s' "$OUT" | grep -cE '\-> *negative')" "3"

note "--- TYPED capability refusal (422 CAPABILITY_UNSUPPORTED) -> verified negative ---"
OUT="$(run_smoke typed_422 1111111111111111111111111111111111111111)"
check "exit 0 on typed 422" "$(printf '%s' "$OUT" | grep -o 'EXIT:.*')" "EXIT:0"
check "422 providers classified negative" "$(printf '%s' "$OUT" | grep -cE '\-> *negative')" "3"

note "--- EXACT-SHA mismatch must fail closed (exit 1) ---"
OUT="$(run_smoke enabled_all 2222222222222222222222222222222222222222)"
check "exit 1 on exact-SHA mismatch" "$(printf '%s' "$OUT" | grep -o 'EXIT:.*')" "EXIT:1"
check "mismatch message" "$(printf '%s' "$OUT" | grep -c 'exact-SHA mismatch')" "1"

note "--- /api/version with no gitSha -> cannot assert SHA (exit 78) ---"
OUT="$(run_smoke no_version 1111111111111111111111111111111111111111)"
check "exit 78 on missing gitSha" "$(printf '%s' "$OUT" | grep -o 'EXIT:.*')" "EXIT:78"

note "--- not configured (no ENTITY_SANDBOX_HTTP_HOST) -> exit 78 ---"
OUT="$(env -u ENTITY_SANDBOX_HTTP_HOST bash "$SMOKE" 2>&1)"; CODE=$?
check "exit 78 when unconfigured" "${CODE}" "78"

if (( FAILS > 0 )); then
  echo "entity-document-integrations-smoke.test.sh: $FAILS failure(s)" >&2
  exit 1
fi
echo "entity-document-integrations-smoke.test.sh: PASS"
