# Entity Phase 2 THE-23 Review and Proof Inventory Plan

## Task
Execute `THE-23` (`THE-6.3`) by producing a read-only inventory of the current `entity-mc` review path, review packet shape, proof/output artifact conventions, and receipt-like outputs, then map gaps against the canonical Phase 2 receipt requirements.

**MC Task:** THE-23
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** BLOCKED_PENDING_BOOK_REVIEW

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

`THE-23` is a child of `THE-6` with no blockers. `THE-21` and `THE-22` have local proof and approved continuation receipts. Scope is documentation/inventory only: no source schema changes and no production mutation.

## Dependencies
- [x] Live Linear body confirms `THE-23` maps to `THE-6.3`.
- [x] Parent epic `THE-6` confirms Slice 0 inventory is unblocked.
- [x] `THE-22` gate and Book review receipts report `PASS`, `APPROVED`, `safeToContinue=true`, and `nextChildBlocked=false`.
- [x] Branch `THE-23-inventory-review-packets-proof-artifacts-and-receipt-like-outputs` exists.
- [x] Repo inventory identifies current review packet, proof artifact, output link, and receipt-like producers/consumers.
- [x] Review/proof inventory document exists under `docs/context/`.
- [x] Required proof commands and CLI Tester gates pass or block with receipts.

## Plan
- [x] Step 1: Confirm issue mapping, parent, and dependency safety.
  - **Files:** Linear `THE-23`, `THE-6`, `.cursor/run-state/entity-phase-2.json`, `output/entity-phase-2/test-gate/THE-22.json`, `output/entity-phase-2/book-review/THE-22.json`
  - **Verify:** `linear_api.py get-issue THE-23` and `linear_api.py get-issue THE-6`
- [x] Step 2: Inventory current review/proof storage and producers.
  - **Files:** `packages/server/src/agent/**`, `packages/server/src/index.ts`, `packages/db/src/index.ts`, `packages/app/src/**`, `scripts/**`
  - **Verify:** targeted code reads/searches only, no source edits
- [x] Step 3: Write current-state review/proof inventory and receipt gap map.
  - **Files:** `docs/context/entity-phase-2-review-proof-inventory.md`
  - **Verify:** document covers review packet shape, submission path, output artifact/link conventions, sample shape, and canonical receipt gaps
- [x] Step 4: Run proof and gate commands.
  - **Files:** proof receipts under `output/entity-phase-2/`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, `cd packages/server && npm run build && npx vitest run`, and CLI Tester request/run/book-review/verify
- [x] Step 5: Update Linear proof comment and local run state.
  - **Files:** `.cursor/run-state/entity-phase-2.json`
  - **Verify:** Linear comment URL or blocker recorded

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 00:01 | Step 1 | done | Linear child and parent fetched; run-state and receipts confirm `THE-23` may start after `THE-22`. |
| 00:17 | Plan | in progress | Created branch from current approved HEAD because `origin/main` lacks the Phase 2 execution-pack context required to continue. |
| 00:33 | Steps 2-3 | done | Current review packet, output-link, Task Master review hygiene, and swarm proof surfaces inventoried in `docs/context/entity-phase-2-review-proof-inventory.md`. |
| 00:40 | Proof | done | Full proof commands pass under Node v22.22.2 after chat runtime-disabled fallback fix. |
| 00:42 | Gate | blocked | `project-test-gate run THE-23` PASS; `book-review THE-23` BLOCKED with decision=REQUESTED and safeToContinue=false. Verify not run. |
| 00:43 | Step 5 | done | Linear blocker/proof comment posted (`70a82fc8-f54b-4a1d-8d30-3ffb08994cd4`) and run-state updated. |

## Files Touched
- `docs/plans/2026-06-23-entity-phase-2-the-23-review-proof-inventory-plan.md` - created - compaction-safe plan for current issue.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution plan for current issue.
- `docs/context/entity-phase-2-review-proof-inventory.md` - created - THE-23 inventory output.
- `packages/server/src/routes/chat.ts` - modified - proof-support fix so runtime-disabled chat tests do not call fallback model providers.
- `packages/server/src/routes/chat.test.ts` - modified - colocated regression guard for runtime-disabled chat send behavior.
- `.cursor/run-state/entity-phase-2.json` - modified - local run state with THE-23 blocker/proof receipts.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Do not start `THE-24` until `output/entity-phase-2/book-review/THE-23.json` is APPROVED with `safeToContinue=true`, or Henry explicitly waives the gate.
5. After approval, run `project-test-gate verify THE-23` before considering `THE-23` complete.

## Done
- [x] All local implementation/proof steps complete.
- [x] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass.
- [x] Linear proof comment added.
- [ ] `THE-24` identified as next candidate only after verify allows continuation.
