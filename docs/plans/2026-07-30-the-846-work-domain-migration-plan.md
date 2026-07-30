# THE-846 / EE-A-03 Work-Domain Migration Plan

## Task

Implement and prove the dormant additive project schema/type/repository migration for `project_key` and `work_domain`.

**Linear issue:** THE-846
**Created:** 2026-07-30
**Agent:** Cursor / GPT-5.6 Sol
**Status:** COMPLETE

## Context

- Work only in `/Users/enterprise/Code/entity-the-846-ee-a-03`.
- EE-A-02 defines nullable normalized slugs, scoped uniqueness, and no seed/backfill.
- Preserve unknown state as `NULL`; do not touch production data.
- Local source commit is allowed only after green proof and scoped review.
- Required proof is written outside the repository under the Remaining Roadmap Runner directory.

## Dependencies

- [x] Step 1 has no dependencies; runner pack, EE-A-01/02 receipts, repo rules, and package scripts are loaded.
- [x] Step 2 depends on source seam and Linear acceptance inspection.
- [x] Step 3 depends on a focused failing test for each behavior slice.
- [x] Step 4 depends on all focused tests being green.
- [x] Step 5 depends on full gates and adversarial review reaching zero blockers.
- [x] Step 6 depends on a scoped local commit and final evidence.

## Plan

- [x] Step 1: Inspect Linear issue/parent and current DB, scoped repository, route, cloud/local normalization, and tests.
  - **Files:** read-only source inspection
  - **Verify:** `git status --short --branch && git rev-parse HEAD`
- [x] Step 2: Add focused migration/repository tests in vertical red-green slices.
  - **Files:** colocated DB/server project tests
  - **Verify:** focused Vitest commands demonstrate RED before implementation and GREEN after each slice
- [x] Step 3: Implement additive schema, validation, scoped CRUD, integrity cleanup, and cloud/local field preservation.
  - **Files:** scoped `packages/db/src/**` and `packages/server/src/**` project seams only
  - **Verify:** `npm --prefix packages/db test` plus focused server tests
- [x] Step 4: Run required build/test gates.
  - **Files:** no generated source artifacts
  - **Verify:** `npm --prefix packages/db run build && cd packages/server && npm run build && npx vitest run && cd ../.. && npm run build`
- [x] Step 5: Run correctness review, fix findings with regression tests, and confirm scope/safety.
  - **Files:** issue-scoped source/tests only
  - **Verify:** reviewer result APPROVED with 0 blockers and clean scoped diff
- [x] Step 6: Commit locally, write proof receipts, reconcile runner state and Linear when credentials permit, then stop.
  - **Files:** proof/status files outside repo; local issue-scoped commit
  - **Verify:** `git status --short --branch && git show --stat --oneline HEAD`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 04:39 | Step 1 | Complete | Required runner/design/repo/Linear context loaded |
| 04:47 | Steps 2–3 | Complete | RED/GREEN slices cover migration, validation, scope, deletion, and cloud preservation |
| 04:52 | Step 4 | Complete | DB, server, root build, and CTRL gates green on Node 22 |
| 05:04 | Step 5 | Complete | Reviewer blocker fixed RED-first; cursor-grok-4.5-high re-review APPROVED, 0 blockers |
| 05:05 | Step 6 | Complete | Scoped local commit/proof/reconciliation closure prepared; no push/merge/deploy |

## Files Touched

- `docs/plans/2026-07-30-the-846-work-domain-migration-plan.md` — durable issue execution plan
- `docs/plans/ACTIVE_PLAN.md` — recovery pointer for this issue
- `packages/db/src/index.ts` — additive schema, project CRUD, scoped assignment, atomic replacement, deletion integrity
- `packages/db/src/cloud.ts` — cloud project lifecycle/classification normalization
- `packages/db/src/work-domain-migration.test.ts` — migration, scope, validation, uniqueness, and integrity proof
- `packages/db/src/cloud.test.ts` — cloud-mode field preservation proof
- `packages/server/src/index.ts` — atomic replacement dependency wiring
- `packages/server/src/routes/tasks.ts` — fail-closed atomic project assignment paths
- `packages/server/src/routes/workspace.ts` — scoped project classification request parsing
- `packages/server/src/routes/workspace.test.ts` — scoped create/list/get/update and invalid-input proof

## Resume Instructions

1. Re-read `docs/plans/ACTIVE_PLAN.md`.
2. Run `git status --short --branch` and `git diff`.
3. Inspect the files listed under “Files Touched.”
4. Continue from the first unchecked plan step without repeating completed RED/GREEN proof.
5. Do not push, open a PR, merge, deploy, seed Entity Engineering, backfill projects, or mutate production.

## Done

- [x] All steps complete
- [x] Focused and full gates pass
- [x] Correctness review has 0 blockers
- [x] Scoped local commit and proof receipts exist
- [x] Linear reconciled if credentials are available
