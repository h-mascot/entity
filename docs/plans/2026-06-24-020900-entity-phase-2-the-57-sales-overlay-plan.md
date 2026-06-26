## Task
Entity Phase 2 THE-57: implement sales overlay.

**MC Task:** THE-57
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** VERIFIED - COMMIT/LINEAR HANDOFF COMPLETE

## Context
Live Linear issue THE-57 is child issue THE-13.2 under THE-13 worktype registry and overlays. Scope is to add sales/account worktype overlay fields such as account, deal stage, next action, stakeholder map, external-send risk, and CRM side-effect type. Sales overlay validation must declare allowed fields/values, contribute external-send/CRM risk to policy resolution, and declare search/indexable fields.

## Dependencies
- [x] Current run-state points to THE-57.
- [x] THE-56 completed, committed, and Linear Done.
- [x] Branch created from e7e80ad: `THE-57-implement-sales-overlay`.
- [x] Existing worktype registry and policy side-effect paths inspected before implementation.

## Plan

- [x] Step 1: Inspect THE-56 registry implementation, policy resolver risk hooks, and tests.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** source reads complete
- [x] Step 2: Add a sales overlay registry entry and field validation.
  - **Files:** `packages/db/src/index.ts`
  - **Verify:** targeted tests for allowed values and indexable fields
- [x] Step 3: Map sales external-send/CRM overlay fields into policy side-effect/risk resolution.
  - **Files:** DB policy helpers and tests
  - **Verify:** policy fixture shows review/human gate behavior where applicable
- [x] Step 4: Add focused overlay validation and policy/search fixture tests.
  - **Files:** `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/__tests__/db-repositories.test.ts`
- [x] Step 5: Run required proof commands.
  - **Files:** no source edits expected
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`
- [x] Step 6: Run CLI Tester request/run/book-review/verify and apply packet-mode local approval only if scans are 0/0 and diff is issue-scoped.
  - **Files:** `output/entity-phase-2/test-gate/THE-57.*`, `output/entity-phase-2/book-review/THE-57*`
  - **Verify:** CLI Tester verify reports PASS and `nextChildBlocked=false`
- [x] Step 7: Comment Linear, mark THE-57 Done, update run-state to THE-58, and commit only scoped source/test/plan changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/tests/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 02:09Z | Setup | done | Read live child issue; branch created from THE-56 commit. |
| 02:12Z | Steps 1-4 | done | Added sales registry fields, validation, derived external-send/CRM side effects, and focused policy/search tests. |
| 02:13Z | Proof | done | Smoke, root build, server build, targeted tests, and full Vitest passed under Node 22. |
| 02:15Z | Gate | done | CLI Tester request/run/book-review/verify complete; packet-mode Book review locally approved after 0/0 scans and scoped diff audit. |
| 02:16Z | Linear/run-state | done | Linear proof comment posted, THE-57 moved Done, run-state advanced to THE-58. |

## Files Touched
- `docs/plans/2026-06-24-020900-entity-phase-2-the-57-sales-overlay-plan.md` - created - THE-57 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-57 plan.
- `packages/db/src/index.ts` - modified - sales worktype registry and policy side-effect derivation.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - sales overlay validation and policy tests.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-57 scoped to sales/account overlay fields, validation, and policy/search fixture behavior. Do not add unrelated overlay UI.

## Done
- [x] All steps complete
- [x] Tests/build pass
- [x] CLI Tester request/run/book-review/verify complete
- [x] Linear THE-57 proof comment added and status moved to Done
- [x] Run-state advanced to THE-58
