## Task

**MC Task:** THE-90
**Created:** 2026-06-24T16:29Z
**Agent:** GPT-5.5
**Status:** IN PROGRESS

## Context

Implement THE-19.5 from the migration/backfill parent. THE-90 documents the progressive migration runbook and rollback/non-fabrication rules, and strengthens proof that migration/backfill is non-destructive, idempotent, preserves human corrections, keeps old tasks visible, and never fabricates raw historical receipts.

Branch: `THE-90-document-migration-runbook-rollback`
Linear: `THE-90` / parent `THE-19`

Supervisor context says THE-89 is complete and approved by real Book review. THE-90 may build on THE-86 inventory, THE-87 hierarchy/accountability backfill, THE-88 review/evidence mapping, and THE-89 cleanup queues. Preserve conservative migration semantics: historical completed tasks without canonical receipts must be marked missing or acknowledged only; cleanup corrections are authoritative; rollback must be narrow and non-destructive.

## Dependencies

- [x] Required Phase 2 repo context read: `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, build context, canonical PRD, gap matrix, Linear issue map, parent THE-19 epic excerpt, and THE-90 issue draft.
- [x] THE-90 mapping confirmed: source `THE-19.5`, Linear UUID `dcd045a3-51a5-4a78-b47b-db02db84440f`, parent `THE-19`.
- [x] Scoped THE-90 branch created from the approved THE-89 checkpoint.
- [x] Runbook content depends on implemented THE-86 through THE-89 migration behavior.
- [x] Test additions depend on identifying existing db/server migration test seams.
- [ ] Final proof depends on docs/tests passing and no fail-stop blocker.

## Plan

- [x] Step 1: Document the THE-90 migration runbook.
  - **Files:** `docs/runbooks/entity-phase-2-migration-backfill-runbook.md`
  - **Verify:** `rg "THE-90|non-fabrication|rollback|cleanup queues" docs/runbooks/entity-phase-2-migration-backfill-runbook.md`
- [x] Step 2: Strengthen migration/backfill tests for non-fabrication, idempotency, old-task visibility, and human correction preservation.
  - **Files:** `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/__tests__/db-repositories.test.ts`
- [x] Step 3: Generate THE-90 proof artifacts for the runbook/CLI surfaces where applicable.
  - **Files:** `output/entity-phase-2/migration-runbook/THE-90.md`, `output/entity-phase-2/migration-runbook/THE-90.json` (ignored)
  - **Verify:** `node scripts/entity-phase-2-migration-inventory.mjs --json --out output/entity-phase-2/migration-runbook/THE-90-inventory.json && node scripts/entity-phase-2-migration-cleanup-queues.mjs --fixture-sample --json --out output/entity-phase-2/migration-runbook/THE-90-cleanup-queues.json`
- [x] Step 4: Run required server proof.
  - **Files:** none
  - **Verify:** `cd packages/server && npm run build && npx vitest run`
- [x] Step 5: Run full repo build and Phase 2 smoke proof.
  - **Files:** none
  - **Verify:** `npm run build && bash scripts/proof/entity-phase-2-smoke.sh`
- [ ] Step 6: Run test gate and Book review packet. BLOCKED: packet-only Book review returned `decision=REQUESTED`, `safeToContinue=false`.
  - **Files:** `output/entity-phase-2/test-gate/THE-90.json`, `output/entity-phase-2/book-review/THE-90.json` (ignored)
  - **Verify:** `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json verify THE-90`
- [ ] Step 7: Inspect final diff and GitNexus changes.
  - **Files:** none
  - **Verify:** `git status --short && git diff --stat`; GitNexus `detect_changes(scope=all, worktree=/Users/enterprise/Code/entity)`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 16:29Z | Setup | COMPLETE | Confirmed THE-89 handoff, clean worktree, and THE-90 issue mapping/context. |
| 16:30Z | Branch | COMPLETE | Created `THE-90-document-migration-runbook-rollback` from approved THE-89 checkpoint. |
| 16:31Z | Plan | COMPLETE | Created compaction-survivable THE-90 plan before implementation. |
| 16:34Z | Steps 1-2 | COMPLETE | Added migration/backfill runbook and db regression test for non-fabrication, old-task visibility, acknowledgement, correction preservation, and idempotent reruns. |
| 16:35Z | Steps 3-5 | COMPLETE | Generated THE-90 migration proof JSON; server build+Vitest passed; root build and Phase 2 smoke passed under Node 22. |
| 16:36Z | Step 6 | BLOCKED | CLI Tester run PASS and scans clean, but Book review produced packet-only `REQUESTED` receipt with `safeToContinue=false`; verify did not run. |

## Files Touched

- `docs/plans/2026-06-24T162900Z-entity-phase-2-the-90-migration-runbook-plan.md` - created - compaction-survivable THE-90 plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for THE-90.
- `docs/runbooks/entity-phase-2-migration-backfill-runbook.md` - created - THE-90 progressive migration/backfill runbook.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - THE-90 migration runbook invariant coverage.
- `output/entity-phase-2/migration-runbook/THE-90-inventory.json` - generated proof artifact (ignored).
- `output/entity-phase-2/migration-runbook/THE-90-cleanup-queues.json` - generated proof artifact (ignored).
- `output/entity-phase-2/test-gate/THE-90.json` - CLI Tester request/run receipt (ignored).
- `output/entity-phase-2/book-review/THE-90.json` - packet-only Book review request receipt (ignored).

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Confirm branch is `THE-90-document-migration-runbook-rollback`.
4. Confirm whether real Book review has approved `output/entity-phase-2/book-review/THE-90.json`.
5. If approved, rerun `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json verify THE-90 THE-90-document-migration-runbook-rollback`.
6. Continue from the first unchecked step above; do not redo completed steps.

## Done

- [ ] All steps complete
- [x] Tests pass
- [x] Proof artifacts generated
- [ ] Book review completed
