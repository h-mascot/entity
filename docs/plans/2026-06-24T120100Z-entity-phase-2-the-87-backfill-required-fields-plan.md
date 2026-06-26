## Task

**MC Task:** THE-87
**Created:** 2026-06-24T12:01:00+01:00
**Agent:** gpt-5.5
**Status:** BLOCKED_PENDING_BOOK_REVIEW

## Context

Implement THE-19.2 from the migration/backfill parent. THE-87 must backfill org/team/project, initiator, owner, assignee/executor, and worktype/accountability fields where inferable, while preserving uncertainty through source/confidence metadata and cleanup warnings.

Branch: `THE-87-backfill-required-hierarchy-accountability-fields`
Linear: `THE-87` / parent `THE-19`

## Dependencies

- [x] Live Linear parent `THE-19` body was read.
- [x] Live Linear prior sibling `THE-86` is Done and has Book-approved safe-to-continue comment.
- [x] Live Linear child `THE-87` body was read.
- [x] Confirmed `THE-87` is a child issue, not a parent epic.
- [x] Confirmed dependency-safe after `THE-86`.
- [x] Branch `THE-87-backfill-required-hierarchy-accountability-fields` created from clean `THE-86` checkpoint.

## Plan

- [x] Step 1: Inspect existing migration inventory and task backfill helper.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/__tests__/db-repositories.test.ts`, `scripts/entity-phase-2-migration-inventory.mjs`
  - **Verify:** `rg "backfillTaskHierarchyAndAccountability|phase2_backfill|THE-87" packages scripts docs`
- [x] Step 2: Tighten THE-87 backfill audit metadata and CLI report writer.
  - **Files:** `packages/db/src/index.ts`, `scripts/entity-phase-2-task-backfill.mjs`
  - **Verify:** `npm --prefix packages/db run build`
- [x] Step 3: Update focused tests for before/after fixture, idempotency, and cleanup warnings.
  - **Files:** `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** `cd packages/server && nvm use 22.22.2 && npx vitest run src/__tests__/db-repositories.test.ts`
- [x] Step 4: Generate THE-87 dry-run report plus isolated apply fixture and rollback notes.
  - **Files:** `output/entity-phase-2/task-backfill/THE-87*.{md,json}` (ignored)
  - **Verify:** `node scripts/entity-phase-2-task-backfill.mjs --out output/entity-phase-2/task-backfill/THE-87-dry-run.md && node scripts/entity-phase-2-task-backfill.mjs --json --out output/entity-phase-2/task-backfill/THE-87-dry-run.json`
- [ ] Step 5: Run required proof commands and CLI Tester request/run/book-review/verify.
  - **Files:** `output/entity-phase-2/test-gate/THE-87.*`, `output/entity-phase-2/book-review/THE-87*`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh && npm run build && cd packages/server && npm run build && npx vitest run`
- [ ] Step 6: Commit scoped work, update Linear proof comment/status, and advance run-state to THE-88 if verify allows.
  - **Files:** `.cursor/run-state/entity-phase-2.json` (ignored), Linear comment
  - **Verify:** `git status --short --branch`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 12:01 | Setup | COMPLETE | Required repo context, parent, prior issue, and child Linear body read; branch created. |
| 12:12 | Implementation | COMPLETE | Updated THE-87 version marker, previous-value audit metadata, focused tests, and CLI proof writer. |
| 12:08 | Gate | BLOCKED | Repo proofs and CLI Tester request/run passed; Book review returned REQUESTED/safeToContinue=false, so verify and THE-88 are blocked. |

## Files Touched

- `docs/plans/2026-06-24T120100Z-entity-phase-2-the-87-backfill-required-fields-plan.md` - created - compaction-survivable THE-87 plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for THE-87.
- `packages/db/src/index.ts` - modified - THE-87 backfill metadata/report audit details.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - focused before/after, idempotency, and cleanup-warning tests.
- `scripts/entity-phase-2-task-backfill.mjs` - created - CLI report writer for THE-87 markdown/JSON proof artifacts.

## Resume Instructions

1. Re-read this file fully.
2. Run `git status --short --branch` and inspect diff.
3. Confirm branch is `THE-87-backfill-required-hierarchy-accountability-fields`.
4. Find the first unchecked step above and continue there.
5. Preserve conservative inference: no fabricated owners/initiators/projects/assignees and no fake historical receipts.

## Done

- [ ] All steps complete.
- [x] Focused tests pass.
- [x] Dry-run report plus isolated apply fixture and rollback proof captured.
- [x] Full proof commands pass.
- [ ] CLI Tester request/run/book-review/verify receipts captured; request/run passed, Book review blocked, verify not run.
- [ ] THE-87 committed locally.
- [ ] Linear THE-87 proof comment posted and issue moved according to workflow.
- [ ] Run-state advanced to THE-88.
