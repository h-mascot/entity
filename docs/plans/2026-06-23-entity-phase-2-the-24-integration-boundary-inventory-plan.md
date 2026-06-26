# Entity Phase 2 THE-24 Integration Boundary Inventory Plan

## Task
Execute `THE-24` (`THE-6.4`) by producing a read-only inventory of current integration seams, configuration requirements, degraded states, and Phase 2 boundary risks for Helm/runtime status, ClickClack, Google Docs/Drive, and notification/channel delivery.

**MC Task:** THE-24  
**Created:** 2026-06-23  
**Agent:** Cursor  
**Status:** BLOCKED_ON_BOOK_REVIEW

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

`THE-24` is a child of `THE-6` with no explicit blockers. `THE-21`, `THE-22`, and `THE-23` have local proof and approved continuation receipts. Scope is documentation/inventory only: no source schema changes, no production mutation, no external connector mutation, and no credential values copied into docs.

## Dependencies
- [x] Live Linear body confirms `THE-24` maps to `THE-6.4`.
- [x] Parent epic `THE-6` confirms Slice 0 inventory is unblocked.
- [x] `THE-23` gate and Book review receipts report `PASS`, `APPROVED`, `safeToContinue=true`, and `nextChildBlocked=false`.
- [x] Branch `THE-24-inventory-integration-boundaries-helm-clickclack-google-docs-notifications` exists.
- [x] Repo inventory identifies current Helm/runtime, ClickClack, Google Docs/Drive, and notification/channel seams.
- [x] Integration boundary inventory document exists under `docs/context/`.
- [x] Required proof commands and CLI Tester gates pass or block with receipts.

## Plan
- [x] Step 1: Confirm issue mapping, parent, and dependency safety.
  - **Files:** Linear `THE-24`, `THE-6`, `.cursor/run-state/entity-phase-2.json`, `output/entity-phase-2/test-gate/THE-23.json`, `output/entity-phase-2/book-review/THE-23.json`
  - **Verify:** `linear_api.py get-issue THE-24` and `linear_api.py get-issue THE-6`
- [x] Step 2: Inventory current integration code paths and config.
  - **Files:** `packages/server/src/**`, `packages/app/src/**`, `packages/db/src/**`, `scripts/**`, relevant existing docs
  - **Verify:** targeted code reads/searches only, no source edits
- [x] Step 3: Write current-state integration boundary inventory and Phase 2 gap map.
  - **Files:** `docs/context/entity-phase-2-integration-boundary-inventory.md`
  - **Verify:** document covers current code paths/config, unavailable/degraded states, boundary risks, no credential values, and no external mutations
- [x] Step 4: Run proof and gate commands.
  - **Files:** proof receipts under `output/entity-phase-2/`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, `cd packages/server && npm run build && npx vitest run`, and CLI Tester request/run/book-review/verify. Local proof and machine gate passed; Book review is `REQUESTED`/blocked.
- [x] Step 5: Update Linear proof comment and local run state.
  - **Files:** `.cursor/run-state/entity-phase-2.json`
  - **Verify:** Linear comment `fa28115f-a574-42ae-9476-a16952aa8e06` recorded; blocker recorded

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 00:58 | Step 1 | done | Linear child and parent fetched; run-state and receipts confirm `THE-24` may start after `THE-23`. |
| 01:02 | Plan | in progress | Created branch from current approved Phase 2 HEAD and started local plan. |
| 01:19 | Steps 2-3 | done | Inventory artifact created and scanned for banned terms/credential-shaped values. |
| 01:06 | Step 4 | blocked | Proof commands and machine gate passed; Book review receipt is `REQUESTED` with `safeToContinue=false`; verify command exited 1 and continuation remains blocked. |
| 01:07 | Step 5 | done | Run-state updated and Linear proof/blocker comment posted: `fa28115f-a574-42ae-9476-a16952aa8e06`. |

## Files Touched
- `docs/plans/2026-06-23-entity-phase-2-the-24-integration-boundary-inventory-plan.md` - created - compaction-safe plan for current issue.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution plan for current issue.
- `docs/context/entity-phase-2-integration-boundary-inventory.md` - created - current-state integration boundary inventory and Phase 2 gap map.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Continue from the first unchecked step above.
5. Do not start `THE-25` until `THE-24` proof commands, CLI Tester `run`, `book-review`, and `verify` pass with `safeToContinue=true` and `nextChildBlocked=false`, or Henry explicitly waives the gate.

## Done
- [x] All local implementation/proof steps complete.
- [x] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass.
- [x] Linear proof comment added.
- [ ] `THE-25` identified as next candidate only after verify allows continuation.
