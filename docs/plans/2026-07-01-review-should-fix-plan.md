## Task
Fix three SHOULD-FIX code review findings: task board pagination, file moved refresh, and async router rejection forwarding.

**MC Task:** N/A
**Created:** 2026-07-01
**Agent:** GPT-5.5
**Status:** COMPLETE

## Context
User requested minimal diffs on branch `cursor/entity-10x-implementation-1879`, no commit/push, TypeScript strict, colocated tests where practical, and final validation with server build+Vitest, app build, and app tests.

## Dependencies
- [x] Step 1 has no dependencies
- [x] Step 2 depends on inspecting `useTaskBoard` task response handling
- [x] Step 3 depends on confirming server file event type strings
- [x] Step 4 depends on inspecting existing async handler and route tests
- [x] Step 5 depends on Steps 2-4

## Plan

- [x] Step 1: Inspect cited files, event strings, async middleware, and nearby tests.
  - **Files:** `packages/app/src/hooks/useTaskBoard.ts`, `packages/app/src/components/FileTree.tsx`, `packages/server/src/routes/task-review-gates.ts`, `packages/server/src/task-master-claims.ts`, `packages/server/src/activity-events.ts`, `packages/server/src/routes/agent-registry.ts`
  - **Verify:** `git status --short`
- [x] Step 2: Make task board reload accumulate paginated `/tasks` envelopes until `hasMore` is false while preserving array response compatibility.
  - **Files:** `packages/app/src/hooks/useTaskBoard.ts`
  - **Verify:** `npm --prefix packages/app run test`
- [x] Step 3: Refresh the file tree on move/rename WebSocket events emitted by the server.
  - **Files:** `packages/app/src/components/FileTree.tsx`
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 4: Wrap cited async Express route handlers and add one focused rejection route test.
  - **Files:** `packages/server/src/routes/task-review-gates.ts`, `packages/server/src/task-master-claims.ts`, `packages/server/src/activity-events.ts`, `packages/server/src/routes/agent-registry.ts`, server colocated test
  - **Verify:** `cd packages/server && npx vitest run <focused-test>`
- [x] Step 5: Run full requested validation.
  - **Files:** all touched files
  - **Verify:** `cd packages/server && npm run build && npx vitest run`; `npm --prefix packages/app run build`; `npm --prefix packages/app run test`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 23:33 | Step 1 | in progress | Cited files and nearby tests inspected. |
| 23:36 | Steps 2-4 | complete | Pagination, file event refresh, async wrappers, and rejection route test added. |
| 23:37 | Step 5 | complete | Server build+Vitest passed: 93 files, 643 tests. App build passed. App tests passed: 10 tests. |

## Files Touched
- `docs/plans/2026-07-01-review-should-fix-plan.md` — created — recovery plan
- `docs/plans/ACTIVE_PLAN.md` — updated — active recovery plan
- `packages/app/src/hooks/useTaskBoard.ts` — modified — paged task reload accumulation
- `packages/app/src/components/FileTree.tsx` — modified — file move/rename refresh triggers
- `packages/server/src/routes/task-review-gates.ts` — modified — async route wrappers
- `packages/server/src/task-master-claims.ts` — modified — async route wrapper
- `packages/server/src/task-master-claims.test.ts` — modified — rejecting route JSON 500 proof
- `packages/server/src/activity-events.ts` — modified — async route wrappers
- `packages/server/src/routes/agent-registry.ts` — modified — async route wrappers

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there; do not redo completed steps

## Done
- [x] All steps complete
- [x] Tests pass
- [x] No commit/push performed
