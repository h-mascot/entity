## Task
Entity Phase 2 THE-58: implement customer-success overlay.

**MC Task:** THE-58
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** VERIFIED - COMMIT/LINEAR HANDOFF COMPLETE

## Context
Live Linear issue THE-58 is child issue THE-13.3 under THE-13 worktype registry and overlays. Scope is to add customer-success overlay fields for customer, health state, renewal/escalation marker, support context, SLA/customer-impact risk, and external-response risk. CS overlay validation must declare allowed fields/values, customer-impacting risk must be able to require review/gate, and search/indexable fields must be declared.

## Dependencies
- [x] Current run-state points to THE-58.
- [x] THE-57 completed, committed, and Linear Done.
- [x] Branch created from 4b58289: `THE-58-implement-customer-success-overlay`.
- [x] Existing customer-success registry entry and policy side-effect paths inspected before implementation.

## Plan

- [x] Step 1: Inspect THE-56/THE-57 registry implementation, customer-success entry, side-effect derivation, and tests.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** source reads complete
- [x] Step 2: Expand customer-success overlay fields and field validation.
  - **Files:** `packages/db/src/index.ts`
  - **Verify:** targeted tests for allowed values and indexable fields
- [x] Step 3: Map CS customer-impact/SLA/external-response overlay risk into policy side effects.
  - **Files:** DB policy helpers and tests
  - **Verify:** policy fixture shows review/gate behavior where applicable
- [x] Step 4: Add focused overlay validation and policy/search fixture tests.
  - **Files:** `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/__tests__/db-repositories.test.ts`
- [x] Step 5: Run required proof commands.
  - **Files:** no source edits expected
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`
- [x] Step 6: Run CLI Tester request/run/book-review/verify and apply packet-mode local approval only if scans are 0/0 and diff is issue-scoped.
  - **Files:** `output/entity-phase-2/test-gate/THE-58.*`, `output/entity-phase-2/book-review/THE-58*`
  - **Verify:** CLI Tester verify reports PASS and `nextChildBlocked=false`
- [x] Step 7: Comment Linear, mark THE-58 Done, update run-state to THE-59, and commit only scoped source/test/plan changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/tests/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 02:17Z | Setup | done | Read live child issue; branch created from THE-57 commit. |
| 03:18Z | Implementation | done | CS registry fields, policy side effects, and focused tests added. |
| 03:20Z | Proof | done | Smoke, root build, server build, and full Vitest passed. |
| 03:23Z | Gate | done | CLI Tester request/run/book-review/verify passed; packet-mode local approval applied after 0/0 scans. |
| 03:24Z | Linear/run-state | done | THE-58 proof comment posted, Linear Done, run-state advanced to THE-59. |

## Files Touched
- `docs/plans/2026-06-24-021700-entity-phase-2-the-58-customer-success-overlay-plan.md` - created - THE-58 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-58 plan.
- `packages/db/src/index.ts` - modified - customer-success registry fields and policy side-effect derivation.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - customer-success overlay validation and policy/search tests.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-58 scoped to customer-success overlay fields, validation, and policy/search fixture behavior. Do not add unrelated overlay UI.

## Done
- [x] All steps complete
- [x] Tests/build pass
- [x] CLI Tester request/run/book-review/verify complete
- [x] Linear THE-58 proof comment added and status moved to Done
- [x] Run-state advanced to THE-59
