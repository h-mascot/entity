# Entity Phase 2 Current Schema Inventory

**Linear issue:** `THE-21` / source `THE-6.1`  
**Date:** 2026-06-22  
**Scope:** Read-only inventory of the current Entity data model, task fields, project/team-like fields, principal-like fields, metadata blobs, and migration seams.

This document is the Slice 0 input for later Phase 2 schema/API tickets. It does not change source schema or production data.

## Sources Inspected

- `packages/db/src/index.ts` - primary SQLite bootstrap, task/project/activity/agent registry repositories.
- `packages/db/src/entity-db.ts` - database path, WAL/foreign key configuration.
- `packages/db/src/task-sync.ts`, `packages/db/src/local.ts`, `packages/db/src/cloud.ts` - local/cloud task adapter contract.
- `packages/db/src/file-sources.ts`, `packages/db/src/file-index.ts` - file source/index schema.
- `packages/db/src/document-collab.ts` - document collaboration schema.
- `packages/db/src/agent-tokens.ts` - agent/service token schema.
- `packages/server/src/index.ts` - task, activity, project, and route behavior.
- `packages/server/src/agent/review-policy.ts` - current review metadata validation.
- `packages/app/src/hooks/useTaskBoard.ts` - frontend task shape and metadata fallbacks.
- `packages/server/src/task-projects.ts` - structured task/project join helpers.

Commands and searches used:

```bash
git status --short --branch
linear_api.py get-issue THE-21
linear_api.py get-issue THE-6
rg "CREATE TABLE|ALTER TABLE|review_packet|metadata|tasks|projects|teams|orgs|principals|assignee|owner|initiator" packages
rg "metadataRecord\\?\\.|review_packet|review_brief|project_ids|project_names|parent_task_id|subtask_count|bookmarked|starred|owner|modules|permissions" packages
```

## Current Database Seams

`getEntityDatabase()` opens one SQLite database, defaults to `packages/db/entity-tasks.db`, and honors `ENTITY_TASK_DB_PATH`. It enables WAL, normal synchronous mode, foreign keys, and a busy timeout.

The primary bootstrap is additive and idempotent: it creates tables with `CREATE TABLE IF NOT EXISTS` and backfills older `tasks` columns with guarded `ALTER TABLE` checks. There is also a legacy Mission Control seed path that reads an older task DB and imports task rows when the Entity DB is empty.

## Tables and Entities

### Core Work Tables

| Table | Current fields | Current purpose | Phase 2 fit |
|---|---|---|---|
| `tasks` | `id`, `name`, `description`, `column`, `assignee`, `blocked`, `blocker_reason`, `project`, `created_at`, `updated_at`, `metadata`, plus additive `brief`, `origin_channel`, `due_date`, `priority`, `estimate_hours`, `time_spent`, `output`, `progress_status`, `recurring`, `recurring_config`, `model`, `archived` | Universal task/board item with legacy string project and metadata blob | Partial. Universal state exists, but org/team/project IDs, initiator, individual owner, executor, submitted_by, policy result, receipt fields, worktype, sensitivity, and structured overlays are missing. |
| `projects` | `id`, `name`, `color`, `created_at` | Flat project labels/options | Partial. No `org_id`, `team_id`, lifecycle, owner, default policy, sensitivity, or derived health. |
| `task_projects` | `task_id`, `project_id` | Structured many-to-many task/project assignment | Useful seam, but tasks also retain legacy `project` text. No foreign-key clauses are declared in bootstrap. |
| `task_history` | `id`, `task_id`, `field`, `old_value`, `new_value`, `changed_by`, `changed_at` | Lightweight field-change history | Partial activity/provenance seam. Payloads are generic strings, not target `ActivityEvent` envelopes. |
| `roadmaps` | `id`, `name`, `theme`, `color`, `created_at` | Planning/roadmap container | Possible Goal/Plan migration source, but lacks org/team/project scope, lifecycle, derived health, owner, and typed links. |
| `roadmap_items` | `id`, `roadmap_id`, `title`, `description`, `priority`, `target_period`, `status`, `linked_task_id`, `created_at` | Planning item linked to one task | Possible planning-object item source. Not first-class Goal/Plan/Spec and only supports one task link. |

