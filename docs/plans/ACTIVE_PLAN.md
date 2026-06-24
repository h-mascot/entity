## Task
Entity Phase 2 THE-61: implement layered RBAC, ACL, and sensitivity evaluator.

**MC Task:** THE-61
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** COMPLETE

## Context
Live Linear issue THE-61 is child issue THE-14.1 under THE-14 permissions, sensitivity, and search envelope. Scope is a permission/sensitivity evaluator for org/team/project inheritance, object ACL tightening, and sensitive categories across tasks/docs/artifacts/activity/search/notifications. Denied access must not leak restricted content.

## Dependencies
- [x] Current run-state points to THE-61.
- [x] THE-60 completed, committed, and Linear Done.
- [x] Branch created from 610b859: `THE-61-implement-layered-rbac-acl-and-sensitivity-evaluator`.
- [x] Existing task, document, artifact, activity, and search surfaces inspected before implementation.

## Plan

- [x] Step 1: Add a focused server-side permission evaluator with typed principal grants, object scopes, object ACLs, sensitivity categories, and no-leak denial envelopes.
  - **Files:** `packages/server/src/permissions.ts`
  - **Verify:** colocated unit tests compile and cover allow/deny reasons
- [x] Step 2: Add RBAC/sensitivity tests for inherited org/team/project roles, object-level tightening, sensitive category requirements, cross-org denial, and redacted denial results.
  - **Files:** `packages/server/src/permissions.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/permissions.test.ts`
- [x] Step 3: Run required proof commands, GitNexus detect-changes, and CLI Tester request/run/book-review/verify.
  - **Files:** `output/entity-phase-2/test-gate/THE-61.*`, `output/entity-phase-2/book-review/THE-61*`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`; CLI Tester verify PASS
- [x] Step 4: Comment Linear, mark THE-61 Done, update run-state to THE-62, and commit only scoped source/test/plan changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/test/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 04:00Z | Setup | done | Read live child issue; branch created from THE-60 completion commit. |
| 04:02Z | Implementation | done | Added pure permission evaluator and 6 focused RBAC/sensitivity/no-leak tests; focused Vitest passed. |
| 04:06Z | Proof/gate | done | Smoke, root build, server build + full Vitest passed; CLI Tester verify PASS after packet-mode local approval. |
| 04:07Z | Linear/run-state | done | Final proof comment `5a6a712f-f7b1-4945-bc90-4209f96c25d1`; Linear state Done; run-state advanced to THE-62. |

## Files Touched
- `docs/plans/2026-06-24-040000-entity-phase-2-the-61-layered-rbac-acl-sensitivity-evaluator-plan.md` - created - THE-61 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-61 plan.
- `packages/server/src/permissions.ts` - created - layered RBAC/ACL/sensitivity evaluator.
- `packages/server/src/permissions.test.ts` - created - RBAC/sensitivity/cross-org denial tests.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Resume from THE-62 in `.cursor/run-state/entity-phase-2.json`; do not redo THE-61.

## Done
- [x] All steps complete
- [x] Tests/build pass
- [x] CLI Tester request/run/book-review/verify complete
- [x] Linear THE-61 proof comment added and status moved to Done
- [x] Run-state advanced to THE-62
