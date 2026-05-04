# Task Detail Compactness Plan

## Task
Compress Task Detail so high-value fields fit above the fold and section content starts immediately when selected.

**MC Task:** #490
**Created:** 2026-04-26
**Agent:** Codex
**Status:** IN PROGRESS

## Context
Browser review comments on `/task/490` call out excessive vertical spacing in the header, primary metadata, output, activity rows, and right section rail. The goal is an elegant dense ops-console panel, preserving existing save/update logic.

## Dependencies
- [x] Current Task Detail code is loaded from `packages/app/src/components/mission-control/TaskDetailPanel.tsx`
- [x] Layout changes must preserve current API calls and field save handlers
- [x] Verification depends on local dev server and visual smoke passing

## Plan

- [x] Step 1: Compact title and top metadata into two dense rows
  - **Files:** `packages/app/src/components/mission-control/TaskDetailPanel.tsx`
  - **Verify:** Browser screenshot of `/task/490`
- [x] Step 2: Collapse advanced estimate/time/blocker controls by default while keeping save logic wired
  - **Files:** `packages/app/src/components/mission-control/TaskDetailPanel.tsx`
  - **Verify:** Click advanced toggle, edit controls remain present
- [x] Step 3: Reposition Description/Output and section content so selected Activity/Logs/Comments/Subtasks/Links starts near the top
  - **Files:** `packages/app/src/components/mission-control/TaskDetailPanel.tsx`
  - **Verify:** Browser screenshot and tab-click checks
- [x] Step 4: Run verification
  - **Files:** visual smoke artifacts may update
  - **Verify:** `npm --prefix packages/app run build` and `npm --prefix packages/app run test:visual`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 20:55 | Plan | Started | Browser comments mapped to TaskDetailPanel layout |
| 21:16 | Steps 1-3 | ✅ | Compact header/body implemented; real browser screenshots reviewed |
| 21:18 | Step 4 | ✅ | Build and visual smoke passed |

## Files Touched
- `docs/plans/2026-04-26-task-detail-compactness-plan.md` — created — compaction-resume plan
- `docs/plans/ACTIVE_PLAN.md` — updated — active copy of this plan
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` — planned — compact Task Detail layout

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps

## Done
- [x] All steps complete
- [x] Tests pass
- [x] Browser screenshots reviewed