### Activity and Review-Adjacent Tables

| Table | Current fields | Current purpose | Phase 2 fit |
|---|---|---|---|
| `activities` | `id`, `source`, `type`, `action`, `description`, `agent_name`, `agent_emoji`, `file_path`, `task_id`, `task_column`, `metadata`, `created_at` | Activity stream for agent/task actions | Partial. Event type enum is small and string-based. Metadata is loose JSON. Missing org/team/project scope, actor principal ID/type, typed payload, policy reason chain, and target event types like review decisions, receipt creation, completion blocked, and notification routed. |
| `agent_log` | `id`, `timestamp`, `event`, `task_id`, `action`, `result`, `model`, `tokens_used` | Task-agent operational log | Useful audit source, but separate from canonical activity events. No org/project scope or principal identity. |
| `task_comments` | `id`, `task_id`, `body`, `author`, `parent_id`, `created_at` | Task notes/comments | Useful collaboration source. Author is a string, not a principal ref. |

Review/proof state currently does not have first-class tables. The server validates review state by parsing `tasks.metadata`. Current review metadata accepts fields such as `review_type`/`review_class`, `reviewer`/`review_owner`, `risk_level`, `submitted_by`, `review_decision`, `review_note`, and `review_packet`/`review_brief`. The packet must include requested outcome, evidence, and done criteria. This is a useful compatibility seam but should not be treated as Phase 2 final storage.

### Agent and Principal-Like Tables

| Table | Current fields | Current purpose | Phase 2 fit |
|---|---|---|---|
| `entity_agents` | `id`, `slug`, `name`, `emoji`, `avatar_url`, `description`, `adapter_type`, `runtime_type`, `status`, `instructions_path`, `metadata_json`, `created_at`, `updated_at` | Agent registry | Partial. Agent principals exist, but there is no unified human/agent/system principal table, no runtime binding ID, no generic provider binding state, and no org/team ownership scope. |
| `entity_modules` | `id`, `slug`, `name`, `description`, `enabled`, `icon`, `kind`, `permissions_schema_json`, `ui_config_json`, timestamps | Module/capability catalog | Useful for agent capability display. Not RBAC, worktype, or policy storage. |
| `entity_agent_module_grants` | `id`, `agent_id`, `module_id`, `enabled`, `permissions_json`, `scope_json`, timestamps | Agent/module grants | Useful permission-like data, but not layered org/team/project RBAC. |
| `entity_module_skill_refs` | `id`, `module_id`, `label`, `kind`, `ref`, `required`, `notes` | Module evidence/reference links | Useful registry metadata, not a proof artifact model. |
| `agent_tokens` | `id`, `token_hash`, `token_type`, `actor`, `scopes_json`, `enabled`, timestamps | Hashed agent/service tokens | Security/auth seam. Actor is a string, not a principal ref. |
| `crews`, `crew_subscriptions`, `subscriptions` | crew IDs/names/settings and agent links | Team-like agent grouping/subscription | Partial team/collaboration seam. Not Phase 2 Team, task ownership, or reviewer pool storage. |

There is no current `orgs`, `teams`, `principals`, `roles`, `grants`, `policies`, `reviews`, `human_gates`, `evidence_artifacts`, `native_documents`, `external_document_refs`, `notifications`, or search index envelope table.

### Files, Documents, and Search-Like Tables

| Table | Current fields | Current purpose | Phase 2 fit |
|---|---|---|---|
| `file_sources` | source identity, type, base URL/path, auth type/ref, enabled, icon, capabilities JSON, health, sync timestamps | File/source connector registry | Partial ExternalDocumentRef/input seam. Source-level auth/readiness exists, but no object-level external document ref or Entity visibility policy. |
| `file_index` | `id`, `source_id`, `path`, `title`, `type`, `agent`, recurrence fields, tags JSON, timestamps, preview, content_hash | Indexed file/document catalog | Partial search/native-doc source. Lacks org/team/project scope, object type envelope, sensitivity, permission state, canonical/deep links, provenance, and connector auth state per result. |
| `file_sync_runs` | run status, source, timestamps, error, scanned/indexed counts | File indexing receipts | Useful operational evidence, not task proof. |
| `document_sessions` | document ID/source/path/hash/version/timestamps | Collaborative document session | Partial NativeDocument seam. Lacks org/team/project scope, mutability policy, sensitivity/ACL, linked object refs. |
| `document_authorship_ranges`, `document_authorship_history`, `document_presence`, `document_comments`, `document_comment_replies`, `document_suggestions`, `document_review_runs` | doc collaboration offsets, authors, presence, comments, suggestions, review runs | Editor collaboration and document review | Useful document-collaboration model. Not current Phase 2 EvidenceArtifact or ExternalDocumentRef model. |

