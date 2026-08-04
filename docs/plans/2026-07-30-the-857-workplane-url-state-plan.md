# Plan — THE-857 / WP1-A-02 Workplane URL state

**MC Task:** THE-857  
**Created:** 2026-07-30  
**Agent:** cursor-grok-4.5-high-fast  
**Status:** COMPLETE

## Context

Define pure typed Workplane URL state (task id, active panel, selected proof, return context) aligned with THE-856 panel ids. No route/UI.

## Dependencies

- [x] THE-856 / WP1-A-01 Done (`f71a625` base)

## Plan

- [x] Step 1: Implement `packages/app/src/lib/workplaneUrlState.ts`
  - **Verify:** module exports parse/serialize/normalize/defaults
- [x] Step 2: Unit tests for parse/serialize/round-trip/defaults/invalid
  - **Verify:** focused node:test pass
- [x] Step 3: Document schema in `docs/context/entity-workplanes-url-state-the-857.md`
- [x] Step 4: App build + commit + receipts + Linear Done

## Files Touched

- `packages/app/src/lib/workplaneUrlState.ts`
- `packages/app/src/lib/workplaneUrlState.test.ts`
- `docs/context/entity-workplanes-url-state-the-857.md`
- `docs/plans/2026-07-30-the-857-workplane-url-state-plan.md`
- `docs/plans/ACTIVE_PLAN.md`

## Resume

Continue from first unchecked step. Do not add App route wiring.
