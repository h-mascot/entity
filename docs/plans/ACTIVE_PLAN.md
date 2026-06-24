## Task

**MC Task:** THE-86
**Created:** 2026-06-24T11:23:00Z
**Agent:** gpt-5.5
**Status:** VERIFYING

## Context

Implement THE-19.1 from the migration/backfill parent. THE-86 must add a non-mutating dry-run inventory that counts existing tasks, projects, docs, review packets, activity logs, artifacts, and migration gap categories before any backfill mutation.

Branch: `THE-86-build-migration-dry-run-inventory-report`
Linear: `THE-86` / parent `THE-19`

Detailed plan: `docs/plans/2026-06-24T112300Z-entity-phase-2-the-86-migration-dry-run-inventory-report-plan.md`

## Dependencies

- [x] Run-state pointer is `THE-86`.
- [x] Live Linear child and parent bodies were read.
- [x] Confirmed `THE-86` is a child issue, not a parent epic.
- [x] Slice 0 blocker satisfied by completed `THE-21` through `THE-25` in run-state.
- [x] Branch `THE-86-build-migration-dry-run-inventory-report` created from clean THE-85 completion commit `16c4e1a`.

## Plan

- [x] Step 1: Inspect current DB/task/document/artifact/activity/review storage APIs.
  - **Verify:** `rg "review_packet|activity|receipt|artifact|document|task" packages/db packages/server/src`
- [x] Step 2: Implement dry-run inventory logic and command/API surface using existing repo patterns.
  - **Verify:** `npm --prefix packages/db run build && npm --prefix packages/server run build`
- [x] Step 3: Add focused success and no-mutation/degraded gap tests.
  - **Verify:** `cd packages/server && nvm use 22.22.2 && npx vitest run src/__tests__/db-repositories.test.ts`
- [x] Step 4: Generate a THE-86 dry-run report sample and no-mutation proof artifact.
  - **Verify:** `node scripts/entity-phase-2-migration-inventory.mjs --out output/entity-phase-2/migration-inventory/THE-86.md && node scripts/entity-phase-2-migration-inventory.mjs --json --out output/entity-phase-2/migration-inventory/THE-86.json`
- [ ] Step 5: Run gates/proof, commit scoped files, update Linear, and advance run-state to THE-87.
  - **Verify:** CLI Tester request/run/book-review/verify plus repo proof commands.

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 11:23 | Setup | IN PROGRESS | Required context and live Linear issue/parent read; branch created; stale THE-85 active plan replaced. |
| 11:28 | Implementation | COMPLETE | Added DB dry-run inventory report, focused no-mutation test, and CLI report writer; focused test and DB/server builds pass on Node 22. |

## Files Touched

- `docs/plans/2026-06-24T112300Z-entity-phase-2-the-86-migration-dry-run-inventory-report-plan.md` - created - compaction-survivable THE-86 plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for THE-86.
- `packages/db/src/index.ts` - modified - dry-run inventory report, gap categories, and no-mutation proof.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - THE-86 focused no-mutation/gap coverage.
- `scripts/entity-phase-2-migration-inventory.mjs` - created - CLI report writer for markdown/JSON proof artifacts.
- `output/entity-phase-2/migration-inventory/THE-86.md` - generated proof artifact (ignored).
- `output/entity-phase-2/migration-inventory/THE-86.json` - generated proof artifact (ignored).

## Resume Instructions

1. Re-read this file fully.
2. Run `git status --short --branch` and inspect diff.
3. Confirm branch is `THE-86-build-migration-dry-run-inventory-report`.
4. Find the first unchecked step above and continue there.
5. Preserve dry-run/no-mutation behavior; do not add write/backfill mutation paths for THE-86.

## Done

- [ ] All steps complete.
- [x] Focused tests pass.
- [x] Dry-run sample and no-mutation proof captured.
- [ ] Full proof commands pass.
- [ ] CLI Tester request/run/book-review/verify receipts captured.
- [ ] THE-86 committed locally.
- [ ] Linear THE-86 proof comment posted and issue moved according to workflow.
- [ ] Run-state advanced to THE-87.