## Current Task API Behavior

The server exposes task routes under both `/tasks` and `/api/tasks`. Current create/update routes accept top-level fields for name, description, column, assignee, project/project IDs, due date, priority, estimates, output, recurring config, model, and metadata. The API writes structured task/project joins when `projectIds` are provided, while preserving a legacy `project` label.

Current validation already enforces a few useful invariants:

- Task columns are limited to `backlog`, `todo`, `doing`, `review`, and `done`.
- Active tasks in `todo`, `doing`, or `review` require a non-empty assignee string.
- A WIP limit blocks moving more than ten tasks into `doing`.
- Moving to review validates review metadata and evidence.
- Moving review-gated tasks to done requires accepted review metadata and an independent reviewer actor.
- Task create/update/delete/move/note/comment operations append `activities` rows with JSON metadata.

These are not Phase 2 complete because assignee is still a display string, owner/initiator are absent, review policy is metadata-based, and completion does not create canonical receipt metadata/artifacts.

## Metadata Blob Classification

### `tasks.metadata`

Purpose today:

- Compatibility storage for task priority/project/due date/recurring values, especially offline UI writes.
- Review workflow storage for review type, reviewer, risk level, submitted-by, decision, note, and proof packet.
- UI fallback storage for parent task, subtask counts, output, blocked state, model, archived state, and activity data.
- Bookmark/star state in mission-control helpers.

Migration risk:

- High. It mixes durable task fields, UI convenience fields, review workflow state, proof packet content, and legacy compatibility values.
- Some metadata keys have top-level equivalents (`priority`, `project`, `due_date`, `blocked`, `output`), so precedence and drift must be handled explicitly.
- Review metadata contains legacy person-specific escalation concepts that should be replaced by generic policy/human-gate fields in Phase 2 rather than promoted forward.

### `activities.metadata`

Purpose today:

- Small JSON payloads for task name/assignee, merge source/target IDs, seeded task flag, manual activity user/session, subtask IDs, and comment author/task name.

Migration risk:

- Medium. Useful provenance exists, but payload shapes are event-specific and not validated centrally.
- Missing required target fields: actor principal, actor type, policy reason chain, typed payload, org/team/project scope, and consistent event names.

### `entity_agents.metadata_json`

Purpose today:

- Capability-card hints such as owner label, verification label, module slugs, permissions, and display summaries.

Migration risk:

- Medium. Useful for agent activity/management UI, but it is not a runtime binding contract or principal model.

### Other JSON/Text Blobs

- `file_sources.capabilities` stores connector capabilities as JSON text.
- `file_index.tags` stores tags as JSON text.
- `entity_modules.permissions_schema_json` and `ui_config_json` store module descriptors.
- `entity_agent_module_grants.permissions_json` and `scope_json` store grant details.
- `agent_tokens.scopes_json` stores token scopes.
- `document_*` tables use JSON for cursors, diffs, and review results.
- `crews.settings` stores crew configuration as text.

Migration risk varies by domain, but all should be treated as compatibility blobs until typed Phase 2 objects exist.

## Phase 2 Required Field Mapping

