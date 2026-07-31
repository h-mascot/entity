# Plan — THE-858 / WP1-A-03 Workplane route and shell

**MC Task:** THE-858  
**Created:** 2026-07-30  
**Agent:** cursor-grok-4.5-high-fast  
**Status:** COMPLETE

## Context

Add `/workplane/:taskId` route and a minimal shell container that parses/serializes THE-857 URL state (task id, active panel, selected proof, return context). No full panel implementations; no Open Workplane CTA (THE-859).

## Dependencies

- [x] THE-857 / WP1-A-02 Done (`1c61432` base) — `workplaneUrlState.ts`

## Plan

- [x] Step 1: Pure shell model (`workplaneShellModel.ts`) from URL parse + panel placeholders
  - **Verify:** unit tests for restore/default/invalid/return context — PASS
- [x] Step 2: `WorkplaneShell` React container + App early route return
  - **Verify:** app build PASS; shell renders from `/workplane/:id`
- [x] Step 3: Context doc + focused tests + browser/DOM proof
  - **Verify:** focused node:test 22 PASS; app build PASS; Playwright localhost:3033 screenshots
- [x] Step 4: Commit, receipts, Linear Done, status ready_for_next
  - **Verify:** receipts under `receipts/proof/WP1-A-03/`

## Files Touched

- `packages/app/src/lib/workplaneShellModel.ts`
- `packages/app/src/lib/workplaneShellModel.test.ts`
- `packages/app/src/components/workplane/WorkplaneShell.tsx`
- `packages/app/src/App.tsx`
- `docs/context/entity-workplanes-route-shell-the-858.md`
- `docs/plans/2026-07-30-the-858-workplane-route-shell-plan.md`
- `docs/plans/ACTIVE_PLAN.md`

## Resume Instructions

Issue complete. Next: THE-859 / WP1-A-04 Open Workplane action from task detail.
