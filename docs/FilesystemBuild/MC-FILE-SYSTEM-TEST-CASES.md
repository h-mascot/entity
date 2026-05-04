# MC File System Test Cases

**Scope:** Full test case inventory for all `FS-*` tickets in `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-IMPLEMENTATION-CHECKLIST.md`.

## Conventions
- `AUT` = automated test candidate (script/e2e/integration)
- `MAN` = manual UI/system test
- `PRE` = precondition

## Sprint 0

### FS-001 App Feature Flag
- `TC-FS-001-01 (AUT)`: With `VITE_ENTITY_FS_MULTISOURCE` unset/false, app renders existing file tree flow and file open/edit/save still works.
- `TC-FS-001-02 (MAN)`: With `VITE_ENTITY_FS_MULTISOURCE=true`, files tab shows multisource beta banner/path and no crash.
- `TC-FS-001-03 (AUT)`: Runtime object includes boolean `fsMultiSourceEnabled` for both truthy/falsey env values.

### FS-002 Server Gate + FS Module Skeleton
- `TC-FS-002-01 (AUT)`: With `ENTITY_FS_MULTISOURCE=false`, `/api/fs/health` returns 404 (module not mounted).
- `TC-FS-002-02 (AUT)`: With `ENTITY_FS_MULTISOURCE=true`, `/api/fs/health` returns 200 and feature metadata.
- `TC-FS-002-03 (AUT)`: Legacy `/api/files`, `/api/file`, `/api/search` continue to respond unchanged when gate toggles.

## Sprint 1

### FS-010 DB Schema
- `TC-FS-010-01 (AUT)`: DB bootstrap creates `file_sources`, `file_index`, `file_sync_runs` tables.
- `TC-FS-010-02 (AUT)`: Re-running bootstrap is idempotent (no schema errors).
- `TC-FS-010-03 (AUT)`: Expected indexes exist for source enabled/type and index freshness queries.

### FS-011 File Source Repository
- `TC-FS-011-01 (AUT)`: `createSource` persists valid source and returns normalized shape.
- `TC-FS-011-02 (AUT)`: `updateSource` updates selected fields and preserves others.
- `TC-FS-011-03 (AUT)`: `setEnabled` toggles state and reflects in filtered `listSources(false)`.
- `TC-FS-011-04 (AUT)`: Invalid source type throws validation error.

### FS-012 Source CRUD Endpoints
- `TC-FS-012-01 (AUT)`: `POST /api/sources` returns 201 with created source payload.
- `TC-FS-012-02 (AUT)`: `GET /api/sources` returns array under `sources` key.
- `TC-FS-012-03 (AUT)`: `PUT /api/sources/:id` updates editable fields.
- `TC-FS-012-04 (AUT)`: `PATCH /api/sources/:id/enabled` toggles enabled flag.
- `TC-FS-012-05 (AUT)`: `DELETE /api/sources/:id` returns 204 and removes source.
- `TC-FS-012-06 (AUT)`: Invalid payload returns 400 with human-readable error.

### FS-013 Source Test Endpoint
- `TC-FS-013-01 (AUT)`: Existing source returns `{ status: ok|degraded|error, message }`.
- `TC-FS-013-02 (AUT)`: Missing source returns 404.
- `TC-FS-013-03 (AUT)`: Test operation does not mutate source config fields.

## Sprint 2

### FS-020 Adapter Interface + Registry
- `TC-FS-020-01 (AUT)`: Registry returns adapter for each supported source type.
- `TC-FS-020-02 (AUT)`: Unsupported type throws explicit unsupported error.
- `TC-FS-020-03 (AUT)`: Adapters expose required methods (`validate/capabilities/list/read`).

### FS-021 Local Adapter
- `TC-FS-021-01 (AUT)`: Valid in-root `list` returns directories/files.
- `TC-FS-021-02 (AUT)`: Valid in-root `read` returns file content + metadata.
- `TC-FS-021-03 (AUT)`: Path traversal (`../`) is rejected.
- `TC-FS-021-04 (AUT)`: Out-of-root absolute path read is rejected.

### FS-022 Docsify Adapter
- `TC-FS-022-01 (AUT)`: Adapter parses docsify listing into unified `SourceNode[]`.
- `TC-FS-022-02 (AUT)`: Adapter reads markdown content by source-relative path.
- `TC-FS-022-03 (AUT)`: Network or parse failures return normalized errors.

### FS-023 HTTP Markdown Adapter
- `TC-FS-023-01 (AUT)`: Adapter reads markdown content from URL source.
- `TC-FS-023-02 (AUT)`: Non-markdown/unsupported listing mode returns graceful error.
- `TC-FS-023-03 (AUT)`: Adapter capability flags match read-only behavior.

### FS-024 /api/fs/tree + /api/fs/file
- `TC-FS-024-01 (AUT)`: Unknown source ID returns 404.
- `TC-FS-024-02 (AUT)`: Disabled source access returns 403/400.
- `TC-FS-024-03 (AUT)`: `GET /api/fs/tree` returns normalized node payload.
- `TC-FS-024-04 (AUT)`: `GET /api/fs/file` returns content payload and metadata.

