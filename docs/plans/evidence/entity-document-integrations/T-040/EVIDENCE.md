# T-040 — Production Approval Gate (Entity Document Integrations)

**Status:** READY FOR SUPERVISOR COMMIT — the production approval gate is implemented, the
promotion path fails closed without explicit approval evidence, the focused acceptance suite is
green, and the evidence bundle records the truthful disposition. The **mandatory pre-merge
mitigation is recorded as REQUIRED but NOT YET CONFIRMED** — the gate therefore refuses any
promotion until a supervisor actually disables/repoints the gateway deployer (or Henry approves).

**Runner:** T-040 pinned Runner Local implementation worker / Citadel `daystrom/deepseek`.
**Worktree HEAD:** initial `e6efcfd26bc86ae4bdfdccca80b5f84bfcba4885` (clean before edits).
**Issue:** `THE-981` / T-040.

## Acceptance (from phase2-canonical-prd.md T-040)

> Production promotion occurs only after explicit approval. The release evidence records either
> Henry's approval before merge OR confirmation that the gateway deployer was disabled or
> repointed away from main; the selected mitigation is mandatory before merge.

**Disposition — what this worker did and did NOT do (capability-honest):**

- **Did:** implemented the audited, evidence-backed production approval gate; made the promotion
  path **fail closed** unless explicit Henry-approval evidence or a confirmed gateway mitigation
  is supplied and anchored to the exact candidate SHA; added deterministic success + negative /
  degraded / stale-revision / authorization / security coverage; wrote the T-040 evidence bundle.
- **Did NOT:** obtain or invent Henry's approval (expressly forbidden); mutate credentials;
  merge `main`; deploy production or any environment; mutate Linear; run any destructive data
  operation. The on-network gateway pull-deployer is configured at the gateway runtime and **cannot
  be disabled/repointed from this repo** — that remediation is the mandatory, supervisor/operator
  owned step recorded below.

## The selected mitigation (mandatory before merge)

**Selected mitigation:** gateway-deployer mitigation — the on-network Entity pull-deployer
(`scripts/entity-gateway-pull-deploy.mjs`, tracked branch `ENTITY_DEPLOY_BRANCH || 'main'`) must be
**disabled or repointed away from `main`** before any merge to `main`.

Recorded at `docs/plans/evidence/entity-document-integrations/T-040/gateway-mitigation.json` as
**`authorization[0].confirmed = false`** — intentionally NOT yet confirmed. Until a supervisor
actually disables/repoints the deployer and fills `confirmed=true` + `confirmedBy` + `confirmedAt`
(OR Henry's explicit `henry_approval` evidence is added), the promotion gate **fails closed**
(verified: `exit 78`). This is the truthful, enforced default: no deployment can slip through.

## Why the worker cannot self-confirm the mitigation

The gateway pull-deployer defaults to `branch: 'main'` and is configured via
`ENTITY_DEPLOY_BRANCH` at the gateway runtime (gitignored / not present in this repo or in
`.env.example` / `entity.config.example.yaml`). Disabling or repointing it is a production-control
action outside this worker's authority (no gateway credentials; mutate-credentials and
deploy-production are forbidden). The in-repo gate therefore **requires** confirmation rather than
asserting it, keeping the mandatory mitigation enforceable and honest.

## Deliverables (single coherent diff, all in T-040 scopes / recorded manager expansion)

- `scripts/entity-promotion-gate.sh` — NEW audited, evidence-backed, fail-closed approval gate
  (schemas `entity.promotion-gate/v1`; Henry-approval OR gateway-mitigation authorization;
  candidate-SHA anchoring; reversibility override `ENTITY_PROMOTION_GATE_ENFORCE` default ON,
  logged).
- `scripts/entity-promotion-gate.test.sh` — NEW colocated focused test (15 assertions: success x3,
  negative x2, degraded, stale-revision, authorization x3, security x4, reversibility).
- `scripts/entity-promote-prod.sh` — hardened: replaced the weak self-attested `--yes` /
  `ENTITY_PROD_APPROVED=1` path with the evidence gate as the single mandatory authorization;
  fails closed (exit 78) and records the selected-mitigation requirement. No deploy/config touched.
- `docs/runbooks/entity-document-integrations-promotion.md` — NEW runbook (authorized T-040 path)
  documenting gate semantics, the two authorizations, verification, and the mandatory pre-merge
  mitigation.
- `docs/plans/evidence/entity-document-integrations/T-040/EVIDENCE.md` — this truthful log.
- `docs/plans/evidence/entity-document-integrations/T-040/gateway-mitigation.json` — the canonical
  machine-readable mitigation record (unconfirmed → gate fails closed).
- `package.json` — **manager scope expansion (recorded):** added `"test:promotion-gate"` to expose
  the named focused verification command required by the Runner contract. Reason: the ticket's
  focused verification must be invocable by a named command; no other config/script change made.

No production config, DB, credentials, feature flag state, or product source modified. No `packages/`
source change. The gate's reversibility is expressed through the same audited env-flag pattern the
`phase2-flags.ts` framework uses (`ENTITY_*` env flags, default-enforced, operator-overridable,
logged) — no silent behavior change.

