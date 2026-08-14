---
type: Feature Surface
title: Mission Control
description: Task execution surface for Entity. Covers the task board, task detail panel, review and human-gate flows, comments, handoffs, stale-work detection, duplicate detection, and receipt-backed task completion.
tags: [entity, mission-control, tasks, review, handoff, receipts, activity]
---

# Mission Control

Mission Control is the primary execution surface for the workspace. In the UI it appears as the task board plus task detail panel; on the server it is backed by task routes, review-gate routes, handoff routes, and the task sync layer. Customizable Mission Control board navigation now filters out the `geordi-swarm` plugin so execution-only Swarm controls do not reappear as a standalone board tab, while the task-detail `Run with agents` action and the `/swarm/*` execution routes remain available inside Mission Control. Task handoffs are also part of this surface: the server now exposes local handoff history, handoff creation, and rollback through `packages/server/src/routes/tasks.ts`, and the board/detail UI refreshes when those mutations broadcast updates.

The important source seams are:

- `packages/app/src/components/mission-control/*` for the board, detail drawer, review actions, and task creation UI.
- `packages/server/src/routes/tasks.ts` for task listing, filtering, stale detection, duplicate detection, owner inboxes, and task mutations.
- `packages/server/src/routes/task-review-gates.ts` for review acceptance, fix requests, human-gate requests, and human-gate decisions.
- `packages/db/src/index.ts` for task columns, policy envelopes, worktype registry, review-state fields, and task metadata.
- `packages/db/src/task-sync.ts` for local/cloud adapter selection.

## What users can do

- Move tasks across the `backlog`, `todo`, `doing`, `review`, and `done` columns.
- Create tasks and inspect detail, including assignee, priority, due date, model, estimates, attachments, dependencies, and activity.
- Mark work as blocked and carry blocker reasons.
- Review work, request fixes, and pass human-gate decisions.
- Inspect comments, subtasks, and related context in the task detail panel.
- Identify stale work and owner inbox items.
- Surface duplicate task candidates before creating more work.
- Observe receipts and proof state for task completion and external side effects.

## How the surface is wired

The task board comes from `packages/app/src/components/TaskBoard.tsx` and the mission-control subcomponents. The detail panel in `packages/app/src/components/mission-control/TaskDetailPanel.tsx` shows a richer record than a simple kanban card: it reads task metadata, review state, policy reason chains, activity, comments, dependencies, attachments, and proof views.

On the server, `packages/server/src/routes/tasks.ts` provides the data and mutation APIs that keep the board and detail panel in sync. That file also contains filters that matter operationally:

- `?column=` for a single column;
- `?columns=` and `?excludeColumns=` for multiple-column filters;
- `?project=` for project scoping;
- `?includeActivity=true` for embedded activity, with an explicit small-limit guard.

## Review and human-gate lifecycle

The review flow is intentionally separate from a bare task status change. Review state and human-gate state are tracked on the task record, and the server gates those transitions through explicit review endpoints.

```mermaid
sequenceDiagram
  participant UI as Mission Control UI
  participant Review as /api/tasks/:id/review/*
  participant Gate as /api/tasks/:id/human-gate/*
  participant DB as task repository
  participant Activity as activity repository

  UI->>Review: POST accept or request-fix
  Review->>DB: buildTaskReviewDecisionUpdates(...)
  DB-->>Review: updated task record
  Review->>Activity: createActivity(review_decision)
  Review-->>UI: task + review decision payload

  UI->>Gate: POST request / approve / reject
  Gate->>DB: buildTaskHumanGate*Updates(...)
  DB-->>Gate: updated task record
  Gate->>Activity: createActivity(human_gate_*)
  Gate-->>UI: task + human gate payload
```

This flow is backed by `packages/server/src/routes/task-review-gates.ts` and the task fields in `packages/db/src/index.ts`.

## Handoffs and rollback

Mission Control now includes a task-handoff workflow on the same task record that powers assignment and review. `packages/server/src/routes/tasks.ts` exposes `GET /api/tasks/:id/handoffs` for local history, `POST /api/tasks/:id/handoff` for creating a handoff, and `POST /api/tasks/:id/handoffs/:handoffId/rollback` for rolling it back.

The implemented flow is intentionally conservative:

- cloud mode fails closed with `503 cloud_handoffs_unavailable` before any local task or repository access;
- the target principal must exist, be active, and hold a write-capable grant that covers the task org and team scope;
- the handoff repository records the edge atomically with the downstream task reassignment;
- rollback is scoped to the task, mode, and cloud id so a handoff id cannot be replayed from another task;
- successful create and rollback operations broadcast `task:updated` so the board and detail panel refresh.

The handoff repository lives in `packages/db/src/handoffs.ts`, and the principal authorization rules come from `packages/db/src/principals.ts`. The route-level coverage in `packages/server/src/routes/tasks-handoffs-route.test.ts` verifies the local-only path, scope checks, cloud fail-closed behavior, rollback scoping, and refresh broadcasts.

## Receipt-backed completion and proof

The task detail panel does more than show status: it renders proof-oriented state for completed work, including receipt links, content hashes, evidence summaries, and degraded/missing-evidence signals. That makes Mission Control the place where operators can inspect whether a completed task is actually backed by an artifact.

The proof view is assembled in the client from task data and document/evidence references. The supporting data model comes from `packages/db/src/index.ts` and the output/receipt helpers used by the task detail panel.

## Change notes for future agents

When changing Mission Control, check these seams together:

1. `packages/app/src/components/mission-control/TaskDetailPanel.tsx` for what the user sees.
2. `packages/server/src/routes/tasks.ts` for read/write behavior and query filters.
3. `packages/server/src/routes/task-review-gates.ts` for review and human-gate state transitions.
4. `packages/db/src/index.ts` and `packages/db/src/task-sync.ts` for data shape and adapter mode.

Be careful not to claim that a route alone proves a workflow works. For Mission Control, the task board, detail panel, backing routes, and persistence layer all have to agree.
