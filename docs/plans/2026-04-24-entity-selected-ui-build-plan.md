# Entity Selected UI Build Plan

## Task
Build the selected Entity UI directions from the 2026-04-24 design review artifact pack.

**MC Task:** n/a
**Created:** 2026-04-24
**Agent:** Codex
**Status:** COMPLETE

## Context
Use `docs/design-reviews/2026-04-24-entity-ui-upgrade/selected-ui-picks.json` as the source of truth. Chat has no approved image pick and should only receive conservative cleanup. Existing local changes touch `package.json`, `packages/app/src/App.tsx`, and `packages/app/src/components/mission-control/TaskDetailPanel.tsx`; preserve them.

## Dependencies
- [x] Step 1 has no dependencies.
- [x] Step 2 depends on Step 1 shared visual classes.
- [x] Step 3 depends on the Files pilot building successfully.
- [x] Step 4 depends on view slice implementation.
- [x] Step 5 depends on app build and visual script availability.

## Plan

- [x] Step 1: Add shared dense ops-console visual primitives and the Files pilot.
  - **Files:** `packages/app/src/index.css`, `packages/app/src/components/UnifiedFileDashboard.tsx`
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 2: Upgrade Tasks board and Task Detail using selected Set 1 direction.
  - **Files:** `packages/app/src/components/TaskBoard.tsx`, `packages/app/src/components/mission-control/MCOpsView.tsx`, `packages/app/src/components/mission-control/MCHeader.tsx`, `packages/app/src/components/mission-control/TaskDetailPanel.tsx`
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 3: Upgrade Agents, Agent Detail, Services, Admin, Docs View, and conservative Chat cleanup.
  - **Files:** `packages/app/src/components/AgentDashboardV2.tsx`, `packages/app/src/components/EntityServicesBoard.tsx`, `packages/app/src/components/Chat/*`, `packages/app/src/App.tsx`, admin/settings components as needed
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 4: Add visual smoke script for the requested desktop views.
  - **Files:** `packages/app/scripts/visual-smoke.cjs`, `packages/app/package.json`
  - **Verify:** `npm --prefix packages/app run test:visual`
- [x] Step 5: Final verification and screenshots.
  - **Files:** generated artifacts only
  - **Verify:** `npm --prefix packages/app run build && npm --prefix packages/app run test:visual`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 19:50 | Plan | ✅ | Plan created before implementation. |
| 19:54 | Step 1 | ✅ | Shared visual classes and Files dashboard pilot build cleanly. |
| 20:10 | Step 2 | ✅ | Tasks board and Task Detail slice returned with passing build. |
| 20:16 | Step 3 | ✅ | Agents, Services/Admin, Docs, and conservative Chat cleanup merged with passing build. |
| 20:30 | Step 4 | ✅ | `test:visual` added and passing across all requested desktop views. |
| 20:31 | Step 5 | ✅ | Final `build && test:visual` gate passed. |

## Files Touched
- `docs/plans/2026-04-24-entity-selected-ui-build-plan.md` — created — compaction-safe execution plan.
- `docs/plans/ACTIVE_PLAN.md` — modified — active copy of this plan.
- `packages/app/src/index.css` — modified — shared dense ops-console visual primitives.
- `packages/app/src/components/UnifiedFileDashboard.tsx` — modified — Files dashboard pilot using Set 1 direction.
- `packages/app/src/components/TaskBoard.tsx` — modified — shared ops surface on board root.
- `packages/app/src/components/mission-control/MCHeader.tsx` — modified — denser task header/search/tabs.
- `packages/app/src/components/mission-control/MCOpsView.tsx` — modified — task status strip hierarchy.
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` — modified — task detail state row, evidence/docs link grouping, panel polish.
- `packages/app/src/components/AgentDashboardV2.tsx` — modified — fleet and selected-agent hierarchy.
- `packages/app/src/components/AgentsSidebarTab.tsx` — modified — denser readable agent rail states.
- `packages/app/src/components/EntityServicesBoard.tsx` — modified — services severity hierarchy and registry states.
- `packages/app/src/components/plugins/PluginAdminPanel.tsx` — modified — plugin registry/detail hierarchy.
- `packages/app/src/components/Chat/*` — modified — conservative chat hierarchy, empty/error/composer cleanup.
- `packages/app/src/App.tsx` — modified — Admin and Docs View shell polish.
- `packages/app/src/components/MarkdownPreview.tsx` — modified — docs typography/readability polish.
- `packages/app/scripts/visual-smoke.cjs` — created — desktop visual smoke harness.
- `packages/app/package.json` — modified — adds `test:visual`.
- `packages/app/artifacts/visual-smoke/` — generated — visual smoke screenshots and summary.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. If a step is partially done, check "Files Touched" and "Checkpoints".
5. Continue from there; do not redo completed steps.

## Done
- [x] All steps complete
- [x] Tests pass
- [x] Visual smoke screenshots generated
