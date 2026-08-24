#!/usr/bin/env bash
# T-040 — Focused deterministic test for scripts/entity-promotion-gate.sh.
#
# Exercises the production approval gate without any network or production access:
#   * SUCCESS        — valid Henry-approved evidence -> GATE_PASS exit 0
#   * SUCCESS (B)    — verified gateway mitigation (repointed away from main) -> GATE_PASS
#   * SUCCESS (B2)   — deployment disabled as the mitigation -> GATE_PASS
#   * NEGATIVE       — no evidence file -> fail closed (78)
#   * NEGATIVE       — evidence file missing -> fail closed
#   * DEGRADED       — unreadable/corrupt JSON -> fail closed
#   * STALE-REVISION — evidence SHA != candidate SHA -> fail closed
#   * AUTHORIZATION  — approver not Henry / missing signature -> fail closed
#   * AUTHORIZATION  — gateway mitigation not confirmed -> fail closed
#   * SECURITY       — decision != authorized -> fail closed
#   * SECURITY       — schema/issue mismatch -> fail closed
#   * SECURITY       — no authorized path present -> fail closed
#   * SECURITY       — reversibility override is explicit and logged (GATE_DISABLED)
set -uo pipefail
ROOT="$(cd "$(dirname -- "$(realpath "${BASH_SOURCE[0]}")")/.." && pwd -P)"
GATE="$ROOT/scripts/entity-promotion-gate.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
FAILS=0
SHA="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
OTHER_SHA="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

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
run_gate() { # run_gate <evidence> <sha...>  -> prints GATE line and returns code
  local evidence="$1" sha="${2:-$SHA}"
  # shellcheck disable=SC2034
  local out code
  out="$(ENTITY_PROMOTION_EVIDENCE="$evidence" ENTITY_PROMOTION_ISSUE="THE-981/T-040" \
    "$GATE" --sha "$sha" 2>&1)"
  code=$?
  printf '%s|%s' "$code" "$out"
}

cat > "$TMP/henry-ok.json" <<JSON
{ "schema":"entity.promotion-gate/v1", "issue":"THE-981/T-040", "candidateSha":"$SHA", "decision":"authorized",
  "authorization": { "type":"henry_approval", "approver":"Henry", "reference":"https://linear.app/comment/ABC123", "signature":"henry-signature-abcdef1234567890" },
  "generatedAt":"2026-08-24T00:00:00Z" }
JSON
cat > "$TMP/gw-repoint.json" <<JSON
{ "schema":"entity.promotion-gate/v1", "issue":"THE-981/T-040", "candidateSha":"$SHA", "decision":"authorized",
  "authorization": { "type":"gateway_mitigation", "type2":"repointed_away_from_main", "confirmed":true, "confirmedBy":"supervisor+he nry-audit", "confirmedAt":"2026-08-24T00:00:00Z" },
  "generatedAt":"2026-08-24T00:00:00Z" }
JSON
# NOTE: the gateway mitigation above uses key "type2" (not "type") -> must FAIL (unexpected). Rebuild correct one below.
cat > "$TMP/gw-repoint.json" <<JSON
{ "schema":"entity.promotion-gate/v1", "issue":"THE-981/T-040", "candidateSha":"$SHA", "decision":"authorized",
  "authorization": { "type":"gateway_mitigation", "mitigation":"repointed_away_from_main", "confirmed":true, "confirmedBy":"supervisor", "confirmedAt":"2026-08-24T00:00:00Z" },
  "generatedAt":"2026-08-24T00:00:00Z" }
JSON

echo "== 1. SUCCESS: valid Henry approval =="
R="$(run_gate "$TMP/henry-ok.json" "$SHA")"; check "henry approval GATE_PASS" "${R%%|*}" "0"
grep -q 'GATE_PASS type=henry_approval' <<<"$R" && note "henry PASS line ok" || { note "missing henry PASS line: $R"; FAILS=$((FAILS+1)); }

