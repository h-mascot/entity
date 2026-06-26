## Task

**MC Task:** THE-88
**Created:** 2026-06-24T16:55:00+01:00
**Agent:** gpt-5.5
**Status:** BLOCKED_PENDING_BOOK_REVIEW

## Context

Implement THE-19.3 from the migration/backfill parent. THE-88 maps existing legacy review packets, evidence fields, output artifacts, and activity logs into Phase 2 structured migration artifacts/events where possible.

Branch: `THE-88-map-review-packets-evidence-structured`
Linear: `THE-88` / parent `THE-19`

Supervisor context says THE-87 is approved to continue under a narrow fast-path waiver and must not be re-blocked for THE-88 launch. THE-88 remains scoped to conservative migration mapping only: no fake raw receipts, no broad db-layer policy changes, no THE-89 cleanup queue implementation.

## Dependencies

- [x] Worktree started clean on `THE-87-backfill-required-hierarchy-accountability-fields`.
- [x] Required Phase 2 repo context read: `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, build context, canonical PRD, gap matrix, Linear issue map, and THE-88 draft.
- [x] THE-88 mapping confirmed: source `THE-19.3`, Linear UUID `823be3cc-a1f7-46b2-b447-d9bb87039337`, parent `THE-19`.
- [x] Prior THE-86/THE-87 migration/report patterns inspected.
- [x] Scoped THE-88 branch created from the clean THE-87 checkpoint.

## Plan

- [x] Step 1: Inspect current migration inventory/backfill code, review packet metadata shape, receipt metadata, and activity-event migration seams.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/__tests__/db-repositories.test.ts`, `scripts/entity-phase-2-migration-inventory.mjs`, `scripts/entity-phase-2-task-backfill.mjs`
  - **Verify:** `rg "review_packet|review_brief|missing_receipt|phase2_backfill|structured" packages scripts`
- [x] Step 2: Implement a conservative THE-88 migration mapper/report surface.
  - **Files:** likely `packages/db/src/index.ts`, `scripts/entity-phase-2-review-evidence-mapping.mjs`
  - **Verify:** `npm --prefix packages/db run build`
- [x] Step 3: Add focused migration fixture tests for mapped evidence, missing receipts, weak activity structure, and no fake raw receipt creation.
  - **Files:** likely `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/__tests__/db-repositories.test.ts`
- [x] Step 4: Generate THE-88 proof samples, including a missing_receipt sample and mapping report.
  - **Files:** `output/entity-phase-2/review-evidence-mapping/THE-88*.{md,json}` (ignored)
  - **Verify:** `node scripts/entity-phase-2-review-evidence-mapping.mjs --out output/entity-phase-2/review-evidence-mapping/THE-88.md && node scripts/entity-phase-2-review-evidence-mapping.mjs --json --out output/entity-phase-2/review-evidence-mapping/THE-88.json`
- [x] Step 5: Run required proof commands.
  - **Files:** build/test output, smoke output
  - **Verify:** `cd packages/server && npm run build && npx vitest run`, `npm run build`, `bash scripts/proof/entity-phase-2-smoke.sh`
- [ ] Step 6: Run CLI Tester request/run/book-review/verify if available and configured; stop on real fail-stop blockers.
  - **Files:** `output/entity-phase-2/test-gate/THE-88.*`, `output/entity-phase-2/book-review/THE-88*`
  - **Verify:** `/Users/enterprise/Code/cli-tester/bin/project-test-gate --root /Users/enterprise/Code/entity --config /Users/enterprise/Code/entity/.project-gate.json verify THE-88`
- [ ] Step 7: Update Linear proof comment/status if tooling is available; otherwise record blocker and local proof paths.
  - **Files:** Linear comment or local proof receipt notes
  - **Verify:** `git status --short --branch`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 16:52 | Setup | COMPLETE | Confirmed clean starting branch `THE-87-backfill-required-hierarchy-accountability-fields`; read required context and prior THE-86/THE-87 plans. |
| 16:55 | Plan | COMPLETE | Created compaction-survivable THE-88 plan before implementation. |
| 16:57 | Focused tests | COMPLETE | `npm --prefix packages/db run build` passed; focused DB repository Vitest passed under Node 22 after initial Node ABI mismatch on the default shell Node. |
| 16:58 | Proof samples | COMPLETE | Generated `output/entity-phase-2/review-evidence-mapping/THE-88.md` and `.json` with fixture `missing_receipt` and weak activity samples. |
| 16:59 | Required proof | COMPLETE | Server build/Vitest, root build, and `scripts/proof/entity-phase-2-smoke.sh` passed under Node 22. |
| 17:01 | CLI Tester | BLOCKED | request/run passed, but Book review returned `BLOCKED` / `REQUESTED` with `safeToContinue=false`; verify not run. |

## Files Touched

- `docs/plans/2026-06-24T165500Z-entity-phase-2-the-88-review-evidence-mapping-plan.md` - created - compaction-survivable THE-88 plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution pointer for THE-88.
- `packages/db/src/index.ts` - modified - THE-88 conservative review/evidence mapping report and task metadata audit writer.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - migration fixture test for structured mapping, missing_receipt, weak activity, idempotency, and no fake raw receipts.
- `scripts/entity-phase-2-review-evidence-mapping.mjs` - created - CLI report writer with isolated fixture sample mode.
- `output/entity-phase-2/review-evidence-mapping/THE-88.md` - generated proof artifact (ignored).
- `output/entity-phase-2/review-evidence-mapping/THE-88.json` - generated proof artifact (ignored).
- `output/entity-phase-2/test-gate/THE-88.json` - CLI Tester request/run receipt (ignored).
- `output/entity-phase-2/book-review/THE-88.json` - Book review blocked receipt (ignored).

## Resume Instructions

1. Re-read this file fully.
2. Run `git status --short --branch` and inspect diff.
3. Confirm branch is `THE-88-map-review-packets-evidence-structured` or create it from the clean THE-87 checkpoint if still on THE-87.
4. Find the first unchecked step above and continue there.
5. Preserve conservative migration semantics: no fake raw receipts, missing historical receipts must be `missing_receipt`, weak activity structure must remain explicit, and THE-89 cleanup queues must not be implemented here.

## Done

- [ ] All steps complete.
- [x] Focused migration fixture tests pass.
- [x] Missing_receipt sample generated.
- [x] Required proof commands pass.
- [x] CLI Tester request/run and Book receipts captured; verify blocked by Book `safeToContinue=false`.
- [x] Linear update unavailable/skipped by CLI Tester receipt (`linearComment.skipped=true`).
