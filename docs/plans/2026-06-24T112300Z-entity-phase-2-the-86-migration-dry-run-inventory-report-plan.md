# Task Plan: THE-86 Migration Dry-Run Inventory Report

## Goal
Implement a non-mutating migration inventory dry run for Entity Phase 2 that counts existing records and reports migration gap categories before any backfill write path exists.

## Issue
- Linear: `THE-86`
- Source ID: `THE-19.1`
- Parent: `THE-19` — Migration and backfill
- Branch: `THE-86-build-migration-dry-run-inventory-report`

## Dependencies
- [x] Required Phase 2 context reread.
- [x] Live Linear child and parent bodies read.
- [x] Confirmed `THE-86` is a child issue and next approved queue item.
- [x] Slice 0 dependency satisfied by completed `THE-21` through `THE-25` in run-state.
- [x] Worktree clean at THE-85 completion commit before branch creation.

## Plan
- [x] Step 1: Inspect current DB/task/document/artifact/activity/review storage APIs.
  - Verify: `rg "review_packet|activity|receipt|artifact|document|task" packages/db packages/server/src`
- [x] Step 2: Implement dry-run inventory logic and command/API surface using existing repo patterns.
  - Verify: `npm --prefix packages/db run build && npm --prefix packages/server run build`
- [x] Step 3: Add focused success and no-mutation/degraded gap tests.
  - Verify: `cd packages/server && nvm use 22.22.2 && npx vitest run src/__tests__/db-repositories.test.ts`
- [x] Step 4: Generate a THE-86 dry-run report sample and no-mutation proof artifact.
  - Verify: `node scripts/entity-phase-2-migration-inventory.mjs --out output/entity-phase-2/migration-inventory/THE-86.md && node scripts/entity-phase-2-migration-inventory.mjs --json --out output/entity-phase-2/migration-inventory/THE-86.json`
- [ ] Step 5: Run full proof and gates, then commit, update run-state, and comment Linear.
  - Verify: `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, `cd packages/server && npm run build && npx vitest run`, CLI Tester `request/run/book-review/verify`.

## Files Touched
- `docs/plans/2026-06-24T112300Z-entity-phase-2-the-86-migration-dry-run-inventory-report-plan.md` - created.
- `docs/plans/ACTIVE_PLAN.md` - updated to point at THE-86.
- `packages/db/src/index.ts` - dry-run inventory report, gap categories, and no-mutation proof.
- `packages/server/src/__tests__/db-repositories.test.ts` - focused no-mutation/gap coverage.
- `scripts/entity-phase-2-migration-inventory.mjs` - report writer for markdown/JSON proof artifacts.
- `output/entity-phase-2/migration-inventory/THE-86.md` - generated proof artifact (ignored).
- `output/entity-phase-2/migration-inventory/THE-86.json` - generated proof artifact (ignored).

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 11:23 | Setup | IN PROGRESS | Read required context, live Linear child/parent, confirmed dependency-safe child issue, created branch. |
| 11:28 | Implementation | COMPLETE | Added DB dry-run inventory report, focused no-mutation test, and CLI report writer; focused test and DB/server builds pass on Node 22. |

## Resume Instructions
1. Re-read this file and `.cursor/run-state/entity-phase-2.json`.
2. Run `git status --short --branch` and inspect diff.
3. Continue from the first unchecked Plan step.
4. Preserve dry-run/no-mutation behavior; do not add write/backfill mutation paths for THE-86.