### FS-025 Security Controls
- `TC-FS-025-01 (AUT)`: Disallowed host/URL rejected before adapter call.
- `TC-FS-025-02 (AUT)`: Credential fields are redacted from logs.
- `TC-FS-025-03 (AUT)`: Path normalization blocks traversal attacks.
- `TC-FS-025-04 (AUT)`: Access audit events are emitted for source reads.

## Sprint 3

### FS-030 Frontend Types + Hooks
- `TC-FS-030-01 (AUT)`: Hooks parse and return typed source/tree/file/search payloads.
- `TC-FS-030-02 (AUT)`: Hook error states are populated on non-2xx responses.
- `TC-FS-030-03 (AUT)`: App compiles with strict type checks.

### FS-031 File Sources Settings UI
- `TC-FS-031-01 (MAN)`: Add source form validates required fields and creates source.
- `TC-FS-031-02 (MAN)`: Edit source persists updates and refreshes list.
- `TC-FS-031-03 (MAN)`: Enable/disable and delete actions update UI state.
- `TC-FS-031-04 (MAN)`: Test-connection action renders success/error feedback.

### FS-032 Multi-Source Sidebar Tree
- `TC-FS-032-01 (MAN)`: Enabled sources render as independent root groups.
- `TC-FS-032-02 (MAN)`: Folder expand/collapse works and loads children.
- `TC-FS-032-03 (MAN)`: Source-level loading and error states display correctly.

### FS-033 Source-Aware Selection State
- `TC-FS-033-01 (AUT)`: Selected file state stores `sourceId + path`.
- `TC-FS-033-02 (MAN)`: Local source files still support edit/save cycle.
- `TC-FS-033-03 (MAN)`: Non-local source files open in read mode without edit regressions.

### FS-034 Reader Metadata Header
- `TC-FS-034-01 (MAN)`: Reader header shows source, path, updated, type, agent when available.
- `TC-FS-034-02 (MAN)`: Missing metadata fields degrade gracefully without UI break.
- `TC-FS-034-03 (AUT)`: Markdown rendering remains unchanged with metadata wrapper.

### FS-035 Unified File Dashboard
- `TC-FS-035-01 (MAN)`: Dashboard appears when no file selected.
- `TC-FS-035-02 (MAN)`: Source/type/agent/date filters constrain result list.
- `TC-FS-035-03 (MAN)`: Open action loads selected file into reader.
- `TC-FS-035-04 (MAN)`: Empty-state and error-state UI are correct.

### FS-036 QuickSwitcher Unified Search
- `TC-FS-036-01 (MAN)`: QuickSwitcher queries unified search endpoint.
- `TC-FS-036-02 (MAN)`: Results display source context label.
- `TC-FS-036-03 (MAN)`: Keyboard navigation and selection behavior unchanged.

## Sprint 4

### FS-040 Index Repository
- `TC-FS-040-01 (AUT)`: Upsert by `(sourceId,path)` updates existing record not duplicate.
- `TC-FS-040-02 (AUT)`: Query by source/type/agent/date works.
- `TC-FS-040-03 (AUT)`: Sync run records capture start/end/status/error fields.

### FS-041 Background Index Runner
- `TC-FS-041-01 (AUT)`: Runner skips disabled sources.
- `TC-FS-041-02 (AUT)`: Source errors are isolated; runner continues others.
- `TC-FS-041-03 (AUT)`: `lastSyncedAt`/run status update after successful cycle.

### FS-042 Classification Heuristics
- `TC-FS-042-01 (AUT)`: Daily naming patterns classified as `daily-review`/recurring daily.
- `TC-FS-042-02 (AUT)`: Weekly/monthly patterns map to recurring pattern correctly.
- `TC-FS-042-03 (AUT)`: Unknown names map to `one-off` and agent `other`.

### FS-043 Unified Search Endpoint
- `TC-FS-043-01 (AUT)`: Endpoint supports query + source/type/agent/date filters.
- `TC-FS-043-02 (AUT)`: Response includes preview/snippet and source metadata.
- `TC-FS-043-03 (AUT)`: Fallback mode works when index is stale/unavailable.

## Sprint 5

### FS-050 Observability
- `TC-FS-050-01 (AUT)`: Source health transitions based on read/test/index outcomes.
- `TC-FS-050-02 (AUT)`: Search/tree/read latency metrics emitted.
- `TC-FS-050-03 (MAN)`: Operator can inspect health and freshness signals.

### FS-051 Regression + Acceptance
- `TC-FS-051-01 (MAN)`: Legacy local file create/edit/save remains functional.
- `TC-FS-051-02 (MAN)`: Multi-source browse/read works for local + docsify + http-markdown.
- `TC-FS-051-03 (MAN)`: QuickSwitcher finds cross-source files.
- `TC-FS-051-04 (AUT)`: E2E smoke suite passes in CI/dev pipeline.

### FS-052 Rollout + Rollback Playbook
- `TC-FS-052-01 (MAN)`: Rollout doc contains stage gates and enablement rules.
- `TC-FS-052-02 (MAN)`: Rollback conditions and commands are explicit and testable.
- `TC-FS-052-03 (MAN)`: Playbook linked from checklist/PRD references.

## Frontend Validation Matrix (for Henry)
- `Now testable:` FS-001 feature flag behavior.
- `Testable after Sprint 3:` FS-031 through FS-036 user-facing workflows.
