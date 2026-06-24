## Task
Entity Phase 2 THE-55: build routing state UI and routing matrix docs.

**MC Task:** THE-55
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** VERIFIED - COMMIT/LINEAR HANDOFF COMPLETE

## Context
Live Linear issue THE-55 is child issue THE-12.5 under THE-12 Task Master routing. Scope is UI and docs: expose unassigned drivable, routing problem, claimed, nudged, owner escalated, auto-reassigned, and excluded states with policy reasons. It must explain Task Master is not the universal executor. This is UI-facing, so browser/DOM proof is required.

## Dependencies
- [x] Current run-state points to THE-55.
- [x] THE-51 through THE-54 routing backend slices are complete.
- [x] Branch created from 61ecb59: `THE-55-build-routing-state-ui-and-routing-matrix-docs`.
- [x] Existing task board/detail UI and docs patterns inspected before implementation.
- [x] Browser/DOM proof captured before Linear Done.

## Plan

- [x] Step 1: Inspect task board/detail UI, task shape, and docs locations.
  - **Files:** `packages/app/src/components/TaskBoard.tsx`, `packages/app/src/components/mission-control/TaskDetailPanel.tsx`, docs under `docs/`
  - **Verify:** source reads complete
- [x] Step 2: Add routing-state labels/reasons to task board/detail without adding controls beyond scope.
  - **Files:** likely task UI components and hook/task types
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 3: Add routing matrix docs explaining states and Task Master boundaries.
  - **Files:** docs path selected from existing docs conventions
  - **Verify:** docs file present and linked if appropriate
- [x] Step 4: Run proof commands and browser/DOM verification.
  - **Files:** no source edits expected
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`; local browser/DOM proof
- [x] Step 5: Run CLI Tester request/run/book-review/verify and apply packet-mode local approval only if scans are 0/0 and diff is issue-scoped.
  - **Files:** `output/entity-phase-2/test-gate/THE-55.*`, `output/entity-phase-2/book-review/THE-55*`
  - **Verify:** CLI Tester verify reports PASS and `nextChildBlocked=false`
- [x] Step 6: Comment Linear, mark THE-55 Done, update run-state to THE-56, and commit only scoped source/test/docs/plan changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/tests/docs plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 01:40Z | Setup | done | Read run-state and live child issue; branch created from THE-54 commit. |
| 02:22Z | UI/docs | done | Added shared routing-state view helper, card/detail routing displays, and routing matrix doc. |
| 02:52Z | Proof | done | Required smoke/root/server proof commands passed under Node 22; browser DOM proof captured at `output/entity-phase-2/ui-proof/THE-55-routing-state-ui-25.png`. |
| 02:57Z | Gate | done | CLI Tester request/run/book-review/verify complete; packet-mode Book review locally approved after 0/0 scans and scoped diff audit. |
| 02:59Z | Linear/run-state | done | Linear proof comment posted, THE-55 moved Done, run-state advanced to THE-56. |

## Files Touched
- `docs/plans/2026-06-24-014043-entity-phase-2-the-55-routing-state-ui-and-docs-plan.md` - created - THE-55 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-55 plan.
- `packages/app/src/components/mission-control/utils/routingState.ts` - created - derives routing labels, tones, and reasons from task policy/activity state.
- `packages/app/src/components/mission-control/MCTaskCard.tsx` - updated - shows compact routing badge and reason on board cards.
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` - updated - shows Task Master routing state, policy reason, principals, and reason chain in detail view.
- `docs/task-master-routing-matrix.md` - created - documents routing states and Task Master boundaries.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-55 scoped to routing-state display and docs. Do not add new routing backend behavior.

## Done
- [x] All steps complete
- [x] Tests/build pass
- [x] Browser/DOM proof captured
- [x] CLI Tester request/run/book-review/verify complete
- [x] Linear THE-55 proof comment added and status moved to Done
- [x] Run-state advanced to THE-56