## Focused acceptance test (real, off-network)

```sh
npm run test:promotion-gate     # == bash scripts/entity-promotion-gate.test.sh
bash -n scripts/entity-promotion-gate.sh
bash -n scripts/entity-promotion-gate.test.sh
bash -n scripts/entity-promote-prod.sh
```

- `npm run test:promotion-gate` → **PASS** (15/15):
  - SUCCESS — valid Henry approval → `GATE_PASS exit 0`.
  - SUCCESS (B) — gateway mitigation `repointed_away_from_main` confirmed → `GATE_PASS exit 0`.
  - SUCCESS (B2) — gateway mitigation `disabled` confirmed → `GATE_PASS exit 0`.
  - NEGATIVE — no evidence file / evidence missing → fail closed `exit 78`.
  - DEGRADED — corrupt/invalid JSON → fail closed.
  - STALE-REVISION — evidence SHA != candidate SHA → `GATE_FAIL reason=stale-revision`.
  - AUTHORIZATION — approver != Henry; missing signature; unconfirmed mitigation → fail closed.
  - SECURITY — `decision != authorized`; schema mismatch; issue mismatch; no authorized path →
    fail closed.
  - REVERSIBILITY — override `ENTITY_PROMOTION_GATE_ENFORCE=0` proceeds but is logged
    (`ENFORCEMENT_DISABLED`); default enforcement is ON (no evidence → fail closed).
- `bash -n` on the three shell scripts → **exit 0** each.
- Live end-to-end fail-closed: `bash scripts/entity-promote-prod.sh` → **exit 78**, refuses before
  any deploy with `FAILED CLOSED: ... no authorized Henry-approval or gateway-mitigation evidence`.
- Confirmed-record probe (temp, not committed): gateway `disabled` confirmed → `GATE_PASS exit 0`;
  Henry approval (approver Henry + reference + signature) → `GATE_PASS exit 0`. Canonical
  unconfirmed record → `GATE_FAIL exit 78`. Success paths are reachable when authorization is real.
- `git diff --check` → **clean (exit 0)** (recorded after diff finalized).

## Every named T-040 path — changed or explicitly ruled out

| Path | Disposition |
|---|---|
| `docs/loom/entity-document-integrations/phase2-canonical-prd.md` | **Not changed.** Source contract already specifies T-040; no contract change needed. |
| `docs/runbooks/entity-document-integrations-promotion.md` | **Created** (authorized). |
| `scripts/entity-promote-prod.sh` | **Changed** — hardened to the evidence gate. |
| `docs/plans/evidence/entity-document-integrations/T-040/` | **Created** (EVIDENCE.md + gateway-mitigation.json). |
| colocated focused tests proving the gate | **Created** (`entity-promotion-gate.test.sh`). |
| `package.json` | **Manager-scope expansion (recorded above):** added `test:promotion-gate` for the named verification command. |

## Commands / results ledger

- `npm run test:promotion-gate` → **PASS** (15/15).
- `bash -n scripts/entity-promotion-gate.sh` → exit 0.
- `bash -n scripts/entity-promotion-gate.test.sh` → exit 0.
- `bash -n scripts/entity-promote-prod.sh` → exit 0.
- `bash scripts/entity-promote-prod.sh` → **exit 78 FAILED CLOSED** (correct; gate enforces).
- Confirmed-record probes (temp) → gateway `disabled` `GATE_PASS exit 0`; Henry `GATE_PASS exit 0`.
- `git diff --check` → clean (exit 0).
- `node -e "JSON.parse(...)"` on `package.json` → valid.
- No server TypeScript / `packages/` sources changed → no server build/typecheck delta required.

## Limitation / honest boundary

- **No Henry approval exists in this bundle.** It must be obtained by the human/Henry before any
  merge if the Henry-approval path is chosen; alternatively the gateway mitigation must be
  physically confirmed. Neither is invented or asserted here.
- **The gateway deployer is NOT yet disabled/repointed** — that is a gateway-runtime production
  control this worker cannot and did not perform. The gate fails closed until the supervisor
  confirms it. This is the truthful status, not a lost pass.
- No `packages/` source change, so no server build/typecheck delta; the focused acceptance suite
  is the required gate for this ticket.
- No git metadata was mutated (`git add`/`commit`/`push`/`merge`); the supervisor commits this one
  coherent uncommitted diff. No deploy, DB write, credential, or Linear call was made.

- **Known generated-doc staleness (supervisor-owned):** `openwiki/operations/security-and-release.md`
  describes `promote:prod` as "require `--yes` or `ENTITY_PROD_APPROVED=1`". After this change the
  promote path additionally requires the audited evidence gate to pass (fail-closed). This page is
  generated OpenWiki that AGENTS.md says not to hand-edit; OpenWiki regeneration was the
  supervisor-owned step at T-038 (BUILD-CONTEXT proof baseline), so regenerating it here is left to
  the supervisor on the merged result, matching the established pattern.
