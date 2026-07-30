# THE-858 / WP1-A-03 — Workplane route and shell container

**Decision:** IMPLEMENTED (route + minimal shell; panels placeholder)
**Date:** 2026-07-30
**Worktree:** `/Users/enterprise/Code/entity-the-858-wp1-a-03`
**Depends on:** THE-857 / WP1-A-02 (`workplaneUrlState`)
**Open Workplane CTA:** not implemented (THE-859)

## Purpose

Register the single-task Workplane deep link and a minimal shell that reads/writes THE-857 URL state:

| Surface | Role |
| --- | --- |
| Route | `/workplane/:taskId` (+ query from THE-857) |
| Shell | Task id, panel tabs, selected proof, return context wiring |
| Panels | Placeholder bodies only (WP1-B/C implement content) |

## Modules

| Path | Role |
| --- | --- |
| `packages/app/src/lib/workplaneShellModel.ts` | Pure resolve/serialize helpers for shell view model |
| `packages/app/src/components/workplane/WorkplaneShell.tsx` | Shell UI container |
| `packages/app/src/App.tsx` | Early route return + Doc Hub sync guards |

## Behavior

- Valid `/workplane/:positiveInt` → ready shell; parse defaults invalid panel/proof/return
- Invalid `/workplane` / non-integer id → fail-closed invalid shell (not silent healthy)
- Panel tab click → `serializeWorkplaneUrlState` via `history.replaceState`
- Return context present → Return control wired to `returnContext.href` (THE-860 expands)
- App Doc Hub URL sync skips `/workplane` paths so deep links are not rewritten

## Non-goals honored

- No Open Workplane action from task detail (THE-859)
- No full summary/proof/review/activity panel implementations
- No invented Engineering board data
- No production mutation / secrets exposure

## Consumers

1. THE-859 — Open Workplane navigates into this route
2. THE-860 — Return navigation polish on shell return control
3. THE-861 — Refresh restore already covered by parse + shell mount
4. WP1-B/C — Replace panel placeholders with real panel bodies
