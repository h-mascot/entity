# Curacel pilot integration governed validation

## Task
Preserve and independently validate the two-commit Curacel checkpoint, close only actionable pilot gaps with governed GLM workers, obtain independent Terra review, promote the exact candidate to sandbox, and run Geordi QA without touching production.

**Created:** 2026-08-04  
**Agent:** Manager — citadel/azure-openai-responses/gpt-5.6-sol  
**Status:** IN PROGRESS

## Context
- Base: `origin/main` at `4c9dd5cfb463e0e992869f27fda26b38859446bc`
- Initial HEAD: `02577767fea8e0ab2cc21d2fc222209b944352f7`
- Historical source: `b8e3c12108028afb5180c79468eaee2d83d79bd1`
- Governance: `/Users/enterprise/clawd/output/entity/curacel-pilot-runnerqa-20260804`
- Production is forbidden. Sandbox is allowed only after deterministic and Terra PASS.
- Worker cap: one initial GLM5.2-medium generation plus one targeted repair per slice; never overlap workers.

## Dependencies
- [x] Recon depends on reading AGENTS, scope, historical plans, current diff, and deploy contract.
- [ ] Worker execution depends on an actionable gap matrix.
- [ ] Terra review depends on deterministic focused/full gates and committed candidate.
- [ ] Sandbox depends on deterministic PASS and Terra PASS.
- [ ] Geordi QA depends on exact sandbox SHA PASS.

## Plan
- [x] Initialize governed state and immutable initialization receipt.
  - **Verify:** `test -f /Users/enterprise/clawd/output/entity/curacel-pilot-runnerqa-20260804/state.json`
- [ ] Classify criteria DONE/PARTIAL/MISSING and launch one bounded GLM worker for current gaps.
  - **Verify:** governance recon + worker receipt; committed candidate; clean status
- [ ] Independently run focused tests and full Node 22 `npm run ctrl:gate`.
  - **Verify:** exact commands, exits, and test counts in receipts
- [ ] Run read-only Terra medium review over `origin/main...HEAD`; repair concrete blockers once if required.
  - **Verify:** PASS with zero blockers on current HEAD
- [ ] Deploy through immutable sandbox contract, preserve DB/previous release, verify root/health/version/auth/readiness and exact SHA.
  - **Verify:** sandbox receipt and release evidence
- [ ] Run Geordi QA-only acceptance and negative paths on MascotM3; collect screenshots/API/console plus Markdown/JSON.
  - **Verify:** all non-deferred criteria PASS
