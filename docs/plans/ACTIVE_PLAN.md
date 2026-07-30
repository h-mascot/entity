# THE-847 / EE-A-04 Work-Domain Filter Plan

Canonical plan: `docs/plans/2026-07-30-the-847-work-domain-filter-plan.md`

## Task

Expose derived work-domain state and filtering on task-list/board APIs.

**Linear issue:** THE-847
**Created:** 2026-07-30
**Agent:** Cursor / GPT-5.6 Sol
**Status:** COMPLETE

## Context

- Work only in `/Users/enterprise/Code/entity-the-847-ee-a-04`.
- Base commit `1fd0d9a` is the proven EE-A-03 dependency.
- `tasks.project_id` is primary authority; `task_projects` are secondary tags.
- Unknown, missing, and unclassified primary-project states must remain explicit.
- No seed, backfill, production mutation, push, PR, merge, or deploy.

## Dependencies

- [x] Step 1 depends on live Linear confirming THE-846 Done and THE-847 Todo.
- [x] Step 2 depends on inspected primary-project and task-list response seams.
- [x] Step 3 depends on focused failing API/helper tests.
- [x] Step 4 depends on focused tests passing.
- [x] Step 5 depends on full gates and independent review reaching zero blockers.
- [x] Step 6 depends on a scoped local commit and final proof receipt.

## Plan

- [x] Step 1: Recover runner state, preserve canonical dirty work, and create an isolated dependent worktree.
  - **Files:** read-only runner, Linear, and git state
  - **Verify:** `git status --short --branch && git rev-parse HEAD`
- [x] Step 2: Add vertical RED tests for derived state, successful domain filtering, and unknown/malformed negative paths.
  - **Files:** `packages/server/src/task-projects.test.ts`, `packages/server/src/routes/tasks-work-domain.test.ts`
  - **Verify:** focused Vitest commands fail before implementation
- [x] Step 3: Implement primary-project-derived work-domain state and task-list filter wiring.
  - **Files:** `packages/server/src/task-projects.ts`, `packages/server/src/routes/tasks.ts`, `packages/server/src/index.ts`
  - **Verify:** focused Vitest commands pass
- [x] Step 4: Run required build/test gates and scope checks.
  - **Files:** no generated source artifacts
  - **Verify:** `cd packages/server && npm run build && npx vitest run && cd ../.. && npm run build && npm run ctrl:gate && git diff --check`
- [x] Step 5: Run independent correctness review, fix any blocker RED-first, and re-review to zero blockers.
  - **Files:** issue-scoped source/tests only
  - **Verify:** reviewer verdict APPROVED with 0 blockers
- [x] Step 6: Commit locally, write proof receipts, update runner state, and reconcile Linear.
  - **Files:** issue proof/status files outside the repo; one scoped local commit
  - **Verify:** `git status --short --branch && git show --stat --oneline HEAD`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 05:50 | Step 1 | Complete | Live dependency and clean isolated base verified |
| 05:50 | Step 2 | Complete | RED helper/API coverage proved filter and degraded-state gaps |
| 05:53 | Step 3 | Complete | Primary-derived state/filter implemented; 16 focused tests pass |
| 05:55 | Step 4 | Complete | Server 747 tests, root build, CTRL gate, and diff check pass |
| 05:59 | Step 5 | Complete | Two review blockers fixed RED-first; re-review APPROVED with 0 blockers |
| 06:01 | Step 6 | Complete | Local commit and receipts written; Linear THE-847 reconciled Done |

## Files Touched

- `docs/plans/2026-07-30-the-847-work-domain-filter-plan.md` — durable issue execution plan
- `docs/plans/ACTIVE_PLAN.md` — compaction recovery pointer
- `packages/server/src/index.ts` — task-route dependency wiring
- `packages/server/src/routes/tasks.ts` — derived response state and normalized domain filter
- `packages/server/src/routes/tasks-work-domain.test.ts` — vertical API contract and regression proof
- `packages/server/src/task-projects.ts` — primary-project work-domain derivation
- `packages/server/src/task-projects.test.ts` — authority and degraded-state unit proof

## Resume Instructions

1. Re-read this file and the canonical plan.
2. Run `git status --short --branch` and `git diff`.
3. Continue from the first unchecked step.
4. Keep `tasks.project_id` as the only board-domain authority.
5. Do not push, merge, deploy, seed, backfill, or mutate production.

## Done

- [x] All steps complete
- [x] Focused and full gates pass
- [x] Independent review has 0 blockers
- [x] Scoped local commit and proof receipt exist
- [x] Linear reconciled