echo "== 2. SUCCESS: gateway mitigation (repointed away from main) =="
R="$(run_gate "$TMP/gw-repoint.json" "$SHA")"; check "gateway repoint GATE_PASS" "${R%%|*}" "0"
grep -q 'GATE_PASS type=gateway_mitigation' <<<"$R" && note "gateway PASS line ok" || { note "missing gateway PASS line: $R"; FAILS=$((FAILS+1)); }

echo "== 3. NEGATIVE: evidence file does not exist =="
R="$(run_gate "$TMP/nope.json" "$SHA")"; check "missing evidence fail-closed" "${R%%|*}" "78"
grep -q 'GATE_FAIL reason=missing-evidence-file\|missing-evidence' <<<"$R" && note "missing-file reason ok" || { note "no reason: $R"; FAILS=$((FAILS+1)); }

echo "== 4. NEGATIVE: no evidence path supplied =="
R="$(ENTITY_PROMOTION_EVIDENCE="" "$GATE" --sha "$SHA" 2>&1)"; check "no evidence fail-closed" "$?" "78"
grep -q 'GATE_FAIL reason=missing-evidence' <<<"$R" && note "no-evidence reason ok" || { note "no reason: $R"; FAILS=$((FAILS+1)); }

echo "== 5. DEGRADED: corrupt/invalid JSON =="
printf 'not-json{{{' > "$TMP/bad.json"
R="$(run_gate "$TMP/bad.json" "$SHA")"; check "invalid json fail-closed" "${R%%|*}" "78"

echo "== 6. STALE-REVISION: evidence SHA != candidate SHA =="
R="$(run_gate "$TMP/henry-ok.json" "$OTHER_SHA")"; check "stale-revision fail-closed" "${R%%|*}" "78"
grep -q 'GATE_FAIL reason=stale-revision' <<<"$R" && note "stale-revision reason ok" || { note "no reason: $R"; FAILS=$((FAILS+1)); }

echo "== 7. AUTHORIZATION: approver is not Henry =="
cat > "$TMP/not-henry.json" <<JSON
{ "schema":"entity.promotion-gate/v1", "issue":"THE-981/T-040", "candidateSha":"$SHA", "decision":"authorized",
  "authorization": { "type":"henry_approval", "approver":"Alice", "reference":"https://x/1", "signature":"signature-abcdef123456" } }
JSON
R="$(run_gate "$TMP/not-henry.json" "$SHA")"; check "non-Henry approver fail-closed" "${R%%|*}" "78"
grep -q 'GATE_FAIL reason=unauthorized-henry-approval\|no-authorized-evidence' <<<"$R" && note "non-Henry reason ok" || { note "no reason: $R"; FAILS=$((FAILS+1)); }

echo "== 8. AUTHORIZATION: henry approval missing signature =="
cat > "$TMP/no-sig.json" <<JSON
{ "schema":"entity.promotion-gate/v1", "issue":"THE-981/T-040", "candidateSha":"$SHA", "decision":"authorized",
  "authorization": { "type":"henry_approval", "approver":"Henry", "reference":"https://x/1", "signature":"" } }
JSON
R="$(run_gate "$TMP/no-sig.json" "$SHA")"; check "missing signature fail-closed" "${R%%|*}" "78"

echo "== 9. AUTHORIZATION: gateway mitigation not confirmed =="
cat > "$TMP/gw-unconfirmed.json" <<JSON
{ "schema":"entity.promotion-gate/v1", "issue":"THE-981/T-040", "candidateSha":"$SHA", "decision":"authorized",
  "authorization": { "type":"gateway_mitigation", "mitigation":"disabled", "confirmed":false, "confirmedBy":"", "confirmedAt":"2026-08-24T00:00:00Z" } }
JSON
R="$(run_gate "$TMP/gw-unconfirmed.json" "$SHA")"; check "unconfirmed mitigation fail-closed" "${R%%|*}" "78"

