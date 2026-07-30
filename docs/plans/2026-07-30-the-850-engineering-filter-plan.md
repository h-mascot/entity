# THE-850 / EE-B-02 Engineering Filter Plan

## Task

Load and render only `work_domain=engineering` tasks in the Engineering board.

**Linear issue:** THE-850
**Status:** COMPLETE

## Context

- Work only in `/Users/enterprise/Code/entity-the-850-ee-b-02`.
- Base `46bed49` contains the proven EE-B-01 entry and all EE-A dependencies.
- Use the server-side `/tasks?work_domain=engineering` contract from EE-A-04.
- Keep the business/default Kanban task source and selection unchanged.
- Fail closed: malformed or unclassified tasks must never appear in Engineering.
- Browser proof must use controlled API data with both Engineering and business tasks.
- Non-production delivery is authorized after green gates; no production promotion, data mutation, or credentials.

## Plan

- [x] Verify THE-849 Done, THE-850 Todo, sole dependency satisfied, and create isolated worktree.
- [x] Add RED tests for the exact Engineering query, normalization, fail-closed filtering, and degraded errors.
- [x] Add a local-state domain task loader without overwriting the shared business-board store.
- [x] Render the Engineering `TaskBoard` from the domain loader on desktop/tablet/mobile.
- [x] Run app/server/root/CTRL gates and diff checks.
- [x] Capture browser proof showing Engineering tasks present and business tasks absent at desktop/mobile sizes.
- [x] Run independent reviews and close blockers RED-first.
- [x] Commit locally, write proof, reconcile Linear, update runner state, and advance.

## Verification

- `npm --prefix packages/app test && npm --prefix packages/app run build`
- `cd packages/server && npm run build && npx vitest run`
- `npm run build && npm run ctrl:gate && git diff --check`
- Browser: request includes `work_domain=engineering`; Engineering task appears; business task does not; degraded API state is visible.

## Files Touched

- `docs/plans/2026-07-30-the-850-engineering-filter-plan.md`
- `docs/plans/ACTIVE_PLAN.md`
- `packages/app/src/App.tsx`
- `packages/app/src/views/MobileView.tsx`
- `packages/app/src/components/TaskBoard.tsx`
- `packages/app/src/components/mission-control/MCEngineeringEntry.tsx`
- `packages/app/src/components/mission-control/MCOpsView.tsx`
- `packages/app/src/hooks/useTaskBoard.ts`
- `packages/app/src/lib/engineeringTasks.ts`
- `packages/app/src/lib/engineeringTasks.test.ts`
- `packages/app/src/lib/taskLoadingGuards.ts`
- `packages/app/src/lib/taskLoadingGuards.test.ts`

## Resume

Execution is complete. Preserve the shared all-task store and backend-atomic project assignment invariants.

## Done

- [x] Filter/degraded tests and builds pass
- [x] Browser proof exists
- [x] Review approved with 0 blockers
- [x] Local commit/proof and Linear reconciliation exist
