## Active Plan

Canonical plan: `docs/plans/2026-07-30-the-851-engineering-create-defaults-plan.md`

## Task

Default task creation from the Engineering board to the canonical Engineering project and fail closed when that project is unavailable.

**Linear issue:** THE-851 / EE-B-03
**Created:** 2026-07-30
**Agent:** GPT-5.6 Sol
**Status:** COMPLETE

## Context

THE-850 now filters the Engineering board by resolved primary-project domain. A task created from that board must therefore submit the canonical Engineering project as its primary project; otherwise it disappears from the board. The normal task-create flow must retain its existing defaults.

## Dependencies

- [x] THE-850 is merged and Linear Done.
- [x] Live THE-851 and parent THE-825 were reread.
- [x] Work is isolated at `/Users/enterprise/Code/entity-the-851-ee-b-03`.

## Plan

- [x] Characterize the create modal, project option API, and Engineering tab context.
  - **Verify:** `rg "MCCreateTaskModal|projectIds|mcBoardTab" packages/app/src`
- [x] Add RED tests for canonical Engineering project selection and missing-project failure.
  - **Files:** `packages/app/src/components/mission-control/taskCreateDefaults.test.ts`
  - **Verify:** `npm --prefix packages/app run test:unit -- taskCreateDefaults`
- [x] Wire context-sensitive Engineering defaults without changing normal-board defaults.
  - **Files:** `projectOptions.ts`, `taskCreateDefaults.ts`, `MCCreateTaskModal.tsx`, `App.tsx`
  - **Verify:** focused tests and app build
- [x] Capture create-task API/UI proof for success and missing-project degraded behavior.
  - **Verify:** browser DOM assertions and screenshots
- [x] Run full gates, independent reviews, commit/PR/merge, reconcile Linear, and advance.
  - **Verify:** `npm run ctrl:gate`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 09:52 | Dependency | ✅ | THE-850 merged as `27207d2`; Linear Done |
| 09:55 | Characterize | ✅ | Modal submits `projectIds`; project options currently hide Engineering |
| 10:05 | Implement | ✅ | RED-first defaults, project identity, fail-closed modal, preserve Engineering board |
| 10:07 | Proof | ✅ | Real API/browser success and missing-project degraded screenshots |
| 10:16 | Review | ✅ | Correctness and product/UX re-reviews APPROVED, 0 blockers |

## Files Touched

- `docs/plans/2026-07-30-the-851-engineering-create-defaults-plan.md` — execution plan
- `docs/plans/ACTIVE_PLAN.md` — recovery copy
- `packages/app/src/App.tsx` — passes Engineering create context and preserves board after create
- `packages/app/src/components/mission-control/MCCreateTaskModal.tsx` — applies and enforces domain defaults
- `packages/app/src/components/mission-control/projectOptions.ts` — retains project key/domain identity
- `packages/app/src/components/mission-control/projectOptions.test.ts` — project option regressions
- `packages/app/src/components/mission-control/taskCreateDefaults.ts` — pure default resolver
- `packages/app/src/components/mission-control/taskCreateDefaults.test.ts` — success/normal/degraded defaults

## Resume Instructions

1. Re-read this file and `git status`.
2. Continue from the first unchecked step.
3. Keep ordinary task creation unchanged.
4. Engineering creation must fail closed rather than create an unclassified task.

## Done

- [x] Engineering modal defaults the canonical Engineering project
- [x] Normal modal defaults remain unchanged
- [x] Missing Engineering project is explicit and prevents submit
- [x] API/UI proof and full gates pass
- [x] Reviews approved, merged, and Linear reconciled