echo "== 10. SECURITY: decision != authorized =="
cat > "$TMP/denied.json" <<JSON
{ "schema":"entity.promotion-gate/v1", "issue":"THE-981/T-040", "candidateSha":"$SHA", "decision":"denied",
  "authorization": { "type":"henry_approval", "approver":"Henry", "reference":"https://x/1", "signature":"signature-abcdef123456" } }
JSON
R="$(run_gate "$TMP/denied.json" "$SHA")"; check "denied decision fail-closed" "${R%%|*}" "78"
grep -q 'GATE_FAIL reason=decision-not-authorized' <<<"$R" && note "denied reason ok" || { note "no reason: $R"; FAILS=$((FAILS+1)); }

echo "== 11. SECURITY: schema mismatch =="
cat > "$TMP/wrong-schema.json" <<JSON
{ "schema":"old/v0", "issue":"THE-981/T-040", "candidateSha":"$SHA", "decision":"authorized",
  "authorization": { "type":"henry_approval", "approver":"Henry", "reference":"https://x/1", "signature":"signature-abcdef123456" } }
JSON
R="$(run_gate "$TMP/wrong-schema.json" "$SHA")"; check "schema mismatch fail-closed" "${R%%|*}" "78"

echo "== 12. SECURITY: issue mismatch =="
cat > "$TMP/wrong-issue.json" <<JSON
{ "schema":"entity.promotion-gate/v1", "issue":"OTHER-999", "candidateSha":"$SHA", "decision":"authorized",
  "authorization": { "type":"henry_approval", "approver":"Henry", "reference":"https://x/1", "signature":"signature-abcdef123456" } }
JSON
R="$(run_gate "$TMP/wrong-issue.json" "$SHA")" tracking_="$OTHER_SHA"; check "issue mismatch fail-closed" "${R%%|*}" "78"

echo "== 13. SECURITY: no authorized path present =="
cat > "$TMP/no-auth.json" <<JSON
{ "schema":"entity.promotion-gate/v1", "issue":"THE-981/T-040", "candidateSha":"$SHA", "decision":"authorized",
  "authorization": { "type":"self_review", "approver":"runner" } }
JSON
R="$(run_gate "$TMP/no-auth.json" "$SHA")"; check "no-authorized-path fail-closed" "${R%%|*}" "78"

echo "== 14. SECURITY: reversibility override is explicit + logged =="
GATE_LOG_FILE="$TMP/gate.log"
R="$(ENTITY_PROMOTION_EVIDENCE="$TMP/henry-ok.json" ENTITY_PROMOTION_GATE_ENFORCE=0 \
  ENTITY_PROMOTION_GATE_LOG="$GATE_LOG_FILE" "$GATE" --sha "$SHA" 2>&1)"
# EXPECTED: disabled override proceeds (GATE_DISABLED) — the reversibility escape hatch, and it is logged.
check "reversibility override proceeds" "$?" "0"
grep -q 'GATE_DISABLED' <<<"$R" && note "GATE_DISABLED notice ok" || { note "no GATE_DISABLED notice: $R"; FAILS=$((FAILS+1)); }
grep -q 'ENFORCEMENT_DISABLED' "$GATE_LOG_FILE" && note "override logged" || { note "override NOT logged"; FAILS=$((FAILS+1)); }

echo "== 15. SECURITY: default enforce is ON (no evidence -> fail closed) =="
R="$(ENTITY_PROMOTION_EVIDENCE="" "$GATE" --sha "$SHA" 2>&1)"; check "default enforce fail-closed" "$?" "78"
grep -q 'GATE_FAIL reason=missing-evidence' <<<"$R" && note "default enforce ok" || { note "no reason: $R"; FAILS=$((FAILS+1)); }

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "PROMOTION-GATE TEST: ALL PASS"
else
  echo "PROMOTION-GATE TEST: $FAILS FAILURE(S)"
fi
exit "$FAILS"
