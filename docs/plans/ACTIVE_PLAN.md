# THE-849 / EE-B-01 Engineering Entry Plan

Canonical plan: `docs/plans/2026-07-30-the-849-engineering-entry-plan.md`

## Task

Add an accessible Mission Control Engineering tab and honest pre-filter entry state.

**Linear issue:** THE-849
**Status:** COMPLETE

## Context

- Work only in `/Users/enterprise/Code/entity-the-849-ee-b-01`.
- Base `c83e96c` contains the proven Engineering project seed.
- EE-B-01 owns navigation/entry only; EE-B-02 owns domain task filtering.
- Do not show unfiltered business tasks as Engineering tasks.
- Browser screenshot/DOM proof is mandatory.
- No push, merge, deploy, production mutation, or secrets.

## Plan

- [x] Recover state, verify THE-848 Done, and create isolated worktree.
- [x] Add pure contract tests for the built-in Engineering tab and persisted selection.
- [x] Add the Engineering tab and an explicit empty/readiness entry state without implementing EE-B-02 filtering.
- [x] Run app build/tests, server gate, root/CTRL gate, and diff checks.
- [x] Build and run locally; collect desktop and mobile DOM/screenshot proof.
- [x] Run independent review and close blockers RED-first.
- [x] Commit locally, write proof, reconcile Linear, update runner state, and advance.

## Verification

- `npm --prefix packages/app test && npm --prefix packages/app run build`
- `cd packages/server && npm run build && npx vitest run`
- `npm run build && npm run ctrl:gate && git diff --check`
- Browser: Engineering tab visible, keyboard-selectable, selected state persists, no business tasks shown as Engineering.

## Files Touched

- `docs/plans/2026-07-30-the-849-engineering-entry-plan.md`
- `docs/plans/ACTIVE_PLAN.md`
- `packages/app/src/App.tsx`
- `packages/app/src/views/MobileView.tsx`
- `packages/app/src/components/mission-control/MCEngineeringEntry.tsx`
- `packages/app/src/lib/mcBoardTabs.ts`
- `packages/app/src/lib/mcBoardTabs.test.ts`

## Resume

Continue from the first unchecked step. Keep filtering out of scope until EE-B-02.

## Done

- [x] Tests and builds pass
- [x] Browser proof exists
- [x] Review approved with 0 blockers
- [x] Local commit/proof and Linear reconciliation exist
