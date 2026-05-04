# Mission Control Parity PRD: Original MC vs Entity Integration

## Scope
This document compares:
- Original Mission Control backend: `~/clawd/projects/mission-control/server.js`
- Original MC frontend behavior: `~/clawd/projects/mission-control/public/index.html`
- New Entity MC integration: `~/Code/entity/packages/app/src/components/mission-control/` plus runtime bridge in `~/Code/entity/packages/app/src/hooks/useMCData.ts` and current Entity server routes.

Goal: enumerate features that existed in original MC but are now missing or broken in Entity MC, and define priority + fix approach.

## Priority Definitions
- P0: core workflows broken (task CRUD/detail operations fail or data loss risk)
- P1: major feature missing or degraded but workaround exists
- P2: UX/quality parity gap, lower risk

## Broken / Missing Features

### 1) Task update contract mismatch (`PATCH /api/tasks/:id`)
- Original MC behavior
  - `server.js` supports partial updates through `PATCH /api/tasks/:id` for `column`, `name`, `description`, `assignee`, `due_date`, `projects`, and logs activity.
- Entity MC issue
  - MC runtime calls `PATCH /api/tasks/:id` (`MC-SOURCE.html` `saveSimpleField`, drag-drop, etc.).
  - Entity server exposes `PUT /api/tasks/:id` and `PUT /api/tasks/:id/move`, not PATCH.
  - Result: edit/move flows from embedded MC are broken or intermittently failing.
- Priority: P0
- Suggested fix approach
  - Add `PATCH /api/tasks/:id` compatibility route in `packages/server/src/index.ts`.
  - Map incoming partial fields to existing update path.
  - Return updated task in original MC shape (including fields expected by UI).

### 2) Task schema parity missing (due date, priority, blocked state, estimates, output, etc.)
- Original MC behavior
  - Detail panel edits and displays: `due_date`, `priority`, `blocked`, `blocker_reason`, `estimate_hours`, `time_spent`, `output`, plus project/dependency/attachment metadata.
- Entity MC issue
  - Entity task model is minimal (`name`, `description`, `column`, `assignee`, `metadata`).
  - MC detail UI writes many fields that are not first-class fields in Entity task routes/repo.
  - Result: fields in detail panel appear editable but do not persist reliably.
- Priority: P0
- Suggested fix approach
  - Define canonical MC-compatible task contract in Entity API.
  - Persist all MC fields in DB (columns or structured JSON with strict serialization/parsing).
  - Ensure `GET /api/tasks` and task update endpoints round-trip all detail fields.

### 3) Task activity timeline not returned on tasks
- Original MC behavior
  - `GET /api/tasks` returns each task with recent `activity` entries.
  - Cards and detail panel use this for status preview and activity tabs.
- Entity MC issue
  - Entity `GET /api/tasks` returns `{ tasks: [...] }` and tasks generally do not include per-task `activity` arrays.
  - `useMCData` only normalizes array vs object wrapper; it does not enrich missing activity.
  - Result: activity-dependent UI sections are empty/incorrect.
- Priority: P0
- Suggested fix approach
  - Add per-task activity relation in Entity API response for MC endpoints.
  - Keep global activity stream separate, but expose MC-compatible task activity array.

### 4) `/api/tasks/:id/note` endpoint missing
- Original MC behavior
  - `POST /api/tasks/:id/note` appends human note and logs activity.
- Entity MC issue
  - Endpoint not implemented on Entity server.
  - Detail “Add note” flow fails.
- Priority: P0
- Suggested fix approach
  - Implement route and persist note as activity/comment record.
  - Return updated task payload expected by MC runtime.

### 5) `/api/tasks/:id/activity` endpoint missing
- Original MC behavior
  - `POST /api/tasks/:id/activity` logs activity with `type` (`human`/`technical`) and `session_id`.
- Entity MC issue
  - Endpoint absent; technical/human activity logging path from MC UI is broken.
- Priority: P0
- Suggested fix approach
  - Implement endpoint with validation + persistence.
  - Include `type` and `session_id`; wire into task detail activity tab.

### 6) Comments API parity missing
- Original MC behavior
  - `GET /api/tasks/:id/comments` and `POST /api/tasks/:id/comments` support threaded comments (`parent_id`).
- Entity MC issue
  - MC runtime expects these routes; Entity server does not provide them.
  - Comment list and reply flows fail.
- Priority: P0
- Suggested fix approach
  - Add comments table + routes compatible with original payload.
  - Return ascending comments with `parent_id` to preserve nested rendering.

### 7) Subtasks API missing
- Original MC behavior
  - `GET /api/tasks/:taskId/subtasks`, `POST /api/tasks/:taskId/subtasks`, `PATCH /api/subtasks/:id`, `DELETE /api/subtasks/:id`.
- Entity MC issue
  - No matching routes in Entity integration.
  - Any subtask UI/actions from original contract are unavailable.
