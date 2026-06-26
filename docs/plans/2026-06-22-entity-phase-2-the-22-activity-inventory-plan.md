# Entity Phase 2 THE-22 Activity Inventory Plan

## Task
Execute `THE-22` (`THE-6.2`) by producing a read-only inventory of current activity log, event, comment, and provenance storage and mapping it against the Phase 2 target `ActivityEvent` spine.

**MC Task:** THE-22
**Created:** 2026-06-22
**Agent:** Cursor
**Status:** IN PROGRESS

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution pack plan.

`THE-22` is a child of `THE-6` with no blockers. `THE-21` is complete and Book-approved. Scope is documentation/inventory only: no source schema changes and no production mutation.

## Dependencies
- [x] `THE-21` is unblocked with approved Book receipts and `nextChildBlocked=false`.
- [x] Live Linear body confirms `THE-22` maps to `THE-6.2`.
- [x] Parent epic confirms Slice 0 inventory is unblocked.
- [x] Repo inventory identifies current event/provenance producers, consumers, tables, and payload shapes.
- [x] Activity inventory document exists under `docs/context/`.
- [x] Required proof commands and CLI Tester gates pass or block with receipts.

## Plan
- [x] Step 1: Confirm issue mapping, parent, and dependency safety.
  - **Files:** Linear `THE-22`, `THE-6`, `output/entity-phase-2/test-gate/THE-21.json`
  - **Verify:** `linear_api.py get-issue THE-22` and `linear_api.py get-issue THE-6`
- [x] Step 2: Inventory current activity/provenance storage and producers.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/index.ts`, `packages/server/src/agent/**`, `packages/app/src/hooks/useActivityStream.ts`
  - **Verify:** targeted code reads/searches only, no source edits
- [x] Step 3: Write current-state activity inventory and Phase 2 event mapping.
  - **Files:** `docs/context/entity-phase-2-activity-provenance-inventory.md`
  - **Verify:** document covers tables, event sources, payload shapes, enum coverage, and provenance risks
- [x] Step 4: Run proof and gate commands.
  - **Files:** proof receipts under `output/entity-phase-2/`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, `cd packages/server && npm run build && npx vitest run`, and CLI Tester request/run/book-review/verify
- [x] Step 5: Update Linear proof comment and local run state.
  - **Files:** `.cursor/run-state/entity-phase-2.json`
  - **Verify:** Linear comment URL or blocker recorded

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 13:24 | Step 1 | done | Linear child and parent fetched with local helper; `THE-21` approved receipt confirms continuation. |
| 13:36 | Steps 2-3 | done | Activity/provenance surfaces inventoried and `docs/context/entity-phase-2-activity-provenance-inventory.md` written. |
| 13:33 | Step 4 | blocked | Repo proof commands and machine gate pass; Book review is packet-only `REQUESTED`, `safeToContinue=false`, so continuation is blocked. |
| 13:36 | Step 5 | done | Linear blocker/proof comment posted: `ab7ee623-951e-451a-bfb7-15f4b7bf33b9`. |

## Blocker

`THE-22` implementation/proof is complete locally, but the required Book-review gate is not approved. `output/entity-phase-2/book-review/THE-22.json` reports `status=BLOCKED`, `decision=REQUESTED`, `safeToContinue=false`, and `mode=packet`. `output/entity-phase-2/test-gate/THE-22.json` reports `reviewGateStatus=BLOCKED` and `nextChildBlocked=true`. Do not start `THE-23` until an approved Book receipt exists or Henry explicitly waives this gate.

## Files Touched
- `docs/plans/2026-06-22-entity-phase-2-the-22-activity-inventory-plan.md` - created - compaction-safe plan for current issue.
- `docs/plans/ACTIVE_PLAN.md` - modified - points to current execution plan.
- `.cursor/run-state/entity-phase-2.json` - modified - local-only runtime state.
- `docs/context/entity-phase-2-activity-provenance-inventory.md` - created - THE-22 inventory output.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Continue from the first unchecked step above.
5. Do not redo completed Linear or proof steps.

## Done
- [ ] All steps complete.
- [x] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass.
- [x] Linear proof comment added.
- [ ] `THE-23` identified as next candidate only after verify allows continuation.