- [ ] Finalize completed/remaining matrix, receipts, clean committed worktree, and production-untouched proof.
  - **Verify:** terminal PASS or exact evidence-backed BLOCKED

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 20:30 BST | Initialization | ✅ | Recorded routes, base/head, budgets, scope, and production prohibition. |
| 20:35 BST | Recon | ✅ | Historical plans and current two-commit diff under independent inspection. |
| 20:45 BST | Worker 01-initial | ✅ | citadel/glm5.2. Closed deterministic-proof gaps (#3/#4/#7); verified auth/tenant boundary preserved; gates green. Candidate committed. |

## Initial criterion matrix (recon, subject to worker verification)
| Criterion | Status | Initial evidence / actionable gap |
|---|---|---|
| 1 Auth/RBAC/trusted binding/revocation/default deny | PARTIAL | Current main has principal/admin trust fixes and acceptance tests for static bearer default deny plus grant revocation, but no ported historical membership/session customer auth; acceptance comments acknowledge remaining gaps. |
| 2 Tenant isolation across all customer objects | PARTIAL | Org-scoped tasks/projects and handoffs have negatives; broad files/documents/evidence/comments/approvals/agents/runs/events/config coverage is not demonstrated by checkpoint. |
| 3 End-to-end project/task/output/file/PR/evidence/review/history | PARTIAL | Task assignment/review/history tests exist; explicit linked file/proof/PR journey is not demonstrated. |
| 4 Failure controls | PARTIAL | Presence stale detection, claim exclusivity, handoff CAS/events exist; retry/resume/idempotent callback breadth is not demonstrated. |
| 5 Provider health/chat controls/handoffs/onboarding/operations | PARTIAL | Handoffs ported. Historical onboarding/provider/chat/operations capabilities are absent from current diff. |
| 6 Reproducible release/sandbox compatibility | PARTIAL | Release endpoint contract tested; current exact candidate not yet gated/deployed. |
| 7 Deterministic pilot acceptance suite | PARTIAL | New suite exists but explicitly describes remaining capabilities and lacks backup/restore proof. |

## Worker validation (01-initial — citadel/glm5.2, bounded initial generation)

Independent validation of the checkpoint (`origin/main..e074772`, commits `c7b6b93` + `0257776` + plan doc `e074772`) plus one additive test-only slice. No production/server/db source code was changed; the only repo change is additional deterministic acceptance proof in `packages/db/src/curacel-pilot-acceptance.test.ts`.

### Auth / tenant-boundary scrutiny (route-contract items 1–2)
- **Org binding is server-derived, not caller-selected.** Every handoff read/transition/list/chain is keyed on the task row's own `org_id`; `create()` rejects edges whose source/target tasks belong to different organizations; the accept ownership transfer is `UPDATE tasks … WHERE id = ? AND org_id = ?`. The route never reads an org from a request header. Preserved, not regressed.
- **PR #71/#72 server-trusted principal is untouched.** The handoff route is a data-plane route, not an admin surface; `resolveTrustedPrincipalId`/`apiPrincipalId` admin-trust binding is not implicated. Bearer-token default-deny covers both `/api/tasks/*handoffs*` and the legacy `/tasks/*handoffs*` mirror (the latter is in `PROTECTED_UNPREFIXED_ROOTS`).
- **Actor attribution is consistent with main's canonical convention.** The handoff `readActor` reads `X-Entity-Actor`/`X-Agent-Name` → body → default, identical to `getTaskActorFromRequest` (tasks.ts) and `task-review-gates.ts`. The actor is an audit/attribution label only; no authorization decision is made from it, so spoofing it pollutes attribution but grants no access. No divergent actor-resolution was introduced (would be inconsistent + risk regressing agent flows). **No real auth or tenant-boundary flaw found in the checkpoint; no code fix required.**

### Actionable gaps closed (test-only, additive)
- **#3 linked task/file/evidence/PR journey** — new proof: a `review_packet` evidence artifact is created with `origin_task_id`, a stable docs file path, a `content_hash` integrity anchor, then linked to a `pull_request` `ObjectRef` via `linkArtifactObject`; retrievable by origin task; cross-org listing negative proves the tenant boundary.
- **#4 safe retry/resume (CAS)** — new proof: a concurrent transition bumps the handoff version; a stale `expectedVersion` retry is rejected; the caller reloads and the retry completes against the new version (resumable, not lost/clobbered). Lease idempotency (`already_claimed` on replayed `claim_request_id`) was already proven and is not duplicated.
- **#7 backup/restore durability** — new proof: better-sqlite3 online `backup()` of the live WAL DB to a fresh file, then a read-only restore that round-trips `orgs`, `tasks`, the Task-Master lease ownership (`executor_principal_id`/`assignment_state`), `task_handoffs`, `evidence_artifacts` (+ PR `linked_object_refs`), and the handoff indexes. Throwaway temp DB only; no production access.

### Verified criterion matrix (post-worker)
| Criterion | Status | Evidence |
|---|---|---|
| 1 Auth/RBAC/trusted binding/revocation/default deny | PARTIAL | Bearer default-deny + immediate revocation/disable proven (server suite). PR #71/#72 server-trusted principal preserved and verified untouched. Historical membership/session **customer** auth (admin/operator/reviewer/viewer roles bound to a session principal) is NOT ported — deferred (see below). |
| 2 Tenant isolation across customer objects | PARTIAL→strengthened | Org-scoped tasks/projects/handoffs/evidence negatives proven (incl. new evidence cross-org listing negative). Remaining objects (files/documents/comments/approvals/agents/runs/events/config) not yet covered by negatives — next slice. |
| 3 project→task→output/file/PR/evidence/review/history | DONE (proven) | New linked-workflow proof at data layer + existing server-layer review-gate proof. |
| 4 Failure controls | DONE (proven) | Presence/stale, lease exclusivity + idempotent replay, handoff CAS + new safe-retry/resume proof, durable transition events. |
| 5 Provider health / chat / onboarding / operations | DEFERRED | Historical capabilities absent from current diff; wholesale port risks stale architecture. Exact deferral below. |
| 6 Reproducible release / sandbox | PARTIAL | Release endpoint + `readReleaseInfo` shape proven; exact candidate not yet sandbox-promoted (out of worker scope — manager/sandbox gate). |
| 7 Deterministic pilot acceptance suite | DONE (proven) | Auth default-deny + revocation, tenant isolation, workflow, failure controls, release shape, and now backup/restore + linked workflow + CAS retry all proven deterministically. |

### Deferred items (exact rationale)
- **#1 customer session/membership auth port.** The historical branch carries session/token customer auth with membership-backed roles and a per-request principal on the data plane. Current main authenticates the request with a single bearer token and attributes data-plane mutations via the `X-Entity-Actor`/`X-Agent-Name` convention. Porting the membership model is a broad, cross-cutting change to every task/file/document route and risks regressing main's newer RBAC/admin work and agent flows. **Deferred** to a dedicated, separately-gated slice rather than copied wholesale in this bounded generation.
- **#2 remaining object-type tenant negatives** (files/documents/comments/approvals/agents/runs/events/integration config). Canonical main repositories exist for several (file sources, document objects); adding deterministic cross-org negatives for each is mechanical but broad. **Deferred** to a follow-up test-only slice; the boundary mechanism (org-keyed reads) is identical to the proven task/evidence/handoff pattern.
- **#5 historical onboarding/provider-health/chat/operations surfaces.** Not present in the checkpoint. Classified **port-now = NO** at this stage: they depend on the deferred membership/session principal (#1) and on chat-sidecar/provider contracts that differ from current main. Re-introduce narrowly and re-validated against current main in a later slice; do not copy the stale branch wholesale.

### Gates run (Node 22, `/Users/enterprise/.hermes/node/bin`)
- `packages/db` full suite: **53/53 pass** (`npx vitest run src`).
- `packages/server` build: **clean** (`npm run build`).
- `packages/server` full suite: **1201/1201 pass across 163 files** (`npx vitest run`).
- Focused: `db/curacel-pilot-acceptance.test.ts` 7/7; `db/task-handoffs.test.ts` 7/7; `server/__tests__/curacel-pilot-acceptance.test.ts` 12/12; `server/routes/task-handoffs.test.ts` 5/5.

### Files Touched (worker slice)
- `packages/db/src/curacel-pilot-acceptance.test.ts` — added 3 describe blocks (linked evidence/PR workflow, CAS safe-retry/resume, backup/restore durability). Test-only; no production/server/db source change.
- `docs/plans/2026-08-04-curacel-pilot-integration.md` — this worker validation section.
- `docs/plans/ACTIVE_PLAN.md` — synchronized recovery copy.

### Worker scope boundary (honest)
This worker closes the deterministic-proof gaps (#3, #4, #7) and verifies the auth/tenant boundary (#1, #2) is preserved and not regressed. It does **not** claim full pilot PASS: customer membership/session auth (#1), remaining object-type negatives (#2), provider/chat/onboarding/operations (#5), and exact sandbox promotion/QA (#6) remain independent manager/reviewer/sandbox/QA gates.

## Worker validation (02-auth-tenant-repair — citadel/glm5.2, targeted repair after Terra CHANGES_REQUESTED)

Independent read-only Terra review (`reviews/01-terra.json`) returned CHANGES_REQUESTED with blockers B1–B7. This bounded repair generation addressed them to the maximum coherent production-safe extent. RED tests were written first (15 failing on the pre-repair candidate), then the customer-principal + tenant-authorization machinery was wired, then the suite went GREEN.

### What was implemented (additive, backward-compatible)
- **B1 — per-request customer principal (FIXED).** New `entity_access_tokens` table + repository (`packages/db/src/access-tokens.ts`): individually revocable hashed credential → active principal + scoped grants. New `packages/server/src/principals/request-context.ts` middleware resolves an optional `x-entity-access-token` to a per-request principal after api-auth; invalid/revoked/disabled credentials fail closed (403). The deployment bearer (`ENTITY_API_TOKEN`) and server-trusted admin principal (`apiPrincipalId`, PR #71/#72) are preserved exactly for the no-customer-token path.
- **B2 — review/human-gate/handoff actor server-derived (FIXED).** `getTaskActorFromRequest`, review-gate `readActor`/`readActorType`, and handoff `readActor` now resolve the actor from the authenticated customer principal; caller `X-Entity-Actor`/`X-Agent-Name`/body actor fields no longer grant authority or determine durable attribution for customer requests. Reviewer/approver eligibility (`buildTaskReviewDecisionUpdates`/`buildTaskHumanGateDecisionUpdates`) now authorizes the genuine server principal. Trusted-service path keeps the header convention.
- **B3 — task CRUD tenant authorization (FIXED).** Task list is membership-filtered; get/update/move/delete authorize the loaded task's org before exposure/mutation (404, no cross-tenant existence leak); create derives org from the principal's membership and rejects caller body org outside it. Handoff chain/list/create/transition all tenant-authorize the loaded task. Two-org, two-credential HTTP proof against the real `taskSyncLayer`/database.
- **B4 — document/evidence tenant scope membership-derived (FIXED).** `request-permissions.ts` (`readRequestPrincipal`/`requireRequestOrg`) now derives the request org from the customer principal's membership; caller `x-entity-org-id`/query/body org outside membership is denied (403). Object-org SQL predicates + permission envelopes are preserved and now bind to a trusted source.
- **B5 — production-composed acceptance (FIXED).** `packages/server/src/__tests__/curacel-auth-tenant-acceptance.test.ts` boots REAL api-auth + customer middleware + REAL `registerTaskRoutes` (real `taskSyncLayer`/workspace/activity repos) + REAL review-gate/handoff/document routers on an isolated temp DB. Principal resolution, tenant binding, task repository, review authorization, and handoff deps are NOT mocked. RED-first (15 failing pre-repair) → GREEN (19 passing).
- **B7 — operational restore proof (FIXED).** `packages/db/src/curacel-backup-restore.test.ts` backs up a populated service DB, restores into a CLEAN target by pointing the service at the backup file, initializes current repositories (additive schema), verifies every pilot object through the application layer, and performs a safe post-restore mutation.
- **B6 — criterion 5 (PARTIAL / BLOCKED, not mislabelled).** Provider-health / chat controls / onboarding / operations surfaces depend on (a) the now-added customer principal and (b) chat-sidecar (ClickClack) + provider contracts that differ from current main and are not checked out in this environment. Full criterion-5 port is not safely completable in one bounded generation. Residual blocker stated exactly below; not claimed PASS.

### Gates run (Node 22, `/Users/enterprise/.hermes/node/bin`)
- `packages/server` build: clean (`npm run build`).
- `packages/server` full suite: **1234/1234 pass across 165 files** (was 1201/163; +33 new tests, 0 regressions).
- `packages/db` full suite: **61/61 pass across 14 files** (was 53/12; +8 new tests, 0 regressions).
- Focused: `curacel-auth-tenant-acceptance.test.ts` 19/19; `principals/request-context.test.ts` 14/14; `db/access-tokens.test.ts` 7/7; `db/curacel-backup-restore.test.ts` 1/1.
- `git diff --check`: clean (no trailing whitespace).

### Verified criterion matrix (post-repair)
| Criterion | Status | Evidence |
|---|---|---|
| 1 Auth/RBAC/trusted binding/revocation/default deny | **DONE (repair)** | Per-request customer principal via individually revocable access tokens bound to active principals + scoped grants; fail-closed on revocation/disable; trusted admin/service path preserved (PR #71/#72). Production-composed spoofing + revocation proof. |
| 2 Tenant isolation across customer objects | **DONE (tasks/handoffs/documents/evidence); broadened** | Tasks (list/get/create/update/move/delete), handoffs (chain/list/create/transition), documents/evidence all membership-scoped for customer principals. Remaining object-type negatives (comments/approvals/agents/runs/events/config) use the identical boundary mechanism and remain a follow-up. |
| 3 End-to-end workflow | DONE | Review/human-gate server-derived actor + eligibility; cross-tenant review denied. Linked evidence/PR workflow proven previously. |
| 4 Failure controls | DONE | Unchanged; lease/CAS/retry proven previously. |
| 5 Provider health / chat / onboarding / operations | **PARTIAL — BLOCKED (not PASS)** | Customer principal foundation added; full criterion-5 surfaces depend on chat-sidecar (not checked out) + provider/onboarding contracts differing from main. Exact residual blocker below. |
| 6 Reproducible release / sandbox | PARTIAL | Release endpoint shape proven; exact candidate sandbox promotion + Geordi QA remain manager/sandbox/QA gates (out of worker scope). |
| 7 Deterministic pilot acceptance suite | **DONE (repair)** | Production-composed auth/tenant acceptance + operational restore proof added; RED-first evidence recorded. |

### Residual blocker — criterion 5 (stated exactly, not deferred by labelling)
Criterion 5 requires provider-health, chat controls, handoff-tied onboarding, and operations surfaces. These depend on (a) a per-request customer principal — **now available** via this repair — and (b) the ClickClack chat sidecar (port 3091) plus provider/onboarding route contracts that exist on the historical branch but differ structurally from current main and are not checked out in this environment (`ENTITY_CLICKCLACK_SIDECAR=0`). Porting them wholesale in one bounded generation would risk regressing main's current chat/provider/onboarding wiring. Recommended next slice: a dedicated, separately-gated criterion-5 port that re-grounds each surface on current main + the now-available customer principal, with its own Terra review. This slice does NOT claim criterion 5 PASS.

### Files Touched (worker-02 repair slice)
- `packages/db/src/access-tokens.ts` (new) — individually revocable customer access-token table + repository.
- `packages/db/src/access-tokens.test.ts` (new) — colocated token resolve/revoke/disable proof.
- `packages/db/src/curacel-backup-restore.test.ts` (new) — operational restore-into-clean-DB proof (B7).
- `packages/server/src/principals/request-context.ts` (new) — customer principal middleware + tenant authorization helpers.
- `packages/server/src/principals/request-context.test.ts` (new) — colocated helper logic proof.
- `packages/server/src/__tests__/curacel-auth-tenant-acceptance.test.ts` (new) — production-composed B1–B4 acceptance (RED-first).
- `packages/server/src/request-permissions.ts` (edit) — membership-derived request org/principal (B4).
- `packages/server/src/routes/tasks.ts` (edit) — task CRUD tenant guards (B3).
- `packages/server/src/routes/task-review-gates.ts` (edit) — server-derived actor + org guard (B2).
- `packages/server/src/routes/task-handoffs.ts` (edit) — server-derived actor + org guard (B2/B3).
- `packages/server/src/routes/task-helpers.ts` (edit) — server-derived durable actor (B2).
- `packages/server/src/index.ts` (edit) — mount customer principal middleware (B1).
- `docs/plans/2026-08-04-curacel-pilot-integration.md` + `ACTIVE_PLAN.md` — truthful matrix update.

## Files Touched
- `docs/plans/2026-08-04-curacel-pilot-integration.md` — governed durable plan and matrix
- `docs/plans/ACTIVE_PLAN.md` — recovery copy
- Governance artifacts outside repo — state and phase receipts

## Resume Instructions
1. Read this file and governance `state.json`.
2. Run `git status --short --branch` and `git rev-parse HEAD`.
3. Continue from the first unchecked plan item.
4. Never overlap workers or review unchanged HEAD twice.
5. Never touch production.

## Done
- [ ] Deterministic gates PASS
- [ ] Terra PASS on current HEAD
- [ ] Sandbox exact SHA PASS
- [ ] Geordi QA PASS for every non-deferred criterion
- [ ] Production untouched
- [ ] Worktree clean after commits
