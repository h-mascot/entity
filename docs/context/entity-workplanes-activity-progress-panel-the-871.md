# THE-871 / WP1-C-03 — Workplane activity/progress panel

**Decision:** IMPLEMENTED  
**Date:** 2026-07-31  
**Worktree:** `/Users/enterprise/Code/entity-the-871-wp1-c-03`  
**Depends on:** THE-870 / WP1-C-02 (ActivityEvent spine storage/API)

## Purpose

Render task-scoped ActivityEvent spine events in the Workplane activity/progress panel so operators can see plan → progress → log → proof → status → blocker history without inventing runner-specific models (grill Q33/Q38/Q46).

## Module

| Path | Role |
| --- | --- |
| `packages/app/src/lib/workplaneActivityProgress.ts` | Normalize THE-870 API → panel bundle + load envelope |
| `packages/app/src/lib/workplaneActivityProgress.test.ts` | Empty / typed / degraded / shell wiring coverage |
| `packages/app/src/components/workplane/ActivityProgressPanel.tsx` | Presentational panel |
| `packages/app/src/components/workplane/WorkplaneShell.tsx` | Loads spine events; wires `activity_progress` panel |
| `packages/app/.../taskDetailWorkplaneSeams.ts` | Seam status → `reusable_now` |

## Contract

- Consumes `GET /tasks/:id/activity-spine-events` (THE-870).
- Spine types only: `plan|progress|log|proof|status|blocker`.
- Load states: `empty` / `loading` / `error` / `ready`.
- Empty stream → `ready` + `bundle.empty === true` with visible empty copy.
- Unknown event types skipped with degraded warnings (never coerced healthy).
- Incomplete proof events (`proof` without payload/ref) marked degraded; panel always `reviewReady: false`.
- Does not implement adapters, review gates, import mutations, or production promotion.

## Non-goals honored

- No agent/progress adapters (THE-872+)
- No comments/review checklist panel (THE-87x)
- No review-gate enforcement
- No production mutation
