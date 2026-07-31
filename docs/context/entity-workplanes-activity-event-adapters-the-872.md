# THE-872 / WP1-C-04 — ActivityEvent read-path adapters

**Decision:** IMPLEMENTED  
**Date:** 2026-07-31  
**Worktree:** `/Users/enterprise/Code/entity-the-872-wp1-c-04`  
**Depends on:** THE-870 / WP1-C-02 (spine storage/API); consumes THE-869 types; feeds THE-871 panel

## Purpose

Map existing agent/progress/task/proof/status signals into THE-869 ActivityEvent spine envelopes on the **read path**, so the Workplane activity/progress panel can show real signals without inventing runner-specific models or mutating Engineering data (grill Q38/Q46).

## Module

| Path | Role |
| --- | --- |
| `packages/server/src/activity-event-spine-adapters.ts` | Pure adapters + merge helpers |
| `packages/server/src/activity-event-spine-adapters.test.ts` | Mapping / absent / malformed / idempotence |
| `packages/server/src/activity-spine-events.ts` | Query merges stored + adapted |
| `packages/server/src/index.ts` | Wires activity repo + swarm job list |

## Sources adapted (read-only)

1. **Legacy activity events** (`activities` / ActivityEvent types) via `classifyActivityEventToSpineType`
2. **Task snapshot fields** when present: `column`→status, `progress_status`→progress, `output`→proof, `blocked`→blocker
3. **Swarm jobs** for the task: status→progress/proof/status/blocker

## Contract

- Vocabulary remains `plan|progress|log|proof|status|blocker`
- Adapters never write spine rows or mutate tasks
- Unknown/unmapped/malformed signals → skipped + degraded warning
- Absent feeds (`null`) → explicit unavailable warnings, empty adapted set for that source
- Idempotent: same inputs → same `sourceId`s and stable order
- `GET /tasks/:id/activity-spine-events` includes adapted by default; `?includeAdapted=0` is stored-only
- Response adds `adaptedCount`, `storedCount`, `includeAdapted`

## Non-goals honored

- No comments/review checklist panel
- No review-gate enforcement
- No Engineering import mutations / production promotion
- No unrelated Workplane UI redesign
