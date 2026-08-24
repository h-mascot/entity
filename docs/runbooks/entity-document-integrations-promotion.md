# Entity Document Integrations — Production Promotion Gate (T-040)

Linear issue: `THE-981` / T-040. Blocks final merge of the Google/Microsoft/local Office
document-integration lanes to `main`.

This runbook documents the **production approval gate**. Per the canonical PRD §26–27
and BUILD-CONTEXT, the normal "Always Land on Main" rule is **suspended** for T-038–T-040.
Promotion to production occurs **only after explicit approval**, and the release evidence must
record **either** Henry's explicit approval **or** a verified gateway-deployer mitigation
(disabled, or repointed away from `main`) **before any merge to `main`**.

## Gate semantics (fail-closed)

The promotion gate is `scripts/entity-promotion-gate.sh`. It returns exit `0` only when a valid
promotion-evidence record authorizes the exact candidate SHA. On any other condition it **fails
closed** (exit `78`) and no deploy/migration may proceed.

Authorization (at least one must fully hold):

- **`henry_approval`** — `approver == "Henry"`, a non-empty `reference` (e.g. a Linear comment /
  written approval), and a non-empty `signature` (length >= 16).
- **`gateway_mitigation`** — `type` (sub-field `mitigation`) in `{disabled,
  repointed_away_from_main}`, `confirmed == true`, and non-empty `confirmedBy` / `confirmedAt`.

Fail-closed conditions include: missing or unreadable evidence, invalid/corrupt JSON, schema or
issue mismatch, stale/incorrect candidate SHA (drift), a `decision` other than `authorized`, an
approver who is not Henry, a missing signature, or an unconfirmed mitigation.

**Reversibility:** the gate is enforced by default (`ENTITY_PROMOTION_GATE_ENFORCE=1`). An
explicit, logged operator override (`=0`) disables enforcement and writes an `ENFORCEMENT_DISABLED`
entry to the audited gate log — the enforcement is transparent and reversible, never silently
absent.

## Verification

Run the focused, deterministic gate suite (off-network):

```sh
npm run test:promotion-gate            # == bash scripts/entity-promotion-gate.test.sh
```

It covers the SUCCESS (Henry approval; confirmed gateway mitigation `repointed_away_from_main` /
`disabled`) plus negative (missing evidence), degraded (corrupt JSON), stale-revision (SHA
mismatch), authorization (non-Henry approver, missing signature, unconfirmed mitigation), and
security (decision/schema/issue mismatch, no authorized path, reversibility override is logged,
default enforcement is ON) paths.

## The mandatory pre-merge mitigation

The on-network Entity **gateway pull-deployer** (`scripts/entity-gateway-pull-deploy.mjs`)
defaults its tracked branch to `main` (`ENTITY_DEPLOY_BRANCH || 'main'`) and is configured at the
gateway runtime, not in this repo. A merge to `main` would therefore trigger an automatic deploy
unless the deployer is deliberately **disabled** or **repointed to a non-`main` branch**.

**Before any merge to `main`** the operator/supervisor MUST either:

1. **Confirm Henry's explicit approval** in a `henry_approval` evidence record, **or**
2. **Actually disable or repoint the gateway deployer away from `main`** and fill `confirmed=true`
   with `confirmedBy` / `confirmedAt` in
   `docs/plans/evidence/entity-document-integrations/T-040/gateway-mitigation.json`.

Until one of these is recorded as confirmed, the gate **fails closed** and `npm run promote:prod`
refuses (exit `78`) — this is intentional and mandatory.

## Run the promotion gate

```sh
# Fail-closed baseline (current truthful state — no approval yet, not confirmed):
ENTITY_RELEASE_SHA=<candidate-sha> \
  bash scripts/entity-promote-prod.sh          # -> exits 78, FAILED CLOSED

# Confirm the SELECTED mitigation (operator/supervisor, after actually disabling/repointing):
#   edit docs/plans/evidence/entity-document-integrations/T-040/gateway-mitigation.json,
#   set confirmed=true + confirmedBy + confirmedAt (same candidateSha)
bash scripts/entity-promotion-gate.sh \
  --evidence docs/plans/evidence/entity-document-integrations/T-040/gateway-mitigation.json \
  --sha <candidate-sha>                        # -> GATE_PASS, exit 0
```

Once the gate passes, `npm run promote:prod` (with production env config) is the approval-refusing
deploy path; it still requires the confirmed evidence and the exact candidate SHA.
