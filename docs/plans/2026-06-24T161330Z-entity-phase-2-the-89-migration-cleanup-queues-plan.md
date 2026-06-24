## Task

**MC Task:** THE-89
**Created:** 2026-06-24T16:13:30Z
**Agent:** gpt-5.5
**Status:** BLOCKED_PENDING_BOOK_REVIEW

## Context

Implement THE-19.4 from the migration/backfill parent. THE-89 exposes migration warnings as cleanup queues, keeps old tasks visible, allows human correction of cleanup values, and protects corrected values from later migration/backfill reruns.

Branch: `THE-89-build-migration-warning-cleanup-queues`
Linear: `THE-89` / parent `THE-19`
Detailed plan: `docs/plans/2026-06-24T161330Z-entity-phase-2-the-89-migration-cleanup-queues-plan.md`

Supervisor context says THE-88 is complete and approved by real Book review. THE-89 may build on THE-86 inventory, THE-87 backfill metadata, and THE-88 review/evidence mapping. Preserve conservative migration semantics: do not fabricate missing historical receipts, do not overwrite human-corrected values, and keep unresolved migration ambiguity visible.

## Dependencies

- [x] Worktree started clean on `THE-88-map-review-packets-evidence-structured` after commit `32a9323`.
- [x] Required Phase 2 repo context read: `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, build context, canonical PRD, gap matrix, Linear issue map, parent THE-19 epic excerpt, and THE-89 issue draft.
- [x] THE-89 mapping confirmed: source `THE-19.4`, Linear UUID `ce81add3-f5b4-480e-ae0c-67b6a8e5a8a0`, parent `THE-19`.
- [x] Prior THE-86/THE-87/THE-88 migration/report patterns inspected.
- [x] Scoped THE-89 branch created from the approved THE-88 checkpoint.

## Plan

- [x] Step 1: Inspect current migration metadata, task repository update seams, and server/UI surfaces for cleanup queue exposure.
  - **Verify:** `rg "phase2_backfill|phase2_review_evidence_mapping|migration_warning|cleanup" packages scripts`
- [x] Step 2: Implement a focused cleanup queue report/service over existing migration warnings and review/evidence warnings.
  - **Files:** likely `packages/db/src/index.ts`
  - **Verify:** `npm --prefix packages/db run build`
- [x] Step 3: Add human correction apply path that records authoritative correction metadata and prevents THE-87-style backfill overwrites on rerun.
  - **Files:** likely `packages/db/src/index.ts`
  - **Verify:** `npm --prefix packages/db run build`
- [x] Step 4: Add focused tests for queue visibility, old-task visibility, human correction, and idempotent backfill rerun protection.
  - **Files:** `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/__tests__/db-repositories.test.ts`
- [x] Step 5: Add CLI/API proof surface for THE-89 cleanup queue output.
  - **Files:** likely `scripts/entity-phase-2-migration-cleanup-queues.mjs`, possibly `packages/server/src/index.ts` if API proof is needed.
  - **Verify:** `node scripts/entity-phase-2-migration-cleanup-queues.mjs --fixture-sample --out output/entity-phase-2/migration-cleanup-queues/THE-89.md && node scripts/entity-phase-2-migration-cleanup-queues.mjs --fixture-sample --json --out output/entity-phase-2/migration-cleanup-queues/THE-89.json`
- [x] Step 6: Run required proof commands.
  - **Verify:** `cd packages/server && npm run build && npx vitest run`, `npm run build`, `bash scripts/proof/entity-phase-2-smoke.sh`
- [ ] Step 7: Run CLI Tester request/run/book-review/verify if available and configured; stop on real fail-stop blockers.
  - **Verify:** `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json verify THE-89`
- [ ] Step 8: Commit only after proof and review pass, if requested by the supervisor flow.
  - **Verify:** `git status --short --branch`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 16:13Z | Setup | COMPLETE | Confirmed THE-88 handoff, clean worktree, and THE-89 issue mapping/context. |
| 16:13Z | Plan | COMPLETE | Created compaction-survivable THE-89 plan before implementation. |
| 16:14Z | Branch | COMPLETE | Created `THE-89-build-migration-warning-cleanup-queues` from approved THE-88 checkpoint. |
| 16:18Z | Step 1 | COMPLETE | Existing sources are `phase2_backfill`, `phase2_review_evidence_mapping`, task/accountability fields, activities, and document/artifact permission gaps; no cleanup queue API exists yet. |
| 16:19Z | Steps 2-5 | COMPLETE | Added DB cleanup queue/correction logic, API route, CLI proof script, and focused tests. |
| 16:20Z | Step 6 | COMPLETE | Server build/full Vitest, root build, and Phase 2 smoke proof all passed under Node 22. |
| 16:23Z | Step 7 | BLOCKED | CLI Tester request/run PASS under Node 22; Book review generated packet-only `REQUESTED` receipt with `safeToContinue=false`, so verify did not run. |

## Files Touched

- `docs/plans/2026-06-24T161330Z-entity-phase-2-the-89-migration-cleanup-queues-plan.md` - created - compaction-survivable THE-89 plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for THE-89.
- `packages/db/src/index.ts` - modified - THE-89 migration cleanup queue builder, human correction writer, and backfill correction protection.
- `packages/server/src/routes/migration-cleanup-queues.ts` - created - API route for cleanup queue listing and task correction.
- `packages/server/src/routes/migration-cleanup-queues.test.ts` - created - API visibility and correction tests.
- `packages/server/src/index.ts` - modified - mounts `/api/migration-cleanup-queues`.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - DB cleanup queue, correction idempotency, and no-fake-receipt test.
- `scripts/entity-phase-2-migration-cleanup-queues.mjs` - created - CLI proof report generator with isolated fixture sample mode.
- `output/entity-phase-2/migration-cleanup-queues/THE-89.md` - generated proof artifact (ignored).
- `output/entity-phase-2/migration-cleanup-queues/THE-89.json` - generated proof artifact (ignored).
- `output/entity-phase-2/test-gate/THE-89.json` - CLI Tester request/run receipt (ignored).
- `output/entity-phase-2/book-review/THE-89.json` - packet-only Book review request receipt (ignored).

## Resume Instructions

1. Re-read this file fully.
2. Run `git status --short --branch` and inspect diff.
3. Confirm branch is `THE-89-build-migration-warning-cleanup-queues`.
4. Find the first unchecked step above and continue there.
5. Preserve non-fabrication and correction-protection semantics: no fake raw receipts, unresolved warnings stay explicit, and human-corrected fields must not be overwritten by reruns.

## Done

- [ ] All steps complete.
- [x] Focused cleanup queue tests pass.
- [x] Human-corrected value idempotency test passes.
- [x] API/CLI proof artifact generated.
- [x] Required proof commands pass.
- [ ] Book review approves and verify gate passes. Blocked on packet-only Book review `REQUESTED` / `safeToContinue=false`.
