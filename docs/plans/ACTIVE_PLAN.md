# Curacel pilot integration governed validation

## Task
Preserve and independently validate the two-commit Curacel checkpoint, close only actionable pilot gaps with governed GLM workers, obtain independent Terra review, promote the exact candidate to sandbox, and run Geordi QA without touching production.

**Created:** 2026-08-04
**Agent:** Manager — citadel/azure-openai-responses/gpt-5.6-sol
**Status:** ACTIVE / READY_NEXT

## Context
- Base: `origin/main` at `4c9dd5cfb463e0e992869f27fda26b38859446bc`
- Initial HEAD: `02577767fea8e0ab2cc21d2fc222209b944352f7`
- Historical source: `b8e3c12108028afb5180c79468eaee2d83d79bd1`
- Governance: `/Users/enterprise/clawd/output/entity/curacel-pilot-runnerqa-20260804`
- Production is forbidden. Sandbox is allowed only after deterministic and Terra PASS.
- Worker cap: one initial GLM5.2-medium generation plus one targeted repair per slice; never overlap workers.

## Dependencies
- [x] Recon depends on reading AGENTS, scope, historical plans, current diff, and deploy contract.
- [x] Worker execution depends on an actionable gap matrix.
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
| 20:53 BST | Terra review | ⚠ CHANGES_REQUESTED | citadel/gpt-5.6-terra medium. Blockers B1–B7 (shared-bearer not customer auth; caller actor impersonation; global task fetch; caller-selected doc org; mocked acceptance; deferred criteria; backup-only restore). |
| 21:08 BST | Worker 02-auth-tenant-repair | ✅ | citadel/glm5.2 targeted repair. B1–B5 + B7 candidate landed; Terra later found R1–R7 residual defects. Gates green; 0 regressions. |
| 23:02 BST | R3/R4 continuation | ✅ | R3 task-derived authorization accepted at `3fc5f08`; R4 shared principal-derived surfaces accepted at `a616916`. Historical terminal BLOCKED receipt retained unchanged as evidence. |
| 00:04 BST | Ownership/live-state reconciliation | ✅ | Clean worktree at `a616916`; expected `9b86925` was an earlier reviewed checkpoint, while governed state proves accepted R3/R4 continuation. No other Pi process owns this worktree. Manager actual route citadel/azure-openai-responses/gpt-5.6-sol; authoritative CLI thinking medium; `PI_REASONING_LEVEL=off` mismatch noted without downgrade. |

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

> **Worker 02-auth-tenant-repair (targeted repair after Terra CHANGES_REQUESTED) is documented in full in `docs/plans/2026-08-04-curacel-pilot-integration.md` (section “Worker validation (02-auth-tenant-repair …)”).** Summary: B1 per-request customer principal (individually revocable access tokens), B2 server-derived review/handoff actor, B3 task-CRUD tenant authorization, B4 membership-derived document/evidence scope, B5 production-composed RED-first acceptance, B7 operational restore — all FIXED; B6 criterion-5 PARTIAL/BLOCKED with exact residual (chat-sidecar not checked out + provider/onboarding contracts differ from main). Gates: server 1234/1234 (165 files), db 61/61 (14 files), build clean, `git diff --check` clean. productionUntouched=true. This ACTIVE_PLAN copy is synchronized to the governed plan.

See `docs/plans/2026-08-04-curacel-pilot-integration.md` for the full worker validation section (auth/tenant-boundary scrutiny, actionable gaps closed, verified criterion matrix, deferred items with rationale, and gate counts). Summary: closed deterministic-proof gaps #3 (linked task/file/evidence/PR workflow), #4 (CAS safe-retry/resume), #7 (backup/restore durability) with additive test-only proof in `packages/db/src/curacel-pilot-acceptance.test.ts`; verified PR #71/#72 server-trusted principal and the org-keyed tenant boundary are preserved and not regressed; no production/server/db source code changed.

Gates (Node 22, `/Users/enterprise/.hermes/node/bin`): db 53/53; server build clean; server 1201/1201 (163 files).

Deferred (exact rationale in main plan): #1 customer membership/session auth port; #2 remaining object-type tenant negatives; #5 historical onboarding/provider-health/chat/operations (port-now = NO at this stage). Worker does NOT claim full pilot PASS.

## Files Touched
- `docs/plans/2026-08-04-curacel-pilot-integration.md` — governed durable plan and matrix
- `docs/plans/ACTIVE_PLAN.md` — recovery copy
- Governance artifacts outside repo — state and phase receipts

## Governed repair sequence (continuation correction)
- [ ] D-R1: mandatory per-principal credentials across customer data-plane; preserve narrowly authenticated service/admin boundary.
- [ ] D-R2: operation RBAC plus team/project grants.
- [x] R3: task-derived comments/activity/note/subtask/aggregate authorization (`3fc5f08`).
- [x] R4: shared principal-derived workspace/search/activity/chat scoping (`a616916`).
- [ ] R5: production-composed workflow and durable actor/audit proof after R1/R2.
- [ ] R6: provider health, chat controls, onboarding, operations criterion 5.
- [ ] R7: distinct clean-target restore with immutable backup proof.
- [ ] Node 22 full `npm run ctrl:gate`, fresh Terra review, immutable sandbox promotion, then Geordi QA-only.

## Resume Instructions
1. Read this file and governance `state.json`.
2. Run `git status --short --branch` and `git rev-parse HEAD`.
3. Continue from the first unchecked governed repair slice; current exact next action is D-R1.
4. Never overlap workers or review unchanged HEAD twice.
5. Preserve old receipts; never touch production.

## Done
- [ ] Deterministic gates PASS
- [ ] Terra PASS on current HEAD
- [ ] Sandbox exact SHA PASS
- [ ] Geordi QA PASS for every non-deferred criterion
- [ ] Production untouched
- [ ] Worktree clean after commits
