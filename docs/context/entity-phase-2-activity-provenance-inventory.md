# Entity Phase 2 Activity and Provenance Inventory

**Linear issue:** `THE-22` / source `THE-6.2`
**Date:** 2026-06-22
**Scope:** Read-only inventory of current activity log, event, comment, operational log, and provenance-like storage, with a gap map against the Phase 2 `ActivityEvent` target.

This document is a Slice 0 input for later ActivityEvent, receipt, review, Task Master, migration, and search tickets. It does not change source schema or production data.

## Sources Inspected

- `packages/db/src/index.ts` - `activities`, `agent_log`, `task_comments`, `task_history`, repository interfaces, and mappers.
- `packages/server/src/index.ts` - `logActivity()`, task lifecycle routes, manual activity routes, global activity routes, and task-detail activity hydration.
- `packages/server/src/agent/index.ts`, `packages/server/src/agent/events.ts`, `packages/server/src/agent/tools.ts`, `packages/server/src/agent/log.ts` - Task Master action generation, operational logs, and activity writes.
- `packages/app/src/hooks/useActivityStream.ts` - frontend activity stream type, normalization, polling, and mock activity shape.
- `packages/app/src/hooks/useTaskBoard.ts` - task-detail activity shape and metadata fallback.
- `packages/db/src/document-collab.ts` and `packages/server/src/editor/routes.ts` - document collaboration/provenance-like history, presence, comments, suggestions, and review runs.
- `packages/db/src/file-sources.ts`, `packages/db/src/file-index.ts`, `packages/server/src/fs/index-runner.ts` - file index sync runs and skip/error metrics.
- `packages/server/src/swarm/db.ts`, `packages/server/src/swarm/routes.ts`, `packages/server/src/swarm/dispatcher.ts` - job lifecycle and proof artifact records.
- `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md` - target `ActivityEvent` fields and required event categories.
- `docs/specs/entity-phase-2-prd-canonical-20260620.md` - activity log and provenance requirements.

Commands and searches used:

```bash
linear_api.py get-issue THE-22
linear_api.py get-issue THE-6
rg "ActivityType|ActivityRecord|CreateActivityInput|ActivityRepository|CREATE TABLE IF NOT EXISTS activities|task_history|agent_log|createActivityRepository|createAgentLogRepository|addTaskHistory|createActivity" packages/db/src/index.ts
rg "logActivity\\(|createActivity\\(|createLog\\(|task_created|task_updated|task_moved|task_completed|task_deleted|task_comment|ownership_check|review_hygiene|stale_scan" packages/server/src
rg "ActivityEvent|activity event|event_type|provenance|audit|receipt" docs/specs/entity-phase-2-*.md
rg "CREATE TABLE IF NOT EXISTS .*history|CREATE TABLE IF NOT EXISTS .*runs|CREATE TABLE IF NOT EXISTS .*proof|created_by|proof|artifacts|activity|provenance" packages
```

## Target ActivityEvent

The Phase 2 target treats per-task activity as the structured provenance source for routing, review, receipt generation, and audit. Target fields:

- Scope and identity: `org_id`, optional `team_id`, optional `project_id`, optional `task_id`.
- Event identity: `id`, `event_type`.
- Actor identity: optional `actor_principal_id`, required `actor_type` (`human`, `agent`, `system`, `workflow`, or `unknown`).
- Payload: typed `payload`, optional `reason`, optional `policy_reason_chain`.
- Time: `created_at`.

Target event types:

