# THE-861 / WP1-A-06 — Deep-link refresh restores task and active panel

**Decision:** IMPLEMENTED
**Date:** 2026-07-30
**Worktree:** `/Users/enterprise/Code/entity-the-861-wp1-a-06`
**Depends on:** THE-860 / WP1-A-05 (return navigation)

## Purpose

A user who opens or hard-refreshes a Workplane deep link must see the same task id and active panel after reload. Restore is driven only by `pathname` + `search` (THE-857). In-memory `history.state` from THE-859/860 is not required.

## Modules

| Path | Role |
| --- | --- |
| `packages/app/src/lib/workplaneRefreshRestore.ts` | Cold-load restore + gate bypass helpers |
| `packages/app/src/components/workplane/WorkplaneShell.tsx` | Mounts restore model; exposes `data-workplane-restored-from-url` |
| `packages/app/src/App.tsx` | Workplane deep link mounts ahead of onboarding gates |

## Behavior

- Valid `/workplane/:taskId?panel=...` → ready shell with matching `taskId` + `activePanel`
- Omitted/invalid panel → default `task_summary` (task id preserved)
- Invalid/missing task id → fail-closed `invalid_route` (no crash)
- `/workplane/*` bypasses personal/business onboarding so refresh is not swallowed
- Return context / proof tokens continue to round-trip via THE-857 serialize/parse

## Non-goals honored

- No WP1-B panel body implementations beyond existing placeholders
- No THE-862+ work
- No invented Engineering data / prod DB mutation

## Proof surface

- Focused tests: `workplaneRefreshRestore.test.ts` (+ existing URL/shell suites)
- Browser: direct visit + `location.reload()` asserting task id + active panel attributes