- Priority: P1
- Suggested fix approach
  - Implement subtask storage + endpoints and integrate in detail panel where applicable.
  - Emit activity entries on subtask add/complete/delete for parity.

### 8) Agent sync endpoint missing (`/api/sync/agents`)
- Original MC behavior
  - `GET /api/sync/agents` returns agent session status from session stores.
- Entity MC issue
  - Route not present in Entity server.
  - Agent sync/visibility workflows from original backend are unavailable.
- Priority: P1
- Suggested fix approach
  - Recreate endpoint behind configurable adapter; return same schema (`activeMinutes`, `agents[]`, `sessionStore`).
  - Gracefully degrade if session stores unavailable.

### 9) Webhook task ingest missing (`POST /hook/task`)
- Original MC behavior
  - Accepts freeform message, creates task from first line + description.
- Entity MC issue
  - Hook route absent, so external automation integrations break.
- Priority: P1
- Suggested fix approach
  - Add `POST /hook/task` compatibility route.
  - Validate payload, create task, log creation activity.

### 10) Search contract conflict on `/api/search`
- Original MC behavior
  - Task search endpoint returns `{ results, total, query }` with snippets and task IDs.
- Entity MC issue
  - Entity already uses `/api/search` for workspace file search.
  - Embedded MC global search expects task-search schema and can receive incompatible payload.
- Priority: P0
- Suggested fix approach
  - Namespacing fix: move MC task search to `/api/mc/search` (preferred) and rewrite in `useMCData`, or support query-mode multiplexing on `/api/search`.
  - Preserve snippet and source fields expected by MC UI.

### 11) Column semantics drift (`complete`/`archive` vs Entity set)
- Original MC behavior
  - Supports `backlog`, `todo`, `doing`, `review`, `complete`, `archive`; archive visibility toggle in settings.
- Entity MC issue
  - Entity canonical columns are `backlog`, `todo`, `doing`, `review`, `done`.
  - Archive/complete semantics are partially handled in frontend code but not first-class in Entity API.
- Priority: P1
- Suggested fix approach
  - Add compatibility mapping layer (`complete <-> done`, archive handling) at API boundary.
  - Decide whether archive is virtual or persisted; keep UI counts/filtering consistent.

### 12) Login/auth flow parity is partially stubbed
- Original MC behavior
  - Session check/login handled by MC backend (`/api/auth/session`, `/api/auth/login`) with real auth gates.
- Entity MC issue
  - `useMCData` intercepts and fakes auth/session behavior locally with hardcoded default password fallback.
  - Not equivalent to original auth guarantees; may mask backend auth errors.
- Priority: P1
- Suggested fix approach
  - Replace client-side auth shim with server-backed auth compatibility endpoints.
  - Keep shell-level auth UX, but avoid fake success paths in fetch interceptor.

### 13) `TaskBoard` integration props are ignored (data/control not wired)
- Original MC behavior
  - Single runtime controls task state directly with backend contract.
- Entity MC issue
  - `TaskBoard` accepts props (`tasks`, `columns`, `onCreateTask`, `onMoveTask`, `loading`, etc.) but current MC integration ignores them and relies on injected legacy script.
  - Limits observability/testability and creates dual data models.
- Priority: P2
- Suggested fix approach
  - Either remove unused props (declare MC as isolated legacy island) or properly bridge them into MC runtime.
  - Prefer progressive migration away from DOM-script ownership toward React state ownership.

### 14) Missing explicit render of MC login fragment in component set
- Original MC behavior
  - Login overlay exists in MC DOM and is controlled by runtime script.
- Entity MC issue
  - `mcFragments.loginOverlay` is extracted but not rendered by `MCModals`; a separate app-level login overlay is used.
  - Behavior works only because IDs are reused globally; this is brittle and non-obvious.
- Priority: P2
- Suggested fix approach
  - Choose one login overlay source of truth.
  - If app overlay stays, delete unused fragment + document contract; otherwise render MC fragment explicitly.

## Recommended Delivery Plan

### Phase 1 (P0 stabilization)
- Implement MC compatibility endpoints: `PATCH /api/tasks/:id`, notes, activity, comments.
- Resolve `/api/search` contract collision.
- Return MC-compatible task payload including activity and detail fields.

### Phase 2 (P1 parity)
- Add subtasks, sync agents, webhook ingest.
- Finalize column/archive compatibility behavior.
- Replace auth shim with server-backed flow.

### Phase 3 (P2 hardening)
- Clean up integration architecture (single data model ownership).
- Remove brittle overlay duplication and dead fragment paths.
- Add e2e parity tests for top MC workflows.

## Acceptance Criteria
- All original MC core flows work in Entity MC:
  - create/edit/move/delete task
  - note + activity logging
  - comments thread
  - task search
  - settings/archive behavior
- No browser console errors when exercising MC detail actions.
- API responses for MC endpoints match expected legacy shape.
- Regression tests cover at least: task patch, search, comments, notes, activity timeline.