| Target event type | Current coverage | Current source |
|---|---|---|
| `task_created` | Present/partial | `activities.type=task_created` from task create and sample task seeding. |
| `task_updated` | Present/partial | `activities.type=task_updated` from task update, duplicate merge, notes, manual activity, generated subtasks, and Task Master updates. |
| `assignment_changed` | Partial/conflicting | Assignment changes are embedded in `task_updated` metadata or task field diffs, not first-class. |
| `taskmaster_claimed` | Missing | No current claim event. Task Master can update/move tasks but claim is not modeled. |
| `nudge_sent` | Partial/conflicting | Task Master stale scans notify assignees with `message_sent`; no specific nudge event type. |
| `owner_escalated` | Partial/conflicting | Stale blocked tasks add notes/actions such as escalation, but no first-class event type. |
| `auto_reassigned` | Missing | No auto-reassignment event; current tooling can move/update tasks, but reassignment policy is not first-class. |
| `submission_created` | Missing/ambiguous | Review/output submission is stored in `tasks.output` or review metadata, not as an event. |
| `review_requested` | Partial/conflicting | Moving to `review` logs `task_updated`/`task_moved`; review validation is not event-backed. |
| `review_decision` | Missing/ambiguous | Review decision lives in `tasks.metadata.review_decision`, not in `activities`. |
| `human_gate_requested` | Missing | No current human-gate event store. |
| `human_gate_decision` | Missing | No current human-gate decision event store. |
| `status_changed` | Partial/conflicting | Column/status changes use `task_moved`, `task_completed`, or generic `task_updated`; no explicit old/new status payload contract. |
| `artifact_linked` | Partial/ambiguous | `output` links, review packets, file index entries, and swarm proofs exist, but no canonical event links artifacts to tasks. |
| `receipt_created` | Missing | No current receipt table/event. |
| `receipt_failed` | Missing | No current receipt failure event. |
| `completion_accepted` | Partial/conflicting | Completion logs `task_completed`; review acceptance is metadata-only. |
| `completion_blocked` | Partial/conflicting | API returns validation errors but does not persist blocked-completion events. |
| `task_cancelled` | Partial/conflicting | Deletion logs `task_deleted`; no cancel distinction. |
| `task_paused` | Missing | No current paused state/event. |
| `task_blocked` | Partial/conflicting | `tasks.blocked` and `blocker_reason` exist; updates log generic `task_updated`. |
| `connector_state_changed` | Partial/ambiguous | `file_sources.health`, `enabled`, and `file_sync_runs.status/error` exist; no ActivityEvent write. |
| `notification_routed` | Partial/conflicting | Task Master notification writes `message_sent`; no delivery route record. |

## Current Provenance Stores

### `activities`

Current table:

| Field | Purpose today | Phase 2 gap |
|---|---|---|
| `id` | Autoincrement event ID | Numeric local ID, not global/tenant-scoped string. |
| `source` | `agent` or `task` | Too coarse for human/system/workflow actor type. |
| `type` | Narrow activity type union | Missing most target enum values. Unknown values normalize to `message_sent` in code. |
| `action` | Human-readable action label | Not a typed action enum or policy reason. |
| `description` | Human-readable summary | Useful display copy, not structured payload. |
| `agent_name`, `agent_emoji` | Display actor | Not a principal reference. Defaults to `Entity`/display emoji when omitted. |
| `file_path` | File-related activity reference | Useful for file events but not an object ref. |
| `task_id`, `task_column` | Task link and current board column | No old/new state or status transition object. |
| `metadata` | JSON text payload | Event-specific, unvalidated, and not indexed by schema. |
| `created_at` | Timestamp | Present. |

Current repository behavior:

- `listActivities(limit)` returns newest rows by `created_at`, then ID.
- `listActivitiesByTaskId(taskId, limit)` filters by `task_id`.
- `createActivity()` requires non-empty `action` and `description`, then writes raw `source`, `type`, optional display actor, file path, task ID, task column, and metadata JSON text.
- Type normalization silently coerces unrecognized values to `message_sent`, which is risky for migrations.

Current routes/consumers:

- `GET /activities` and `GET /api/activities` return `{ activities }`.
- `GET /api/activity/recent` returns a bare activity array.
- Task detail and task list can hydrate recent task activity through `activityRepository.listActivitiesByTaskId()`.
- `GET /tasks/:id/activity` and `GET /api/tasks/:id/activity` return per-task activity arrays.
- `POST /tasks/:id/activity` and `/api/tasks/:id/activity` create a generic `task_updated` event from manual `action`, `details`, `user`, `type`, and `session_id`. Raw `tool_call` action is explicitly skipped to avoid spam.
- `useActivityStream()` polls `/activities?limit=...`, normalizes current fields, and falls back to mock events when configured.

Sample current activity shapes:

```json
{
  "source": "task",
  "type": "task_created",
  "action": "Created task",
  "description": "Example task in Todo.",
  "agent_name": "Ada",
  "task_id": 42,
  "task_column": "todo",
  "metadata": "{\"taskName\":\"Example task\",\"assignee\":\"Ada\"}"
}
```

```json
{
  "source": "agent",
  "type": "file_edit",
  "action": "Edited file",
  "description": "Updated docs/context/example.md.",
  "agent_name": "Entity",
  "file_path": "docs/context/example.md",
  "metadata": null
}
```

```json
{
  "source": "task",
  "type": "task_updated",
  "action": "Merged duplicate task",
  "description": "Merged task #7 into #3.",
  "task_id": 3,
  "task_column": "doing",
  "metadata": "{\"sourceTaskId\":7,\"targetTaskId\":3}"
}
```

### `agent_log`

Current table:

