# THE-869 / WP1-C-01 — ActivityEvent spine types

**Decision:** IMPLEMENTED  
**Date:** 2026-07-31  
**Worktree:** `/Users/enterprise/Code/entity-the-869-wp1-c-01`  
**Depends on:** THE-856 / WP1-A-01 (Workplane seams)

## Purpose

Define the minimal Workplane ActivityEvent spine vocabulary — `plan`, `progress`, `log`, `proof`, `status`, `blocker` — as additive typed domain/schema so THE-870 can store/query events and the activity/progress panel can render them without inventing runner-specific models (grill Q38/Q46).

## Module

| Path | Role |
| --- | --- |
| `packages/db/src/activity-event-spine.ts` | Spine types, normalize, classify, order helpers |
| `packages/db/src/activity-event-spine.test.ts` | Success + degraded/unknown path coverage |
| `packages/db/src/index.ts` | Registers spine types on `ACTIVITY_EVENT_TYPES`; re-exports |

## Contract

- `ACTIVITY_EVENT_SPINE_TYPES` is exactly those six strings, stable order.
- Each spine type is also a first-class `ActivityEventType` (accepted by existing normalize/isKnown paths).
- `normalizeActivityEventSpine(raw)` never invents `taskId` / `eventType` / `sequence`; invalid input returns `{ ok: false, degraded: true, reason }`.
- `classifyActivityEventToSpineType` maps known fine-grained lifecycle events onto the spine; unknown → `null` (explicit).
- Shape: `taskId`, `eventType`, `actor`, `timestamp`, `payloadRef`, `payload`, `sequence`.

## Non-goals honored

- No storage/API append+query (THE-870 / WP1-C-02)
- No Workplane activity/progress panel UI
- No review-gate enforcement / comments checklist
- No runner-specific event models
- No production mutation / DB migration beyond type registration
