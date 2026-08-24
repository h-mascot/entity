#!/usr/bin/env bash
# T-040 — Production promotion approval gate (fail-closed).
#
# This is the audited, evidence-backed approval gate for `npm run promote:prod`.
# Production promotion is authorized ONLY when an explicit, validated promotion
# evidence record authorizes it:
#
#   (A) Henry's explicit approval, OR
#   (B) verified gateway-deployer mitigation (deployer DISABLED or REPOINTED away
#       from main), recorded before any merge to main.
#
# The gate fails closed (exit 78, no deploy) on EVERY other condition: missing
# evidence, schema mismatch, stale/incorrect candidate SHA, unauthorized approver,
# missing signature/reference, or a decision other than `authorized`.
#
# Reversibility: the gate is enforced by default (`ENTITY_PROMOTION_GATE_ENFORCE=1`)
# and can be turned off only by an explicit operator override
# (`ENTITY_PROMOTION_GATE_ENFORCE=0`); every override is written to the audited gate
# state log so the enforcement is transparent and reversible, never silently absent.
#
# Usage:
#   scripts/entity-promotion-gate.sh [--evidence <path>] [--sha <40-hex>] \
#       [--issue <issue-key>] [--gate-log <path>]
#
# Exits:
#   0  = authorized (evidence validated, SHA anchored) -> promotion MAY proceed.
#   78 = fail-closed (reason printed as `GATE_FAIL reason=...`) -> promote MUST NOT run.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"

# ---- option parsing ----------------------------------------------------------
EVIDENCE="${ENTITY_PROMOTION_EVIDENCE:-}"
SHA="${ENTITY_RELEASE_SHA:-}"
ISSUE="${ENTITY_PROMOTION_ISSUE:-THE-981/T-040}"
GATE_LOG="${ENTITY_PROMOTION_GATE_LOG:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --evidence) EVIDENCE="$2"; shift 2;;
    --sha) SHA="$2"; shift 2;;
    --issue) ISSUE="$2"; shift 2;;
    --gate-log) GATE_LOG="$2"; shift 2;;
    *) echo "[promotion-gate] unknown argument: $1" >&2; exit 78;;
  esac
done

log() { printf '%s\n' "$*"; }
gate_log() { # append to the audited gate state log (reverse-ability trail)
  [[ -n "$GATE_LOG" ]] || return 0
  printf '%s GATE %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$GATE_LOG"
}
fail_closed() { # fail_closed <reason...>
  printf 'GATE_FAIL reason=%s\n' "$*" >&2
  log "[promotion-gate] FAIL-CLOSED: $*" >&2
  gate_log "FAIL_CLOSED $*"
  exit 78
}

# ---- reversibility flag ------------------------------------------------------
ENFORCE="${ENTITY_PROMOTION_GATE_ENFORCE:-1}"
if [[ "$ENFORCE" != "1" ]]; then
  # Audited operator override (disabled): record it, then PROCEED. This is the
  # explicit, logged, reversible escape hatch — never a silent default.
  log "[promotion-gate] WARNING: promotion gate enforcement DISABLED (ENTITY_PROMOTION_GATE_ENFORCE=$ENFORCE)."
  gate_log "ENFORCEMENT_DISABLED entity_promotion_gate_enforce=$ENFORCE"
  printf 'GATE_DISABLED sha=%s\n' "${SHA:-<unset>}"
  exit 0
fi

# ---- required inputs ---------------------------------------------------------
[[ -n "$SHA" ]] || fail_closed missing-candidate-sha
if [[ ! "$SHA" =~ ^[0-9a-f]{40}$ ]]; then
  fail_closed malformed-candidate-sha "$SHA"
fi
[[ -n "$EVIDENCE" ]] || fail_closed missing-evidence
[[ -r "$EVIDENCE" ]] || fail_closed missing-evidence-file

