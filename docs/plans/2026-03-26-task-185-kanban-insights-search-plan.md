# Task Plan — Task 185 Kanban / Insights / Search

## Task
Implement MC Task 185: convert the Kanban/Insights toggle to tabs with Kanban as the default, move dashboard content into Insights, add dashboard stats/metrics in Insights, and add global search in the header. Verify with tests.

**MC Task:** #185  
**Created:** 2026-03-26  
**Agent:** Codex  
**Status:** IN PROGRESS

## Context
- Scope is primarily `packages/app` Mission Control UI.
- User stated DB schema is already updated.
- Repository instructions require planning for multi-step work and mandate test execution after server changes. Even if server code is untouched, verification is still required before reporting done.

## Dependencies
- [x] Step 1 has no dependencies
- [ ] Step 2 depends on Step 1 output (identified files and state flow)
- [ ] Step 3 depends on Step 2 output (implemented UI/data changes)
- [ ] Step 4 depends on Step 3 output (code compiles/tests pass)

## Plan

- [x] Step 1: Audit current Mission Control board/header implementation and task data sources
  - **Files:** `packages/app/src/App.tsx`, `packages/app/src/components/TaskBoard.tsx`, `packages/app/src/components/mission-control/MCHeader.tsx`, `packages/app/src/hooks/useTaskBoard.ts`, `packages/app/src/hooks/useMCData.ts`
  - **Verify:** `rg -n "Kanban|Insights|search|header|TaskBoard|MCHeader" packages/app/src -S`
- [x] Step 2: Implement tabs, Insights dashboard stats/metrics, and header search wiring
  - **Files:** `packages/app/src/App.tsx`, `packages/app/src/components/TaskBoard.tsx`, `packages/app/src/components/mission-control/MCHeader.tsx`, related helper/components as needed
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 3: Add or update tests for any touched server code, plus app-level verification where feasible
  - **Files:** `packages/server/src/**/*.test.ts` only if server files change
  - **Verify:** `cd packages/server && npx vitest run`
- [ ] Step 4: Final verification and plan closeout
  - **Files:** `docs/plans/2026-03-26-task-185-kanban-insights-search-plan.md`, `docs/plans/ACTIVE_PLAN.md`
  - **Verify:** `cd packages/server && npm run build && npx vitest run`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 10:36 | Step 1 | ⏳ | Plan created, starting code audit |
| 10:48 | Step 1 | ✅ | Audited TaskBoard, shell header, task search, and Insights data flow |
| 11:02 | Step 2 | ✅ | Renamed built-in task tab to Kanban, added inline global search, and replaced Insights sidebar with dashboard stats/metrics |
| 11:06 | Step 3 | ✅ | `npm --prefix packages/app run build` passed; `cd packages/server && npm run build && npx vitest run` failed in pre-existing server tests unrelated to this UI change |

## Files Touched
- `docs/plans/2026-03-26-task-185-kanban-insights-search-plan.md` — created — execution plan for Task 185
- `docs/plans/ACTIVE_PLAN.md` — modified — active execution pointer for compaction recovery
- `packages/app/src/App.tsx` — modified — renamed built-in task tab to Kanban and moved task search into the shell header
- `packages/app/src/components/mission-control/MCHeader.tsx` — modified — tabs now read as a tablist and mobile search matches global search copy
- `packages/app/src/components/mission-control/MCOpsView.tsx` — modified — Insights now renders the dashboard component and surfaces errors consistently
- `packages/app/src/components/mission-control/MCInsightsDashboard.tsx` — created — dashboard stats, metrics, due-today, attention, and capacity panels for Insights

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps

## Done
- [ ] All steps complete
- [ ] Tests pass (if applicable) — blocked by unrelated existing server Vitest failures
- [ ] MC task moved to review
- [ ] ACTIVE_PLAN.md cleared or updated for next task
