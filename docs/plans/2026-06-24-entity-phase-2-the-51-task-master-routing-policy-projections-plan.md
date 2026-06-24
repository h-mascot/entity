## Task
Implement THE-51 / THE-12.1: Add Task Master routing policy projections.

**MC Task:** THE-51  
**Created:** 2026-06-24  
**Agent:** Cursor  
**Status:** IN PROGRESS

## Context
THE-51 requires Task Master drivability, stall thresholds, notification routes, escalation eligibility, reassignment eligibility, and high-risk exclusions to be represented as cached policy projections rather than standalone truth. Live Linear body confirms this is child issue THE-12.1 under THE-12.

## Dependencies
- [x] Step 1 has no dependencies.
- [ ] Step 2 depends on existing policy resolver context in `packages/db/src/index.ts`.
- [ ] Step 3 depends on Step 2 implementation.
- [ ] Step 4 depends on tests/build passing.
- [ ] Step 5 depends on CLI Tester run/book-review/verify receipts.

## Plan

- [x] Step 1: Confirm Linear scope, branch, and existing policy resolver.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, `packages/db/src/index.ts`
  - **Verify:** `git status --short --branch`
- [x] Step 2: Add explicit Task Master routing policy projection from resolved policy.
  - **Files:** `packages/db/src/index.ts`
  - **Verify:** `cd packages/server && npx vitest run src/__tests__/db-repositories.test.ts`
- [x] Step 3: Add schema/projection tests for drivable and high-risk exclusion fixtures.
  - **Files:** `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/__tests__/db-repositories.test.ts`
- [ ] Step 4: Run proof commands and commit scoped THE-51 work.
  - **Files:** all changed files
  - **Verify:** `cd packages/server && npm run build && npx vitest run`; `npm run build`; `bash scripts/proof/entity-phase-2-smoke.sh`
- [ ] Step 5: Run CLI Tester request/run/book-review/verify and update Linear/run-state.
  - **Files:** `output/entity-phase-2/test-gate/THE-51.json`, `output/entity-phase-2/book-review/THE-51.json`, `.cursor/run-state/entity-phase-2.json`
  - **Verify:** `project-test-gate verify THE-51`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 00:22 | Step 1 | Done | THE-50 complete; run-state advanced to THE-51; THE-51 branch created. |
| 01:26 | Step 2 | Done | Added `routing_policy_projection` with drivable, thresholds, routes, escalation/reassignment eligibility, high-risk exclusion reasons, and provenance. |
| 01:26 | Step 3 | Done | Focused DB suite passes: `cd packages/server && npx vitest run src/__tests__/db-repositories.test.ts` -> 56/56. |

## Files Touched
- `docs/plans/2026-06-24-entity-phase-2-the-51-task-master-routing-policy-projections-plan.md` — created — compaction-safe plan
- `docs/plans/ACTIVE_PLAN.md` — will mirror this plan for resume
- `packages/db/src/index.ts` — modified — Task Master routing projection resolver/cache
- `packages/server/src/__tests__/db-repositories.test.ts` — modified — projection and high-risk exclusion tests

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections.
5. Continue from there; do not redo completed steps.

## Done
- [ ] All steps complete
- [ ] Tests pass
- [ ] Linear proof comment posted