| Field | Purpose today | Phase 2 gap |
|---|---|---|
| `id` | Autoincrement log ID | Not ActivityEvent identity. |
| `timestamp` | Action timestamp | Present but separate from `activities.created_at`. |
| `event` | Task-agent trigger event | Values include `review_check`, `review_hygiene`, `ownership_check`, `stale_scan`, `manual`, and `output_missing`. |
| `task_id` | Optional task link | Useful task ref, but no project/team/org scope. |
| `action` | Action label | Not a target event type. |
| `result` | Result text | Unstructured. |
| `model` | Model setting used/defaulted | Useful operational field, but not target payload contract. |
| `tokens_used` | Token count | Useful operational metric. |

Current producers:

- `TaskAgent.recordActions()` writes one `agent_log` row per `TaskAgentAction`.
- Stale scans write `skip_scan`, `scan_complete`, `add_stale_note`, `recycle_transient_blocker`, `escalate_blocker`, and `notify_assignee` actions.
- Review hygiene writes `check_output`, `search_for_output`, `attach_output`, `request_output`, `classify_review_output`, `reject_invalid_output`, and `flag_weak_output`.
- Ownership checks write `request_owner_assignment`.

Migration risk:

- This is the clearest source for Task Master routing and escalation provenance, but it is isolated from the visible `activities` stream and uses trigger/action strings rather than target `ActivityEvent.event_type`.

### `task_comments`

Current table:

| Field | Purpose today | Phase 2 gap |
|---|---|---|
| `id`, `task_id`, `body`, `author`, `parent_id`, `created_at` | Task notes/comments, including agent notes and threaded replies | Author is a string, not a principal; comments are separate from `activities` and not automatically event-sourced except selected routes/tools. |

Current producers:

- `POST /tasks/:id/note` creates a comment and logs `task_updated` / `Added note`.
- `POST /tasks/:id/comments` creates a comment and logs `task_comment` / `Added comment`.
- Task Master tools create agent comments and log `task_comment` activity.
- Comment responder writes agent replies and task updates with activity entries.

Migration risk:

- Comments are important review/context evidence, but comment creation and activity creation are not transactionally unified into one event envelope.

### `task_history`

Current table:

| Field | Purpose today | Phase 2 gap |
|---|---|---|
| `id`, `task_id`, `field`, `old_value`, `new_value`, `changed_by`, `changed_at` | Generic field-change history | Mostly repository/API surface; not wired into normal task update/move flows. Values are strings; no actor principal or policy context. |

Current routes:

- `GET /tasks/:taskId/history` and `/api/tasks/:taskId/history` return history for an existing task.

Migration risk:

- This is a useful backfill seam for `status_changed` or `assignment_changed`, but it is not currently authoritative because normal mutations primarily write `activities`, not `task_history`.

### File Indexing and Connector State

Current tables:

- `file_sync_runs`: `id`, `source_id`, `status`, `started_at`, `finished_at`, `error`, `files_scanned`, `files_indexed`.
- `file_sources`: source health/enabled/capability state.
- `file_index`: indexed file/doc rows with path, title, type, agent, recurrence, tags, timestamps, preview, hash, and origin in the dedicated `file-index.ts` path.

Current producers:

- File indexing writes sync run summaries and file index rows.
- The index runner tracks skipped files in memory to avoid noisy repeat logs.

Migration risk:

- Connector state changes map conceptually to `connector_state_changed`, but the current implementation records sync runs rather than appending ActivityEvent rows. Permission/auth/readiness state is source-level and not tied to task/project provenance.

### Document Collaboration Provenance

Current tables:

- `document_authorship_history`: doc/range/author diff JSON and timestamp.
- `document_presence`: agent presence, cursor JSON, and last activity.
- `document_comments` and `document_comment_replies`: document comments and replies.
- `document_suggestions`: insert/replace/delete suggestions and status.
- `document_review_runs`: document review mode/status/result JSON.

Migration risk:

- These tables are strong document-domain provenance, but they are not folded into the task activity stream. Authors are strings or agent IDs, not unified principals. Review runs are document reviews, not task `Review` records.

### Swarm Job and Proof Records

Current tables:

- `swarm_jobs`: linked optional `task_id`, title/spec/repo/branch/provider/status/priority/context/run handle/retries/feedback/created_by/timestamps.
- `swarm_proofs`: job/provider/commit/branch/build/test/screenshots/artifacts/duration/proof type/ref/timestamp.

Current producers:

- Swarm routes create jobs, queue/claim/release/update status, append proofs, complete, and fail jobs.
- Dispatcher writes proofs after provider run completion and moves jobs into proof/review states.

Migration risk:

