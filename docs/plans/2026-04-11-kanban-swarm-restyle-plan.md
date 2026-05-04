# Task Plan — Kanban Swarm Restyle

## Task
Make the Mission Control kanban board look as close as possible to the Swarm board without breaking task-board behavior.

**MC Task:** #___  
**Created:** 2026-04-11  
**Agent:** Codex  
**Status:** IN PROGRESS

## Context
- The user wants the Mission Control kanban board UI to feel much closer to the cleaner Swarm board UI.
- The relevant app surfaces live in `packages/app/src/components/TaskBoard.tsx`, `packages/app/src/components/mission-control/`, and the scoped stylesheet injected by `packages/app/src/hooks/useMCData.ts`.
- The repo already has unrelated local changes, so this task must avoid destructive cleanup and keep edits tightly scoped to the Mission Control app UI.
- `docs/plans/ACTIVE_PLAN.md` is shared with another agent, so this task is tracked only in this dated plan file.
- The goal is visual convergence: column shells, board spacing, header chrome, card treatment, and empty states should resemble Swarm while preserving existing Mission Control interactions.

## Dependencies
- [x] Step 1 has no dependencies
- [ ] Step 2 depends on Step 1 output (confirmed file ownership and visual reference)
- [ ] Step 3 depends on Step 2 output (restyle implemented in app components/CSS)
- [ ] Step 4 depends on Step 3 output (build verification succeeds)

## Plan

- [x] Step 1: Inspect Swarm and Mission Control board structure and capture the restyle approach
  - **Files:** `docs/context/entity-context.md`, `packages/app/src/components/SwarmBoard.tsx`, `packages/app/src/components/TaskBoard.tsx`, `packages/app/src/components/mission-control/MCHeader.tsx`, `packages/app/src/components/mission-control/MCOpsView.tsx`, `packages/app/src/components/mission-control/KanbanColumn.tsx`, `packages/app/src/components/mission-control/MCTaskCard.tsx`, `packages/app/src/components/mission-control/mcSourceStyles.css`
  - **Verify:** `rg -n "SwarmBoard|MCOpsView|KanbanColumn|MCTaskCard|mcSourceStyles" packages/app/src`
- [x] Step 2: Update Mission Control shell and kanban presentation to mirror Swarm board styling
  - **Files:** `packages/app/src/components/TaskBoard.tsx`, `packages/app/src/components/mission-control/MCHeader.tsx`, `packages/app/src/components/mission-control/MCOpsView.tsx`, `packages/app/src/components/mission-control/KanbanColumn.tsx`, `packages/app/src/components/mission-control/MCTaskCard.tsx`, `packages/app/src/components/mission-control/mcSourceStyles.css`
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 3: Review the rendered structure for consistency and trim any overly aggressive styling differences
  - **Files:** `packages/app/src/components/mission-control/MCHeader.tsx`, `packages/app/src/components/mission-control/MCOpsView.tsx`, `packages/app/src/components/mission-control/KanbanColumn.tsx`, `packages/app/src/components/mission-control/MCTaskCard.tsx`, `packages/app/src/components/mission-control/mcSourceStyles.css`
  - **Verify:** `git diff -- packages/app/src/components/TaskBoard.tsx packages/app/src/components/mission-control/MCHeader.tsx packages/app/src/components/mission-control/MCOpsView.tsx packages/app/src/components/mission-control/KanbanColumn.tsx packages/app/src/components/mission-control/MCTaskCard.tsx packages/app/src/components/mission-control/mcSourceStyles.css`
- [x] Step 4: Build the app and report the outcome with assumptions/risks
  - **Files:** `docs/plans/2026-04-11-kanban-swarm-restyle-plan.md`
  - **Verify:** `npm --prefix packages/app run build`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 22:18 | Step 1 | ✅ | Loaded Entity context and mapped Swarm vs Mission Control board files |
| 22:24 | Coordination | ✅ | Restored shared `ACTIVE_PLAN.md`; this task continues from the dated plan file only |
| 22:28 | Step 2 | ✅ | Restyled Mission Control shell, columns, and cards toward the Swarm board visual language |
| 22:29 | Step 3 | ✅ | Trimmed hover/drop states and reviewed the targeted diff for behavior-safe visual changes |
| 22:29 | Step 4 | ✅ | `npm --prefix packages/app run build` passed |
| 22:27 | Browser | ✅ | Local browser check against `http://127.0.0.1:4173/` with live backend proxy confirmed the updated board (`display:flex`, 5 columns, 264px columns) and saved screenshot to `artifacts/kanban-live-check-2026-04-11.png` |
| 22:28 | Public | ✅ | Public runtime check against `http://100.104.229.62:3000/` confirmed it is still serving the older board (`display:grid`, 280px columns) and saved screenshot to `artifacts/kanban-public-live-check-2026-04-11.png` |

## Files Touched
- `docs/plans/2026-04-11-kanban-swarm-restyle-plan.md` — created — durable execution plan for the UI restyle task
- `artifacts/kanban-live-check-2026-04-11.png` — created — screenshot of the updated kanban board in a local live browser session
- `artifacts/kanban-public-live-check-2026-04-11.png` — created — screenshot of the current public runtime for comparison

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps

## Done
- [x] All steps complete
- [x] App build passes
