## Task
Entity Phase 2 THE-59: implement people/HR overlay.

**MC Task:** THE-59
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** VERIFIED - COMMIT/LINEAR HANDOFF COMPLETE

## Context
Live Linear issue THE-59 is child issue THE-13.4 under THE-13 worktype registry and overlays. Scope is to add people overlay fields for candidate/employee reference, workflow stage, sensitivity class, HR side-effect type, checklist state, and approval requirement. People overlay validation must validate allowed fields/values, HR sensitivity must tighten permissions and be able to require a human gate, and restricted snippets/previews must be suppressed.

## Dependencies
- [x] Current run-state points to THE-59.
- [x] THE-58 completed, committed, and Linear Done.
- [x] Branch created from 01285bf: `THE-59-implement-peoplehr-overlay`.
- [x] Existing registry, sensitivity, side-effect, and preview/snippet suppression paths inspected before implementation.

## Plan

- [x] Step 1: Inspect worktype registry, policy sensitivity hooks, restricted preview behavior, and DB repository tests.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** source reads/search complete
- [x] Step 2: Add people/HR overlay registry entry and field validation.
  - **Files:** `packages/db/src/index.ts`
  - **Verify:** targeted validation tests for allowed fields/values
- [x] Step 3: Map HR sensitivity/approval/side-effect fields into policy review/human gate behavior.
  - **Files:** DB policy helpers and tests
  - **Verify:** policy fixture shows sensitivity tightening and human gate behavior
- [x] Step 4: Suppress restricted snippets/previews in the policy/search fixture path.
  - **Files:** DB repository helpers/tests
  - **Verify:** restricted fixture returns no exposed snippet/preview field
- [x] Step 5: Run required proof commands.
  - **Files:** no source edits expected
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`
- [x] Step 6: Run CLI Tester request/run/book-review/verify and apply packet-mode local approval only if scans are 0/0 and diff is issue-scoped.
  - **Files:** `output/entity-phase-2/test-gate/THE-59.*`, `output/entity-phase-2/book-review/THE-59*`
  - **Verify:** CLI Tester verify reports PASS and `nextChildBlocked=false`
- [x] Step 7: Comment Linear, mark THE-59 Done, update run-state to THE-60, and commit only scoped source/test/plan changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/tests/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 03:25Z | Setup | done | Read live child issue; branch created from THE-58 commit. |
| 03:27Z | Implementation | done | People registry fields, HR policy side effects, and restricted preview tests added. |
| 03:29Z | Proof | done | Initial smoke had transient unrelated agent-api 401; failing file passed on rerun, smoke rerun passed, root build and server build/full Vitest passed. |
| 03:34Z | Gate | done | CLI Tester request/run/book-review/verify passed; verify passed after retrying transient agent-api ECONNRESET. |
| 03:35Z | Linear/run-state | done | THE-59 proof comment posted, Linear Done, run-state advanced to THE-60. |

## Files Touched
- `docs/plans/2026-06-24-032500-entity-phase-2-the-59-peoplehr-overlay-plan.md` - created - THE-59 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-59 plan.
- `packages/db/src/index.ts` - modified - people worktype registry and HR policy side-effect derivation.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - people overlay validation, policy, and restricted preview tests.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-59 scoped to people/HR overlay fields, validation, policy sensitivity/gate behavior, and restricted snippet/preview suppression. Do not add unrelated UI.

## Done
- [x] All steps complete
- [x] Tests/build pass
- [x] CLI Tester request/run/book-review/verify complete
- [x] Linear THE-59 proof comment added and status moved to Done
- [x] Run-state advanced to THE-60