| Phase 2 target | Current source | Status | Notes |
|---|---|---|---|
| `org_id` | none | Missing | No org table or request org binding seam exists in current task DB. |
| `team_id` | none; possible loose `crews` grouping | Missing/ambiguous | `crews` are not Phase 2 Teams and are not attached to tasks/projects. |
| `project_id` | `projects.id`, `task_projects.project_id`; legacy `tasks.project` string | Partial | Structured project join exists, but Project lacks org/team/lifecycle/owner. |
| universal task state | `tasks.column` | Present | Values align with target states, but `blocked` is a separate boolean and `archived` is separate. |
| worktype | none; possible `metadata` conventions | Missing | No worktype registry or overlay schema. |
| created_by | none; `task_comments.author`, `activities.agent_name`, API actor are partial | Missing/ambiguous | Task row has no creator field. |
| initiator | `origin_channel` may hint source | Missing/ambiguous | No required initiator principal/source ref. |
| owner | `assignee` is used as ownership proxy | Missing/ambiguous | Current "ownerless" checks mean assigned display string, not accountable owner principal. |
| assignee/executor | `tasks.assignee` string | Partial | No individual principal FK; no executor field. |
| submitted_by | review metadata | Partial | Exists only inside review metadata and only for review-gated tasks. |
| reviewer | review metadata | Partial | Exists as `reviewer`/`review_owner`, not first-class Review. |
| approver/human gate | legacy metadata flags | Missing/ambiguous | No HumanGate table or generic gate decision fields. |
| policy result/reason chain | review metadata + hard-coded validation | Missing | No policy resolver storage or reason-chain table. |
| receipt metadata/status | none | Missing | No `receipt_artifact_id`, `receipt_status`, integrity fields, or receipt table. |
| evidence artifact | `output`, `review_packet`, `file_index`, docs tables | Missing/ambiguous | Current evidence references are strings/snippets, not EvidenceArtifact records. |
| ActivityEvent | `activities`, `task_history`, `agent_log` | Partial | Multiple sources exist; none match target event envelope. |
| NativeDocument | `document_sessions` + file index | Partial | Good editor/session seam, but missing NativeDocument object contract. |
| ExternalDocumentRef | `file_sources`, `file_index` | Partial | Connector/source indexing exists, not per-object external document refs. |
| RBAC/sensitivity | module grant JSON, token scopes | Missing/ambiguous | No org/team/project/object RBAC or object sensitivity model. |
| notifications | none | Missing | Activity exists, but no canonical inbox/delivery route records. |

## Migration Seams and Risks

### Useful Seams

- `tasks.column` already matches the Phase 2 universal core state vocabulary.
- `task_projects` provides a path away from the legacy `tasks.project` string.
- `activities`, `task_history`, and `agent_log` provide provenance sources for Slice 0 activity inventory.
- `tasks.metadata.review_packet` / `review_brief` preserves evidence, requested outcome, and done criteria for current review-gated tasks.
- `entity_agents` provides a starting agent identity registry.
- `file_sources`, `file_index`, and document collaboration tables provide raw material for later document/artifact/search slices.

### High-Risk Gaps

- No org/team/request scoping seam exists; cross-org safety cannot be proven from current task tables.
- Task ownership is conflated with assignee string; there is no individual owner principal.
- Review, policy, human gate, receipt, and proof states are not first-class and rely heavily on task metadata.
- Historical completed tasks can be `done` without a canonical receipt; later migration must mark missing receipts instead of fabricating raw proof.
- JSON/text blobs carry overlapping fields and can drift from top-level columns.
- Current project records are flat labels, not durable Phase 2 projects.

## Downstream Recommendations

1. Treat `THE-21` output as inventory only; do not enforce new invariants yet.
2. Add org/team/project/principal schema in a later additive slice with backfill confidence/provenance.
3. Preserve `tasks.metadata` parsing as compatibility input, but migrate review/proof fields into typed review, policy, receipt, and artifact records.
4. Use `task_projects` as the structured project assignment source, while retaining `tasks.project` as a legacy display/backfill field during transition.
5. Build an explicit migration report for completed tasks whose receipt state is unknown or missing.
6. Centralize new task creation and transition validation before adding receipt and policy enforcement.

## Acceptance Coverage

- Current task/project/team/org/principal-like tables and fields are inventoried above.
- Metadata/text blobs are classified by purpose and migration risk.
- Required Phase 2 fields are mapped to existing, missing, ambiguous, or obsolete sources.
- No source schema changes were made for this inventory ticket.
