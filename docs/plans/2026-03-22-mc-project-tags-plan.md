# Plan: Mission Control Project Tag Dropdown and Task Card Tags

## Task
Add a project tag dropdown to Mission Control task creation/editing flows, show the selected tags on MC task cards, and persist a canonical `projects` field through the app, server, and DB layers.

**MC Task:** #___  
**Created:** 2026-03-22  
**Agent:** Codex  
**Status:** VERIFICATION BLOCKED BY PRE-EXISTING SERVER TEST FAILURES

## Context
- User requested four project tags: `Soteria`, `Curacel`, `Personal`, and `Moltbot`.
- The repo already has uncommitted Mission Control work touching `packages/app`, `packages/server`, and `packages/db`; treat it as in-progress local state and build on top of it.
- Repo instructions require an on-disk plan for multi-step work.
- Any `packages/server/` code changes require colocated tests and a full `cd packages/server && npx vitest run` before reporting completion.

## Dependencies
- [x] Step 1 has no dependencies
- [ ] Step 2 depends on Step 1 identifying the current task shape and persistence path for project data
- [ ] Step 3 depends on Step 2 exposing a stable server/app contract for `projects`
- [ ] Step 4 depends on Steps 2 and 3 being implemented

## Plan

- [x] Step 1: Inspect the current Mission Control task model, card UI, and project persistence code paths
  - **Files:** `packages/app/src/components/mission-control/*`, `packages/app/src/hooks/useTaskBoard.ts`, `packages/server/src/index.ts`, `packages/server/src/task-projects.ts`, `packages/db/src/index.ts`
  - **Verify:** `rg -n "projectIds|projects|project_id|task_projects|MCTaskCard|MCCreateTaskModal" packages/app/src packages/server/src packages/db/src -S`
- [x] Step 2: Update DB and server layers to persist and return canonical `projects` data for the allowed project tags, with tests
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/index.ts`, `packages/server/src/task-projects.ts`, `packages/server/src/task-projects.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/task-projects.test.ts`
- [x] Step 3: Update Mission Control frontend flows to edit project tags via dropdown and render them on task cards
  - **Files:** `packages/app/src/components/mission-control/MCCreateTaskModal.tsx`, `packages/app/src/components/mission-control/MCTaskCard.tsx`, `packages/app/src/components/mission-control/TaskCard.tsx`, `packages/app/src/hooks/useTaskBoard.ts`, `packages/app/src/App.tsx`
  - **Verify:** `npm --prefix packages/app run build`
- [ ] Step 4: Run the required verification gates and update the plan for handoff
  - **Files:** `docs/plans/2026-03-22-mc-project-tags-plan.md`, `docs/plans/ACTIVE_PLAN.md`
  - **Verify:** `cd packages/server && npm run build && npx vitest run`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 01:34 PDT | Plan setup | ✅ | Created a fresh task plan and noted the existing uncommitted MC-related worktree state. |
| 01:43 PDT | Step 1 | ✅ | Confirmed that `projects` and `task_projects` already exist, the create modal already loads `/projects`, and the missing contract is a canonical task-level `projects` array plus inline card editing/rendering. |
| 02:19 PDT | Step 2 | ✅ | Seeded the four default project tags in the DB, attached `projects` onto task records, refreshed create/update API responses after task-project sync, and added DB/helper coverage. |
| 02:24 PDT | Step 3 | ✅ | Added structured `projects` handling in the task board store, shared project-option loading, tag rendering on MC cards, and inline card dropdown editing. |
| 02:25 PDT | Step 4 | ⚠️ | `packages/db` build, `packages/server` build, targeted server tests, and `packages/app` build all passed. Full `cd packages/server && npx vitest run` still fails in unrelated existing suites: `src/task-pagination.test.ts`, `src/plugins/routes.test.ts`, `src/__tests__/routes-docs.test.ts`, `src/__tests__/agent-api.test.ts`, and `src/swarm/routes.test.ts`. |

## Files Touched
- `docs/plans/2026-03-22-mc-project-tags-plan.md` — created — persistent execution plan for this task
- `docs/plans/ACTIVE_PLAN.md` — modified — points ACTIVE_PLAN at the current task
- `packages/db/src/index.ts` — modified — seeds the four default MC projects and attaches linked `projects` to task records
- `packages/db/src/cloud.ts` — modified — parses structured `projects` from API task payloads
- `packages/server/src/task-projects.ts` — created — task project helpers including project-name matching for filters
- `packages/server/src/task-projects.test.ts` — created — colocated coverage for project label parsing, filtering, and sync behavior
- `packages/server/src/index.ts` — modified — returns refreshed tasks with `projects` after create/update and filters tasks by structured project tags
- `packages/server/src/__tests__/db-repositories.test.ts` — modified — covers seeded default tags and task-level `projects` attachment in the DB layer
- `packages/app/src/components/mission-control/projectOptions.ts` — created — shared allowed-tag project option loader and sorter
- `packages/app/src/hooks/useTaskBoard.ts` — modified — normalizes structured `projects` on tasks and keeps optimistic task state aligned
- `packages/app/src/components/mission-control/utils/taskHelpers.ts` — modified — exposes task-project summary helpers for search/filter/render paths
- `packages/app/src/App.tsx` — modified — uses structured project tags for Mission Control search snippets and project filtering
- `packages/app/src/components/mission-control/MCOpsView.tsx` — modified — loads project tag options and updates task projects inline
- `packages/app/src/components/mission-control/KanbanColumn.tsx` — modified — passes project tag controls into MC task cards
- `packages/app/src/components/mission-control/MCTaskCard.tsx` — modified — renders project tags and provides an inline tag dropdown on each MC card
- `packages/app/src/components/mission-control/MCCreateTaskModal.tsx` — modified — reuses shared project tag option loading for the fixed MC tags
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` — modified — reuses shared project tag option loading and project normalization

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to inspect the current worktree.
3. Find the first unchecked step above.
4. Check the `Files Touched` and `Checkpoints` sections for current progress.
5. Continue from there without reverting unrelated local changes. If the goal is to clear Step 4, investigate only the unrelated failing suites listed in the latest checkpoint.

## Done
- [ ] All steps complete
- [ ] Tests pass (if applicable)
- [ ] MC task moved to review
- [ ] ACTIVE_PLAN.md cleared or updated for next task
