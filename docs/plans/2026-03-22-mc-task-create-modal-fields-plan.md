# Plan: Mission Control Task Creation Modal Fields

## Task
Upgrade the Mission Control new task modal to include assignee, due date, priority, projects, column, task name, description, and recurring, and persist the new fields through the API.

**MC Task:** #___  
**Created:** 2026-03-22  
**Agent:** Codex  
**Status:** VERIFICATION BLOCKED BY PRE-EXISTING TEST FAILURES

## Context
- User requested the Mission Control UI task creation modal be upgraded to include all Phase 1.8 fields.
- `packages/app` appears to own the Mission Control UI and `packages/server` + `packages/db` own persistence.
- Repo instructions require an on-disk plan for multi-step work and require colocated tests plus `cd packages/server && npx vitest run` after any `packages/server/` edits.
- Current worktree has unrelated local changes in `packages/db/entity-tasks.db`, `packages/db/entity-tasks.db-wal`, and untracked `patch.js`; do not revert them.

## Dependencies
- [x] Step 1 has no dependencies
- [x] Step 2 depends on Step 1 identifying the active modal/form component and API contract
- [x] Step 3 depends on Step 2 UI payload changes and the server/db contract for create/update
- [ ] Step 4 depends on Steps 2 and 3 being implemented

## Plan

- [x] Step 1: Inspect the Mission Control create-task UI and the existing task create/update contract
  - **Files:** `packages/app/src/components/TaskBoard.tsx`, `packages/app/src/components/mission-control/*`, `packages/app/src/hooks/useTaskBoard.ts`, `packages/server/src/index.ts`, `packages/db/src/index.ts`
  - **Verify:** `rg -n "createTask\\(|app.post\\(tasksBase|taskId/projects|due_date|projectIds" packages/app/src packages/server/src packages/db/src -S`
- [x] Step 2: Implement the modal/form fields and send the expanded task payload from the app
  - **Files:** `packages/app/src/components/mission-control/*`, `packages/app/src/components/TaskBoard.tsx`, `packages/app/src/hooks/useTaskBoard.ts`
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 3: Persist due date, priority, assignee, column, recurring, and project links on the server/db side and add/update tests
  - **Files:** `packages/server/src/index.ts`, `packages/server/src/*.test.ts`, `packages/db/src/index.ts`
  - **Verify:** `cd packages/server && npx vitest run`
- [ ] Step 4: Run the required verification gate and update plan status for handoff
  - **Files:** `docs/plans/2026-03-22-mc-task-create-modal-fields-plan.md`, `docs/plans/ACTIVE_PLAN.md`
  - **Verify:** `cd packages/server && npm run build && npx vitest run`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 01:11 PDT | Plan setup | ✅ | Created task plan and identified likely UI, hook, server, and DB touchpoints. |
| 01:18 PDT | Step 1 | ✅ | Located the current create-task entrypoint in `App.tsx` and identified `TaskDetailPanel.tsx` as the existing source for required task fields. |
| 01:20 PDT | Steps 2-3 | ✅ | Added `MCCreateTaskModal`, extended app payloads for `due_date`, `recurring`, and `projectIds`, and updated server routes to persist project links during create/update. |
| 01:21 PDT | Step 4 | ⚠️ | `npm --prefix packages/app run build` and `cd packages/server && npm run build` passed. Full `cd packages/server && npx vitest run` is still failing due unrelated pre-existing suites (dist CommonJS test pickup, `brief` DB column mismatch, docs path assumptions, unrelated plugin/swarm tests). |

## Files Touched
- `docs/plans/2026-03-22-mc-task-create-modal-fields-plan.md` — created — persistent execution plan for this task
- `docs/plans/ACTIVE_PLAN.md` — modified — points ACTIVE_PLAN at the current task
- `packages/app/src/App.tsx` — modified — replaced prompt-based task creation with modal state/rendering
- `packages/app/src/components/mission-control/MCCreateTaskModal.tsx` — created — new Mission Control task creation modal with full Phase 1.8 fields
- `packages/app/src/hooks/useTaskBoard.ts` — modified — sends `due_date`, `recurring`, and `projectIds` in task create/update payloads
- `packages/app/src/lib/offline.ts` — modified — keeps offline optimistic task records aligned with due-date and recurring fields
- `packages/server/src/index.ts` — modified — accepts `projectIds` and `due_at`/`due_date` aliases in task create/update flows and keeps legacy project labels in sync
- `packages/server/src/task-projects.ts` — created — helper for project label + assignment sync logic
- `packages/server/src/task-projects.test.ts` — created — colocated tests for the new server helper

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to inspect current state.
3. Check whether the current task modal lives in `packages/app/src/components/mission-control` or `packages/app/src/App.tsx`.
4. Find the first unchecked step above.
5. Continue from there without reverting unrelated local DB or scratch-file changes.

## Done
- [ ] All steps complete
- [ ] Tests pass (if applicable)
- [ ] MC task moved to review
- [ ] ACTIVE_PLAN.md cleared or updated for next task
