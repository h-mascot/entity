## Task
Entity Phase 2 THE-56: implement worktype registry schema and versioning.

**MC Task:** THE-56
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** VERIFIED - COMMIT/LINEAR HANDOFF COMPLETE

## Context
Live Linear issue THE-56 is child issue THE-13.1 under THE-13 worktype registry and overlays. Scope is backend/schema-focused: replace untyped `worktype_overlay` assumptions with a registry defining schema name/version, fields, allowed values, risk defaults, indexability, sensitivity, and plan labels. Unknown/legacy overlays must degrade safely, and overlay validation must be runnable on create/update.

## Dependencies
- [x] Current run-state points to THE-56.
- [x] THE-55 completed, committed, and Linear Done.
- [x] Branch created from 447806a: `THE-56-implement-worktype-registry-schema-and-versioning`.
- [x] Existing task metadata/worktype overlay paths inspected before implementation.

## Plan

- [x] Step 1: Inspect existing task metadata, policy/worktype overlay usage, DB schema, and test conventions.
  - **Files:** likely `packages/db/src/index.ts`, `packages/server/src/index.ts`, related tests
  - **Verify:** source reads complete
- [x] Step 2: Add a typed/versioned worktype registry and safe overlay validator.
  - **Files:** DB/server modules selected from existing ownership
  - **Verify:** targeted TypeScript build or colocated tests
- [x] Step 3: Wire validation into task create/update without broad behavior drift.
  - **Files:** task create/update path only if needed
  - **Verify:** create/update tests cover valid, unknown legacy, and invalid overlays
- [x] Step 4: Add focused schema/type tests and registry fixture coverage.
  - **Files:** colocated server/db tests
  - **Verify:** `cd packages/server && npx vitest run <changed tests>`
- [x] Step 5: Run required proof commands.
  - **Files:** no source edits expected
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`
- [x] Step 6: Run CLI Tester request/run/book-review/verify and apply packet-mode local approval only if scans are 0/0 and diff is issue-scoped.
  - **Files:** `output/entity-phase-2/test-gate/THE-56.*`, `output/entity-phase-2/book-review/THE-56*`
  - **Verify:** CLI Tester verify reports PASS and `nextChildBlocked=false`
- [x] Step 7: Comment Linear, mark THE-56 Done, update run-state to THE-57, and commit only scoped source/test/plan changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/tests/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 02:01Z | Setup | done | Read live child issue; branch created from THE-55 commit. |
| 02:04Z | Steps 1-4 | done | Added DB worktype registry, overlay validation, create/update validation hooks, and repository tests for valid/invalid/legacy overlays. |
| 02:05Z | Proof | done | Smoke, root build, server build, targeted tests, and full Vitest passed under Node 22. |
| 02:07Z | Gate | done | CLI Tester request/run/book-review/verify complete; packet-mode Book review locally approved after 0/0 scans and scoped diff audit. |
| 02:08Z | Linear/run-state | done | Linear proof comment posted, THE-56 moved Done, run-state advanced to THE-57. |

## Files Touched
- `docs/plans/2026-06-24-020100-entity-phase-2-the-56-worktype-registry-schema-versioning-plan.md` - created - THE-56 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-56 plan.
- `packages/db/src/index.ts` - modified - worktype registry schema/versioning, overlay validator, create/update validation.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - registry/defaults and overlay validation tests.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-56 scoped to worktype registry schema/versioning and overlay validation. Do not implement business-ops overlay UI unless the live issue scope changes.

## Done
- [x] All steps complete
- [x] Tests/build pass
- [x] CLI Tester request/run/book-review/verify complete
- [x] Linear THE-56 proof comment added and status moved to Done
- [x] Run-state advanced to THE-57