# node (no dependencies) parses the evidence JSON so the gate is deterministic.
parse() { # parse <json> -> prints evidenceless normalized fields; run under node
  node -e '
    const fs = require("fs");
    let doc;
    try { doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch (e) { console.log("GATE_FAIL reason=invalid-json"); process.exit(0); }
    const out = {
      reason: "",
      schema: doc.schema || "",
      issue: doc.issue || "",
      candidateSha: doc.candidateSha || "",
      decision: doc.decision || "",
      authTypes: [],
      henryApprover: "", henryReference: "", henrySignature: "",
      gwType: "", gwConfirmed: false, gwConfirmedBy: "", gwConfirmedAt: "",
    };
    const auth = doc.authorization || {};
    if (Array.isArray(auth)) { for (const a of auth) { if (a && a.type) out.authTypes.push(a.type); } }
    else if (auth && auth.type) out.authTypes.push(auth.type);
    const ha = (Array.isArray(auth) ? auth.find(a=>a&&a.type==="henry_approval") : (auth&&auth.type==="henry_approval"?auth:null)) || {};
    out.henryApprover = ha.approver || ""; out.henryReference = ha.reference || ""; out.henrySignature = ha.signature || "";
    const gw = (Array.isArray(auth) ? auth.find(a=>a&&a.type==="gateway_mitigation") : (auth&&auth.type==="gateway_mitigation"?auth:null)) || {};
    out.gwType = gw.mitigation || gw.type || ""; out.gwConfirmed = gw.confirmed === true; out.gwConfirmedBy = gw.confirmedBy || ""; out.gwConfirmedAt = gw.confirmedAt || "";
    console.log(Object.entries(out).map(([k,v])=>k+"="+v).join("\n"));
  ' "$EVIDENCE"
}

# shellcheck disable=SC2181
PARSE_OUT="$(parse "$EVIDENCE")" && true
# shellcheck disable=SC2181
if [[ $? -ne 0 ]] || grep -q '^reason=invalid-json$' <<<"$PARSE_OUT"; then
  fail_closed invalid-json-evidence
fi

declare -A EV
while IFS='=' read -r k v; do [[ -n "$k" ]] && EV["$k"]="$v"; done <<<"$PARSE_OUT"

[[ "${EV[schema]:-}" == "entity.promotion-gate/v1" ]] || fail_closed schema-mismatch "(${EV[schema]:-})"
[[ "${EV[issue]:-}" == "$ISSUE" ]] || fail_closed issue-mismatch "${EV[issue]:-} != $ISSUE"
[[ "${EV[decision]:-}" == "authorized" ]] || fail_closed decision-not-authorized "${EV[decision]:-}"
[[ "${EV[candidateSha]:-}" == "$SHA" ]] || fail_closed stale-revision "${EV[candidateSha]:-} != $SHA"

# Authorization: Henry approval OR gateway mitigation. Both are evaluated; at least
# one fully-authorized path must hold (fail closed otherwise).
AUTH_OK=0
AUTH_TYPE="none"
case " ${EV[authTypes]:-} " in
  *henry_approval*)
    [[ "${EV[henryApprover]:-}" == "Henry" ]] && [[ -n "${EV[henryReference]:-}" ]] \
      && [[ ${#EV[henrySignature]} -ge 16 ]] && AUTH_OK=1 && AUTH_TYPE="henry_approval" \
      || fail_closed unauthorized-henry-approval
    ;;
esac
case " ${EV[authTypes]:-} " in
  *gateway_mitigation*)
    case "${EV[gwType]:-}" in
      disabled|repointed_away_from_main)
        [[ "${EV[gwConfirmed]:-}" == "true" ]] && [[ -n "${EV[gwConfirmedBy]:-}" ]] \
          && [[ -n "${EV[gwConfirmedAt]:-}" ]] && AUTH_OK=1 && AUTH_TYPE="gateway_mitigation" \
          || fail_closed unauthorized-gateway-mitigation
        ;;
      *) fail_closed unauthorized-gateway-mitigation-type "${EV[gwType]:-}" ;;
    esac
    ;;
esac

if [[ "$AUTH_OK" != "1" ]]; then
  fail_closed no-authorized-evidence "${EV[authTypes]:-}"
fi

printf 'GATE_PASS type=%s sha=%s\n' "$AUTH_TYPE" "$SHA"
log "[promotion-gate] PASS ($AUTH_TYPE) anchored to $SHA"
gate_log "PASS type=$AUTH_TYPE sha=$SHA"
exit 0