- These are proof/provenance records, but they are plugin-owned and separate from `activities`. Job status changes do not currently append target `taskmaster_claimed`, `artifact_linked`, `completion_accepted`, or `completion_blocked` events.

## Current Producer Matrix

| Producer | Current event/write | Payload shape | Main gap |
|---|---|---|---|
| File write/create/delete/move routes | `activities.type=file_edit` | path, action label, description | No actor principal; no old/new object state. |
| Mention workflow | `activities.type=tool_call` | mentioned agent, document path, success metadata | Tool calls are not typed to target events; manual activity route skips raw `tool_call`. |
| Task create/update/move/delete | `task_created`, `task_updated`, `task_moved`, `task_completed`, `task_deleted` | task name, assignee, source/target IDs for merges | No old/new state payload standard; assignment/status/review state collapsed into generic events. |
| Task notes/comments | `task_updated` or `task_comment` | author/user/session/task name/full note | Comments are not a unified event envelope. |
| Manual task activity route | forced `task_updated` | `user`, `session_id`, `activityType` metadata | Caller-supplied type is metadata only. |
| Task Master tools | `task_comment`, `task_updated`, `task_moved`, `task_completed`, `message_sent` | fields changed, agent/channel, note text | Operational actions are duplicated across `activities` and `agent_log`. |
| TaskAgent scans | `agent_log.event` values | trigger/action/result/tokens/model | Not visible in activity stream unless tools also log activity. |
| Task history API | `task_history` rows | field/old/new/changed_by | Not populated by common task mutations. |
| File indexing | `file_sync_runs` rows | status/error/counts | Not connected to task activity or connector event enum. |
| Document collaboration | document history/presence/comment/suggestion/review tables | doc IDs, offsets, authors, diff/result JSON | Domain-specific provenance, not target task ActivityEvent. |
| Swarm job/proof routes | `swarm_jobs` and `swarm_proofs` | job status/run/proof artifacts | Proof lifecycle not emitted into task activity/receipt event stream. |

## Coverage Summary

Present today:

- A visible activity stream exists.
- Core task lifecycle changes are logged enough for human display.
- Per-task activity queries exist.
- Task-agent operational actions are recorded.
- Document collaboration and swarm proof data have their own history/proof tables.

Partial today:

- Status changes, assignment changes, review requests, completion acceptance, blocker changes, notification routing, artifact/proof linking, connector state, and Task Master routing all have some data, but they are embedded in generic event types, metadata text, or separate tables.

Missing today:

- Org/team/project-scoped event envelope.
- Unified actor principal and actor type.
- Required target event enum coverage.
- Typed payloads and policy reason chains.
- Transactional completion/receipt events.
- Persisted completion-blocked events for failed transitions.
- Single provenance source that joins task, review, receipt, evidence, notification, document, and connector activity.

## Migration and Backfill Risks

- Current `activities.type` is too narrow and silently normalizes unknown values to `message_sent`, which can hide legacy drift.
- `activities.metadata` is JSON text with no schema-level validation or per-event contract.
- `agent_log` contains Task Master routing evidence but is not part of the user-facing activity feed.
- `task_history` looks like a strong field-change table but is not consistently populated by the normal task update routes.
- Comment bodies and review metadata can contain meaningful proof/context that is not structured as events.
- Completion and review failures return API errors without durable `completion_blocked` or `receipt_failed` event rows.
- Swarm proofs and file sync runs are useful evidence-like records but are not linked to canonical Entity task artifacts.
- Backfill from historical events must carry confidence. Missing actors, unknown actor type, ambiguous assignment changes, missing old values, missing policy reasons, and missing receipt events should be surfaced as warnings rather than invented.

## Downstream Recommendations

1. Promote `activities` into the canonical ActivityEvent table through additive columns or a companion migration view, but keep one provenance source for task workflows.
2. Add typed payload contracts for each target event type before wiring receipt generation.
3. Preserve `agent_log`, `task_comments`, `task_history`, file sync runs, document histories, and swarm proofs as migration inputs with explicit source/confidence metadata.
4. Emit ActivityEvents for task transition attempts, including blocked attempts, before enforcing receipt-before-done.
5. Ensure every event write includes scope, actor type, and stable actor reference or explicit `unknown`.
6. Treat historical completed tasks without `receipt_created` as missing receipt rather than generating raw receipts retroactively.

## Acceptance Coverage

- Current event sources and payload shapes are documented with file/table references.
- Target `ActivityEvent` coverage is marked as present, partial, missing, or conflicting.
- Weak/unstructured provenance risks are called out for migration/backfill.
- Sample current events are included from the present activity producer shapes.
- No production data mutation was performed.
