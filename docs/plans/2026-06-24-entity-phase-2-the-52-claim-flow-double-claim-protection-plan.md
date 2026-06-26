## Task
Implement THE-52 / THE-12.2: Task Master claim flow and double-claim protection.

**MC Task:** THE-52
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** IN PROGRESS

## Context
Live Linear THE-52 requires Task Master to claim unassigned policy-drivable work, preserve the original unassigned state, prevent double claims/races, emit a structured `taskmaster_claimed` ActivityEvent, and make Task Master the current executor only for allowed work. Parent THE-12 confirms this issue is claim-only; nudges, owner escalation, auto-reassignment, and routing UI are later sibling tickets.

## Dependencies
- [x] Step 1 has no dependencies.
- [x] Step 2 depends on THE-51 routing policy projection being present.
- [x] Step 3 depends on existing task repository/sync-layer interfaces.
- [x] Step 4 depends on Step 3 service/API behavior.
- [x] Step 5 depends on implementation and focused tests.
- [ ] Step 6 depends on proof commands and CLI Tester receipts.

## Plan

- [x] Step 1: Confirm run-state, branch, live Linear child issue, and parent scope.
  - **Files:** `.cursor/run-state/entity-phase-2.json`
  - **Verify:** `git status --short --branch`; `linear_api.py get-issue THE-52`; `linear_api.py get-issue THE-12`
- [x] Step 2: Inspect existing ActivityEvent, task accountability, TaskRepository, and task routes.
  - **Files:** `packages/server/src/activity-events.ts`, `packages/server/src/task-accountability.ts`, `packages/db/src/index.ts`, `packages/db/src/task-sync.ts`, `packages/server/src/index.ts`
  - **Verify:** source reads complete; no implementation beyond THE-52 planned
- [x] Step 3: Add atomic Task Master claim transition to repository/sync layer.
  - **Files:** `packages/db/src/index.ts`, `packages/db/src/task-sync.ts`, `packages/db/src/local.ts`, `packages/db/src/cloud.ts`
  - **Verify:** `cd packages/server && npx vitest run src/__tests__/db-repositories.test.ts`
- [x] Step 4: Add claim service/API that logs structured `taskmaster_claimed` ActivityEvent.
  - **Files:** `packages/server/src/task-master-claims.ts`, `packages/server/src/index.ts`
  - **Verify:** `cd packages/server && npx vitest run src/task-master-claims.test.ts`
- [x] Step 5: Add focused claim API/service and double-claim race tests.
  - **Files:** `packages/server/src/task-master-claims.test.ts`, `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/task-master-claims.test.ts src/__tests__/db-repositories.test.ts`
- [ ] Step 6: Run proof commands, CLI Tester request/run/book-review/verify, commit, comment Linear, and advance run-state to THE-53 if proof supports Done.
  - **Files:** `output/entity-phase-2/test-gate/THE-52.*`, `output/entity-phase-2/book-review/THE-52*`, `.cursor/run-state/entity-phase-2.json`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`; `project-test-gate verify THE-52`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 02:08 | Step 1 | Done | Run-state currentIssue is THE-52; branch `THE-52-claim-flow-double-claim-protection` created from `1fae6c3`; live Linear issue is child THE-12.2 under THE-12. |
| 02:18 | Step 2 | Done | Existing code has `taskmaster_claimed` ActivityEvent type and THE-51 policy projection fields; no dedicated claim service exists yet. |
| 02:31 | Steps 3-5 | Done | Added atomic claim method, claim service/router, ActivityEvent payload, and focused double-claim tests. Focused tests pass with Node 22: `cd packages/server && npx vitest run src/task-master-claims.test.ts src/__tests__/db-repositories.test.ts` -> 63/63. |

## Files Touched
- `docs/plans/2026-06-24-entity-phase-2-the-52-claim-flow-double-claim-protection-plan.md` - created - compaction-safe THE-52 plan.
- `docs/plans/ACTIVE_PLAN.md` - modified - mirrors this plan for resume.
- `packages/db/src/index.ts` - modified - atomic Task Master claim transition and metadata preservation.
- `packages/db/src/task-sync.ts` - modified - claim method on sync interface.
- `packages/db/src/local.ts` - modified - local claim adapter.
- `packages/db/src/cloud.ts` - modified - cloud claim adapter.
- `packages/server/src/task-master-claims.ts` - created - claim service and API router.
- `packages/server/src/task-master-claims.test.ts` - created - service/API and double-claim tests.
- `packages/server/src/index.ts` - modified - claim route mounted.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - DB claim and race tests.
- `packages/server/src/agent/index.test.ts` - modified - TaskSyncLayer test double updated.
- `packages/server/src/agent/tools.test.ts` - modified - TaskSyncLayer test double updated.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections.
5. Continue from there; do not redo completed steps.

## Done
- [ ] All steps complete
- [ ] Focused tests pass
- [ ] Proof commands pass
- [ ] CLI Tester request/run/book-review/verify receipts exist
- [ ] Linear proof comment posted
- [ ] THE-52 marked Done
