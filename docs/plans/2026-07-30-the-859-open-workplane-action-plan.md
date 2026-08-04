# Plan — THE-859 / WP1-A-04 Open Workplane from task detail

**MC Task:** THE-859  
**Created:** 2026-07-30  
**Agent:** cursor-grok-4.5-high-fast  
**Status:** COMPLETE

## Context

Add Open Workplane CTA on task detail navigating to `/workplane/:taskId` with THE-857 return context. Base: THE-858 `71e7350`.

## Dependencies

- [x] THE-858 / WP1-A-03 Done
- [x] workplaneUrlState + WorkplaneShell present in worktree

## Plan

- [x] Step 1: Helper `openWorkplaneFromTaskDetail.ts` + tests
  - **Verify:** focused node:test
- [x] Step 2: Wire CTA in TaskDetailPanel + App remount flag
  - **Verify:** app build
- [x] Step 3: Browser click-through proof
  - **Verify:** Playwright against isolated port 3034 PASS
- [x] Step 4: Receipts + commit + Linear Done + runner state 44/91

## Files Touched

- `packages/app/src/lib/openWorkplaneFromTaskDetail.ts`
- `packages/app/src/lib/openWorkplaneFromTaskDetail.test.ts`
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx`
- `packages/app/src/components/mission-control/taskDetailWorkplaneSeams.ts`
- `packages/app/src/App.tsx`
- `docs/context/entity-workplanes-open-action-the-859.md`
- `docs/plans/2026-07-30-the-859-open-workplane-action-plan.md`
- `docs/plans/ACTIVE_PLAN.md`

## Resume

Continue from first unchecked step. Do not touch `/Users/enterprise/Code/Entity`.
