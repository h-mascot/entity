# THE-848 / EE-A-05 Entity Engineering Seed Plan

Canonical recovery pointer: `docs/plans/ACTIVE_PLAN.md`

## Task

Create the scoped Entity Engineering project idempotently without changing existing business projects.

**Linear issue:** THE-848
**Created:** 2026-07-30
**Agent:** Cursor / GPT-5.6 Sol
**Status:** IN PROGRESS

## Context

- Work only in `/Users/enterprise/Code/entity-the-848-ee-a-05`.
- Base commit `314ce87` contains the proven EE-A-03/04 dependency chain.
- Seed identity is `project_key=entity-engineering` in the default org/team scope.
- Seed values are `name=Entity Engineering`, `work_domain=engineering`, and `lifecycle_state=active`.
- Existing projects, task assignments, labels, and classification values must not be updated or backfilled.
- Proof may mutate temporary test SQLite files only; do not open or mutate production/runtime DBs.
- No UI is changed, so browser proof is not required.
- No push, PR, merge, deploy, or production promotion.

## Dependencies

- [x] Step 1 depends on live Linear confirming THE-847 Done and THE-848 Todo.
- [x] Step 2 depends on the bootstrap order and existing scoped-key index being inspected.
- [x] Step 3 depends on a failing fresh-database seed test.
- [x] Step 4 depends on the fresh seed test passing.
- [x] Step 5 depends on idempotency and business-data preservation regressions passing.
- [x] Step 6 depends on full gates and independent review reaching zero blockers.
- [ ] Step 7 depends on local commits and final proof receipt.

## Plan

- [x] Step 1: Recover runner state and create a clean isolated worktree from completed EE-A-04.
  - **Files:** read-only runner, Linear, and git state
  - **Verify:** `git status --short --branch && git rev-parse HEAD`
- [x] Step 2: Add one fresh-database RED test for the exact scoped Entity Engineering seed.
  - **Files:** `packages/db/src/entity-engineering-seed.test.ts`
  - **Verify:** focused Vitest fails before implementation
- [x] Step 3: Add the minimal post-schema idempotent seed.
  - **Files:** `packages/db/src/index.ts`
  - **Verify:** focused fresh-database test passes
- [x] Step 4: Add negative/degraded proof for rerun idempotency and preservation of pre-existing business/customized rows.
  - **Files:** `packages/db/src/entity-engineering-seed.test.ts`
  - **Verify:** repeated bootstrap creates one scoped key and changes no pre-existing row
- [x] Step 5: Run DB, server, root, CTRL, and scope gates.
  - **Files:** no generated JavaScript in `packages/db/src`
  - **Verify:** `npm --prefix packages/db run build && npm --prefix packages/db test && cd packages/server && npm run build && npx vitest run && cd ../.. && npm run build && npm run ctrl:gate && git diff --check`
- [x] Step 6: Run independent review, fix blockers RED-first, and re-review to zero blockers.
  - **Files:** issue-scoped DB source/test and plans only
  - **Verify:** reviewer verdict APPROVED with 0 blockers
- [ ] Step 7: Commit locally, write seed/rollback proof, update runner state, reconcile Linear, and advance.
  - **Files:** proof/status files outside repo; scoped local commits
  - **Verify:** `git status --short --branch && git show --stat --oneline HEAD`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 06:02 | Step 1 | Complete | Linear dependency Done and clean worktree at 314ce87 verified |
| 06:03 | Step 2 | Complete | Fresh-db RED proved the scoped seed was absent |
| 06:08 | Step 3 | Complete | Post-schema scoped-key seed implemented; fresh/idempotent test green |
| 06:09 | Step 4 | Complete | Pre-existing business project remains byte-for-byte semantically unchanged |
| 06:11 | Step 5 | Complete | DB 15 tests, server 747 tests, root build, CTRL gate, and diff check pass |
| 06:18 | Step 6 | Complete | cursor-grok-4.5-high APPROVED with 0 blockers |

## Files Touched

- `docs/plans/2026-07-30-the-848-engineering-seed-plan.md` — durable issue execution plan
- `docs/plans/ACTIVE_PLAN.md` — compaction recovery pointer
- `packages/db/src/index.ts` — post-schema default-scoped idempotent seed
- `packages/db/src/entity-engineering-seed.test.ts` — fresh, rerun, and preservation proof

## Resume Instructions

1. Re-read this file and `docs/plans/ACTIVE_PLAN.md`.
2. Run `git status --short --branch` and `git diff`.
3. Continue from the first unchecked step.
4. Use temporary SQLite paths for all mutation proof.
5. Do not update existing projects or task data.
6. Do not push, merge, deploy, or mutate production.

## Done

- [ ] All steps complete
- [x] Fresh, idempotent, and preservation tests pass
- [x] Full gates pass
- [x] Independent review has 0 blockers
- [ ] Local commit and seed/rollback proof exist
- [ ] Linear reconciled
