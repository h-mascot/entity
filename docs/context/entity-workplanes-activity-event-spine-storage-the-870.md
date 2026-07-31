# THE-870 / WP1-C-02 — ActivityEvent spine task-scoped storage/API

**Decision:** IMPLEMENTED  
**Date:** 2026-07-31  
**Worktree:** `/Users/enterprise/Code/entity-the-870-wp1-c-02`  
**Depends on:** THE-869 / WP1-C-01 (ActivityEvent spine types)

## Purpose

Add additive storage and HTTP append/query for Workplane ActivityEvent spine events scoped to a single task, so THE-871 can render the activity/progress panel without inventing runner-specific models (grill Q38/Q46).

## Module

| Path | Role |
| --- | --- |
| `packages/db/src/activity-event-spine-store.ts` | Additive table + repository (append/list/delete) |
| `packages/db/src/activity-event-spine-store.test.ts` | Success, empty, fail-closed, purge coverage |
| `packages/db/src/index.ts` | Schema ensure on bootstrap; purge on `deleteTask`; re-exports |
| `packages/server/src/activity-spine-events.ts` | Service + router for task-scoped spine API |
| `packages/server/src/activity-spine-events.test.ts` | API tests including empty state |
| `packages/app/.../taskDetailWorkplaneSeams.ts` | Seam note: storage ready; panel UI still THE-871 |

## Storage

Table `task_activity_spine_events` (CREATE IF NOT EXISTS only):

- `task_id`, `event_type` (spine only), `actor_type`, `actor_principal_id`
- `event_timestamp`, `payload_ref`, `payload_json`, `sequence`
- Unique `(task_id, sequence)`; ordered by `sequence ASC, id ASC`
- Deleted with the parent task (id-recycle safety)

## API

- `GET /tasks/:id/activity-spine-events` → `{ taskId, events, empty, degraded, warnings, permissionState }`
- `POST /tasks/:id/activity-spine-events` → `{ event, permissionState, degraded }`
- Org scope via `x-entity-org-id` / `orgId` (403 fail-closed, no event content)

## Contract

- Only THE-869 spine types accepted: `plan|progress|log|proof|status|blocker`
- Unknown/missing type → `{ ok: false, degraded: true, reason: unknown_or_missing_event_type }`
- Sequence auto-assigned when omitted; explicit duplicate sequence rejected
- Empty task stream returns `empty: true` with `events: []` (visible empty state)
- Does not replace legacy `/tasks/:id/activity-events` feed

## Non-goals honored

- No Workplane activity/progress panel UI (THE-871)
- No agent/progress adapters (THE-872+)
- No review-gate enforcement / comments checklist
- No destructive DB reset; additive schema only
- No production mutation
