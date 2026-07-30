# Phase A Final Report — Entity Provider Registry

**Runner:** Cursor Agent `grok-4.5`  
**Reviewer:** `codex-governed` / `gpt-5.6-sol` `model_reasoning_effort=medium`  
**SuperSpec SHA-256:** `4eaafc6815db1d731b0683ae4bf54096e64cc30e91a2b89d984fccc520ebd733`  
**Worktree:** `/Users/enterprise/Code/entity-provider-registry-phase-a-runner`  
**Branch:** `runner/provider-registry-phase-a-grok45-20260729`  
**HEAD:** `a87a6fd9527f06654291be174c88f7271ad5db66`  
**Artifact root:** `output/runner/provider-registry-phase-a/`  
**Packet status:** Audit artifacts complete for Phase A design-freeze after reviewer follow-ups; **not implementation-ready / not gate-closed**. THE-743/THE-744 remain In Review. Build baseline failure recorded; `ctrl:gate` / full server vitest not claimed for this docs/receipt run. Reviewer = requested `codex-governed` / `gpt-5.6-sol` medium (thermo-nuclear equivalent for this high-risk audit packet).

## Issue → artifact → proof map

| Issue | Code | Artifact | Commands / proof | Blocker |
| --- | --- | --- | --- | --- |
| THE-733 | PR-A-01 | `phase-a-source-runtime-receipt.md` | git SHA/status; SuperSpec shasum; curl version; DB path ls | None |
| THE-734 | PR-A-02 | `task-master-settings-audit.md` | UI + `/api/agent/*` audit | None |
| THE-735 | PR-A-03 | `docs-doc-intelligence-settings-audit.md` | DocsSettings + doc-intelligence routes | None |
| THE-736 | PR-A-04 | `provider-settings-secret-storage-audit.md` | settings.ts + settings-store | None |
| THE-737 | PR-A-05 | `sqlite-migration-audit.md` + schema/row-count dumps | §4.5 inventory; online backup | None |
| THE-738 | PR-A-06 | `provider-adapter-capability-matrix.md` | Adapters; chat-only Task Agent usage | None |
| THE-739 | PR-A-07 | `health-endpoint-inventory.md` | Health/test route inventory | None |
| THE-740 | PR-A-08 | `task-master-scheduler-run-history-audit.md` | §4.4 inventory | None |
| THE-741 | PR-A-09 | `run-now-smoke-test-semantics.md` | Trigger vs missing Smoke Test | None |
| THE-742 | PR-A-10 | `permissions-csrf-rate-limit-log-audit.md` | §4.6 inventory | None |
| THE-743 | PR-A-11 | `oq-001-oq-018-decision-ledger.md` | Proposed ledger | **In Review** — sign-off |
| THE-744 | PR-A-12 | `migration-rollback-plan.md` | Plan + §11.10 rollback | **In Review** — sign-off |

Also: `linear-reconciliation-intended-actions.json`, `provider-registry-backup-restore-receipt.md`, this report.

## SuperSpec §4.7 canonical outputs

| # | Canonical name | Produced as |
| --- | --- | --- |
| 1 | `provider-registry-prebuild-audit.md` | present (aggregate pointer) |
| 2 | `provider-registry-current-settings-map.md` | present |
| 3 | `provider-registry-secret-location-map.md` | present |
| 4 | `task-master-health-source-map.md` | present |
| 5 | `provider-registry-migration-plan.md` | present |
| 6 | `provider-registry-backup-restore-receipt.md` | present (sandbox online backup + isolated restore) |
| 7 | `provider-adapter-capability-matrix.md` | present |
| 8 | `provider-registry-open-decisions.md` | present |

## Verification

| Command | Result |
| --- | --- |
| Root/app `npm run build` | **Baselines FAIL** — pre-existing `MobileView.tsx` `inert` TS2322. Blocks full `ctrl:gate`. |
| `packages/server` `tsc` | **PASS** |
| `packages/server` vitest under **Node 22** | **PASS 736/736** (`hermes` node + workspace vitest) |
| Host Node 26 vitest | ABI fail for `better-sqlite3` (expected; use Node 22) |
| Retained sandbox backup | `/Users/enterprise/Services/entity-sandbox/backups/provider-registry/20260729T170500Z-phase-a-rehearsal/` |
| Restore proof @ `a87a6fd` | Real `entity-server` `/api/health` + HTTP `/api/agent/settings` redaction |
| `ctrl:gate` | **Not PASS** — app build baseline failure. Packet **non-final** for release. |
| Codex-governed review | Required command run; transcripts outside patch under `/tmp/entity-provider-registry-phase-a-review/` |

**Honesty:** THE-733…THE-742 Done = Phase A **audit artifacts delivered**. Not a claim that CTRL/release gate is green.

## Linear

- THE-733…THE-742 → Done (with proof comments)
- THE-743 / THE-744 → **In Review** (pending approvals)
- MCP Linear unavailable; GraphQL via env key used

## Reviewer

Requested reviewer ran via `codex-governed` / `gpt-5.6-sol` / medium. Initial post-run review surfaced two P2 audit-wording issues; both were patched in this packet:

1. Backup verification now checks the retained backup checksum and compares live DB state logically, instead of requiring byte equality with a mutable WAL source.
2. Provider-health persistence now acknowledges existing sandbox `provider_health_samples` / `provider_recovery_receipts` and requires Phase B reuse/migrate/separate decision.

Rerun review receipt should be checked under the runner run directory before Phase B.

## Actual-invocation usage tracking seam (review follow-up)

Provider registry `last_used_at` / usage telemetry must be updated at actual invocation sites, not during profile resolution alone. `getTaskAgentLanguageModel()` constructs the model; the independent call sites are:

- Task Master `TaskAgent.invokeModel()`
- task comment `@mention` responder
- document comment responder
- Doc Intelligence ask route

Phase B/C implementation must expose a shared invocation wrapper or callback so every consumer records usage/error/health against the resolved provider profile. Updating only in `getTaskAgentLanguageModel()` would over-count resolution-only paths and still miss failures at the actual `generateText` call sites.

## Design-freeze headlines

1. Secrets: plaintext `app_settings` + env; no managed secrets.
2. Consumers: TaskAgent, task comment responder, doc intelligence, document comment responder.
3. Task Agent model path is **chat-only** (no AI SDK tools).
4. Smoke Test missing; Run Now = mutating `trigger manual`.
5. Migrations: ensure-on-open + plugin ledger precedent; never drop additive tables on normal rollback.

## Provider-kind and cutover-decision reviewer follow-up

Reviewer rerun required two additional carry-forward fixes:

1. `provider-adapter-capability-matrix.md` now includes explicit SuperSpec §13.1 / OQ-006 support classifications for Google, OpenAI, Azure OpenAI, OpenAI-compatible, Anthropic, xAI, Vercel Gateway, and Local/OpenAI-compatible. Azure/local kinds are partial/audit-only until adapter DTOs, endpoint validation, SSRF/local-network policy, and health tests exist.
2. `provider-registry-open-decisions.md` now preserves OQ-019–OQ-028 production cutover decisions (fallback duration, read-only rollout, dual writes, health retention, env-name disclosure, post-edit health semantics, Run Now scheduling behavior, test timeout/rate limits, observability destination, rollback observation period).

## Phase B gate

Do **not** start Phase B until:

1. Owners accept/amend the OQ ledger (THE-743)
2. Migration/rollback plan approved (THE-744)
3. Backup/restore receipt accepted (now present for sandbox; re-run before DDL)
4. Consumer key mapping confirmed (incl. comment responders)
