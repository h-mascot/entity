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
