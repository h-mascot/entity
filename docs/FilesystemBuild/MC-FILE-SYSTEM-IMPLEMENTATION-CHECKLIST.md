# MC File System Improvement Implementation Checklist

**Generated:** February 8, 2026  
**Source PRD:** `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-IMPROVEMENT.md`  
**Goal:** Execute the PRD with atomic, dependency-aware tickets that can be tracked in Mission Control.
**Ralph Loop File:** `/Users/henrymascot/Code/entity/scripts/ralph/mc-file-system-prd.json`  
**Test Cases:** `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-TEST-CASES.md`

## Execution Rules
- Ship in order by sprint, but run independent tickets in parallel.
- Keep R1 read-first: no cross-source write actions until explicit capability gating is complete.
- Keep existing local endpoints (`/api/files`, `/api/file`, `/api/search`) working during migration.
- Behind feature flags until R1 acceptance criteria are met.

## Sprint Plan Overview

| Sprint | Target | Exit Condition |
|---|---|---|
| Sprint 0 | Feature gates + scaffolding | New multi-source paths are gated and non-breaking |
| Sprint 1 | Source registry backend | Source CRUD + connection testing API works |
| Sprint 2 | Source adapters + FS read APIs | Multi-source tree/read APIs functional for 3 source types |
| Sprint 3 | Frontend MVP | Settings + multi-source sidebar + dashboard + reader metadata shipped |
| Sprint 4 | Indexing + unified discovery | Indexed search + recurrence/type/agent metadata works |
| Sprint 5 | Hardening + rollout | Observability, migration docs, and rollout controls complete |

## Ticket Backlog

## Sprint 0: Gating and Scaffolding

### [x] FS-001: App Feature Flag for Multi-Source FS
- **Priority:** P0
- **Dependencies:** None
- **Location:** `/Users/henrymascot/Code/entity/packages/app/src/config/runtime.ts`, `/Users/henrymascot/Code/entity/packages/app/src/App.tsx`
- **Description:** Add `VITE_ENTITY_FS_MULTISOURCE` runtime flag and guard new UI paths.
- **Acceptance Criteria:**
  - App exposes `runtime.fsMultiSourceEnabled`.
  - Existing `FileTree` and current file flow remain default when flag is false.
  - No regression in current file open/edit/save behavior.
- **Validation:**
  - `npm --prefix packages/app run build`
  - Manual: toggle env flag and confirm old/new UI path switching.
  - Completed on 2026-02-08: build passed.

### [x] FS-002: Server Feature Gate and FS Module Skeleton
- **Priority:** P0
- **Dependencies:** None
- **Location:** `/Users/henrymascot/Code/entity/packages/server/src/index.ts`, `/Users/henrymascot/Code/entity/packages/server/src/fs/types.ts` (new), `/Users/henrymascot/Code/entity/packages/server/src/fs/index.ts` (new)
- **Description:** Add server-side gate `ENTITY_FS_MULTISOURCE` and scaffold module entry points for new routes.
- **Acceptance Criteria:**
  - New FS routes can be mounted from a dedicated module.
  - Disabled flag does not affect legacy routes.
  - Route wiring compiles with no TypeScript errors.
- **Validation:**
  - `npm --prefix packages/server run build`
  - Completed on 2026-02-08: build passed.

## Sprint 1: Source Registry Backend

### [x] FS-010: Add DB Schema for Sources and Indexing Runs
- **Priority:** P0
- **Dependencies:** FS-002
- **Location:** `/Users/henrymascot/Code/entity/packages/db/src/index.ts`
- **Description:** Add bootstrap/migration for `file_sources`, `file_index`, `file_sync_runs` tables and indexes.
- **Acceptance Criteria:**
  - Tables are created idempotently at startup.
  - Indexes exist for source lookup and search fields.
  - Existing `tasks` and `activities` tables unaffected.
- **Validation:**
  - `npm --prefix packages/db run build`
  - Manual SQLite inspection confirms tables/indexes.
  - Completed on 2026-02-08: DB build passed.

### [x] FS-011: Implement File Source Repository in DB Layer
- **Priority:** P0
- **Dependencies:** FS-010
- **Location:** `/Users/henrymascot/Code/entity/packages/db/src/file-sources.ts` (new), `/Users/henrymascot/Code/entity/packages/db/src/index.ts`
- **Description:** Add typed CRUD repository for source records and sync metadata.
- **Acceptance Criteria:**
  - Supports create/list/get/update/delete/enable-disable operations.
  - Enforces basic source type validation.
  - `authRef` is stored, raw secret values are not.
- **Validation:**
  - `npm --prefix packages/db run build`
  - Manual smoke script creates and reads source records.
  - Completed on 2026-02-08: repository smoke flow passed via API route harness.

### [x] FS-012: `/api/sources` CRUD Endpoints
- **Priority:** P0
- **Dependencies:** FS-011
- **Location:** `/Users/henrymascot/Code/entity/packages/server/src/index.ts`, `/Users/henrymascot/Code/entity/packages/server/src/fs/routes-sources.ts` (new)
- **Description:** Implement:
  - `GET /api/sources`
  - `POST /api/sources`
  - `PUT /api/sources/:id`
  - `PATCH /api/sources/:id/enabled`
  - `DELETE /api/sources/:id`
- **Acceptance Criteria:**
  - Endpoints return stable JSON contracts.
  - Input validation errors return 400 with useful messages.
  - Disabled sources remain stored but excluded from default browse results.
- **Validation:**
  - `npm --prefix packages/server run build`
  - `curl` each endpoint and verify state transitions.
  - Completed on 2026-02-08: endpoint smoke harness validated create/list/update/enable-delete cycle.

### [x] FS-013: `/api/sources/:id/test` Connection Test Endpoint
- **Priority:** P1
- **Dependencies:** FS-012, FS-020
- **Location:** `/Users/henrymascot/Code/entity/packages/server/src/fs/routes-sources.ts`, `/Users/henrymascot/Code/entity/packages/server/src/fs/adapters/*`
- **Description:** Add a route that validates source connectivity through adapter-level `validate()`.
- **Acceptance Criteria:**
  - Returns health result (`ok`, `degraded`, `error`) and message.
  - Does not persist data unless explicit save/update is requested.
- **Validation:**
  - `curl -X POST /api/sources/:id/test` for valid and invalid sources.
  - Completed on 2026-02-08: endpoint implemented and validated in FS route smoke harness.

## Sprint 2: Adapters and Read APIs

### [x] FS-020: Source Adapter Interface and Registry
- **Priority:** P0
- **Dependencies:** FS-002
- **Location:** `/Users/henrymascot/Code/entity/packages/server/src/fs/adapters/types.ts` (new), `/Users/henrymascot/Code/entity/packages/server/src/fs/adapters/registry.ts` (new)
- **Description:** Create a uniform adapter contract (`validate`, `capabilities`, `list`, `read`, optional `search/write`).
- **Acceptance Criteria:**
  - Source type maps to adapter factory through one registry.
  - Unsupported types fail fast with explicit errors.
- **Validation:**
  - `npm --prefix packages/server run build`
  - Completed on 2026-02-08: server build passed with adapter contract and registry mappings.

### [x] FS-021: Local Source Adapter
- **Priority:** P0
- **Dependencies:** FS-020
- **Location:** `/Users/henrymascot/Code/entity/packages/server/src/fs/adapters/local.ts` (new)
- **Description:** Implement list/read for local filesystem roots with strict path boundary checks.
- **Acceptance Criteria:**
  - Can list and read under configured `basePath`.
  - Rejects traversal attempts and out-of-root reads.
- **Validation:**
  - `curl /api/fs/tree` and `/api/fs/file` against local source.
  - Negative test for `../` path traversal.
  - Completed on 2026-02-08: adapter smoke validated list/read + traversal guard.

### [x] FS-022: Docsify Source Adapter
- **Priority:** P0
- **Dependencies:** FS-020
- **Location:** `/Users/henrymascot/Code/entity/packages/server/src/fs/adapters/docsify.ts` (new)
- **Description:** Implement docsify listing and markdown read support.
- **Acceptance Criteria:**
  - Parses docsify structures into unified node shape.
  - Reads markdown by relative source path.
  - Handles endpoint errors with normalized messages.
- **Validation:**
  - Test with Ada/Spock/Henry docsify endpoints.
  - Completed on 2026-02-08: docsify adapter smoke validated listing + read.

### [x] FS-023: HTTP Markdown Adapter
- **Priority:** P1
- **Dependencies:** FS-020
- **Location:** `/Users/henrymascot/Code/entity/packages/server/src/fs/adapters/http-markdown.ts` (new)
- **Description:** Support simple remote markdown directory/file sources over HTTP.
- **Acceptance Criteria:**
  - Can read markdown file URLs and return content metadata.
  - Graceful failure for unsupported directory listing sources.
- **Validation:**
  - Manual source test with an HTTP markdown endpoint.
  - Completed on 2026-02-08: http-markdown adapter smoke validated remote read path.

### [x] FS-024: `GET /api/fs/tree` and `GET /api/fs/file`
- **Priority:** P0
- **Dependencies:** FS-021, FS-022
- **Location:** `/Users/henrymascot/Code/entity/packages/server/src/fs/routes-files.ts` (new), `/Users/henrymascot/Code/entity/packages/server/src/index.ts`
- **Description:** Implement source-aware browse/read endpoints:
  - `GET /api/fs/tree?sourceId=...&path=...`
  - `GET /api/fs/file?sourceId=...&path=...`
- **Acceptance Criteria:**
  - Requires valid `sourceId`.
  - Returns unified payload schema across adapter types.
  - Rejects disabled or unknown sources.
- **Validation:**
  - `curl` tree and file endpoints across at least local + docsify sources.
  - Completed on 2026-02-08: route harness validated source-aware tree/file responses.

### [x] FS-025: Security Controls for Source Access
- **Priority:** P0
- **Dependencies:** FS-024
- **Location:** `/Users/henrymascot/Code/entity/packages/server/src/fs/security.ts` (new), `/Users/henrymascot/Code/entity/packages/server/src/index.ts`
- **Description:** Centralize allowlisting, path normalization, auth header redaction, and audit logs for read access.
- **Acceptance Criteria:**
  - Path and URL validation is enforced before adapter calls.
  - Credentials are never written to logs.
  - Invalid/unsafe requests are blocked with explicit errors.
- **Validation:**
  - Negative tests for traversal, disallowed hosts, and malformed source IDs.
  - Completed on 2026-02-08: path traversal checks, allowlist hook, redaction, and audit logging added.

## Sprint 3: Frontend MVP (R1)

### [x] FS-030: Shared Frontend Types + API Client for Source FS
- **Priority:** P0
- **Dependencies:** FS-024
- **Location:** `/Users/henrymascot/Code/entity/packages/app/src/lib/http.ts`, `/Users/henrymascot/Code/entity/packages/app/src/hooks/useFileSources.ts` (new), `/Users/henrymascot/Code/entity/packages/app/src/types/filesystem.ts` (new)
- **Description:** Add typed fetch helpers and hooks for source list/tree/file/search operations.
- **Acceptance Criteria:**
  - Typed responses for source and node payloads.
  - Existing HTTP fallback patterns preserved.
- **Validation:**
  - `npm --prefix packages/app run build`
  - Completed on 2026-02-08: hook/types added and app build passed.

### [x] FS-031: Settings UI for File Sources
- **Priority:** P0
- **Dependencies:** FS-012, FS-013, FS-030
- **Location:** `/Users/henrymascot/Code/entity/packages/app/src/App.tsx`, `/Users/henrymascot/Code/entity/packages/app/src/components/settings/FileSourcesSettings.tsx` (new)
- **Description:** Add CRUD UI for sources under Admin/Settings, including test connection action.
- **Acceptance Criteria:**
  - User can create/edit/enable/disable/delete sources.
  - Source health and last sync fields are visible.
  - Input validation is shown inline.
- **Validation:**
  - Manual UI test across CRUD and connection testing.
  - Completed on 2026-02-08: settings panel added with create/edit/enable/disable/delete/test flows.

### [x] FS-032: Multi-Source Sidebar Tree Component
- **Priority:** P0
- **Dependencies:** FS-030, FS-031
- **Location:** `/Users/henrymascot/Code/entity/packages/app/src/components/SourceFileTree.tsx` (new), `/Users/henrymascot/Code/entity/packages/app/src/App.tsx`
- **Description:** Implement source-root mounts with per-source expand/collapse and loading/error states.
- **Acceptance Criteria:**
  - Enabled sources render as separate root sections.
  - Node expand/fetch behavior works for nested paths.
  - File click returns `{ sourceId, path }` selection.
- **Validation:**
  - Manual browse test across 2+ sources.
  - Completed on 2026-02-08: source-root tree with nested expansion and selection integrated.

### [x] FS-033: Source-Aware File Selection State
- **Priority:** P0
- **Dependencies:** FS-032
- **Location:** `/Users/henrymascot/Code/entity/packages/app/src/App.tsx`, `/Users/henrymascot/Code/entity/packages/app/src/components/QuickSwitcher.tsx`
- **Description:** Replace path-only state with source-aware selection model while preserving legacy compatibility.
- **Acceptance Criteria:**
  - Current file identity includes `sourceId` + `path`.
  - Legacy local edit mode still works for local source entries.
- **Validation:**
  - Manual open/read/edit flow for local source.
  - Manual open/read flow for docsify source.
  - Completed on 2026-02-08: app now tracks sourceId + path identity and read-only behavior.

### [x] FS-034: Reader Metadata Header
- **Priority:** P1
- **Dependencies:** FS-033
- **Location:** `/Users/henrymascot/Code/entity/packages/app/src/components/MarkdownPreview.tsx`, `/Users/henrymascot/Code/entity/packages/app/src/App.tsx`
- **Description:** Show source, path, updated time, type, and agent metadata above rendered content.
- **Acceptance Criteria:**
  - Metadata appears for multi-source files.
  - Header is hidden or minimal when metadata is unavailable.
- **Validation:**
  - Manual verification on files from multiple sources.
  - Completed on 2026-02-08: metadata header rendered for source-aware file reads.

### [x] FS-035: Unified File Dashboard (No-Selection View)
- **Priority:** P1
- **Dependencies:** FS-030, FS-033, FS-043
- **Location:** `/Users/henrymascot/Code/entity/packages/app/src/components/UnifiedFileDashboard.tsx` (new), `/Users/henrymascot/Code/entity/packages/app/src/App.tsx`
- **Description:** Build central discovery view with search + filters + results list/cards.
- **Acceptance Criteria:**
  - Filter by source/type/agent/date preset.
  - Result cards include preview and open actions.
  - Empty and error states handled.
- **Validation:**
  - Manual search/filter workflow test.
  - Completed on 2026-02-08: dashboard added with source/type/agent search and open action.

### [x] FS-036: QuickSwitcher Migration to Unified Search
- **Priority:** P1
- **Dependencies:** FS-043
- **Location:** `/Users/henrymascot/Code/entity/packages/app/src/components/QuickSwitcher.tsx`
- **Description:** Point quick switch to `/api/fs/search` and show source-aware labels.
- **Acceptance Criteria:**
  - Search results include source context.
  - Keyboard navigation behavior remains unchanged.
- **Validation:**
  - Manual `Cmd/Ctrl+P` flow with cross-source results.
  - Completed on 2026-02-08: QuickSwitcher supports unified search with source labels.

## Sprint 4: Indexing and Discovery (R2)

### [x] FS-040: Index Storage and Repository Layer
- **Priority:** P1
- **Dependencies:** FS-010
- **Location:** `/Users/henrymascot/Code/entity/packages/db/src/file-index.ts` (new), `/Users/henrymascot/Code/entity/packages/db/src/index.ts`
- **Description:** Add write/read/query APIs for `file_index` and sync run records.
- **Acceptance Criteria:**
  - Can upsert records keyed by `(sourceId, path)`.
  - Sync run metadata records start/end/status/error.
- **Validation:**
  - DB smoke test inserts and queries index rows.
  - Completed on 2026-02-08: index repository added and validated through index/search smoke harness.

### [x] FS-041: Background Index Runner
- **Priority:** P1
- **Dependencies:** FS-040, FS-021, FS-022, FS-023
- **Location:** `/Users/henrymascot/Code/entity/packages/server/src/fs/index-runner.ts` (new), `/Users/henrymascot/Code/entity/packages/server/src/index.ts`
- **Description:** Implement bounded-concurrency indexing job and periodic refresh trigger.
- **Acceptance Criteria:**
  - Runner skips disabled sources.
  - Sync status and timestamps are updated.
  - Errors are captured per source without crashing server.
- **Validation:**
  - Start server and observe sync run transitions.
  - Completed on 2026-02-08: runner implemented, sync run status observed in smoke harness.

### [x] FS-042: Metadata Classification Heuristics
- **Priority:** P2
- **Dependencies:** FS-041
- **Location:** `/Users/henrymascot/Code/entity/packages/server/src/fs/classify.ts` (new)
- **Description:** Derive `type`, `agent`, and recurrence hints from path/title/content patterns.
- **Acceptance Criteria:**
  - Daily/weekly/monthly recurrence patterns detected for common naming conventions.
  - Unknowns safely map to `one-off`/`other`.
- **Validation:**
  - Fixture-based manual verification against sample filenames.
  - Completed on 2026-02-08: classifier integrated into index runner.

### [x] FS-043: Unified Search Endpoint Using Index
- **Priority:** P1
- **Dependencies:** FS-040, FS-041
- **Location:** `/Users/henrymascot/Code/entity/packages/server/src/fs/routes-search.ts` (new), `/Users/henrymascot/Code/entity/packages/server/src/index.ts`
- **Description:** Implement `GET /api/fs/search` with source/type/agent/date filters, preview snippets, and fallback behavior.
- **Acceptance Criteria:**
  - Returns relevant filtered results with source metadata.
  - Fallback to adapter listing if index is stale/unavailable.
- **Validation:**
  - `curl` search with filter combinations and verify payload shape.
  - Completed on 2026-02-08: indexed and fallback search responses validated in route harness.

## Sprint 5: Hardening and Rollout

### [x] FS-050: Source Health and Access Observability
- **Priority:** P1
- **Dependencies:** FS-024, FS-041
- **Location:** `/Users/henrymascot/Code/entity/packages/server/src/index.ts`, `/Users/henrymascot/Code/entity/packages/server/src/fs/metrics.ts` (new)
- **Description:** Add logging/metrics for source health, read/search latency, and index freshness.
- **Acceptance Criteria:**
  - Per-source health status is updated from test/index/read outcomes.
  - Latency and error counters are observable in server logs/metrics surface.
- **Validation:**
  - Manual inspection of logs during browse/search/index cycles.
  - `GET /api/fs/metrics` shows global operation metrics and per-source health/freshness/error state.
  - Completed on 2026-02-08: metrics module + `/api/fs/metrics` surface wired for test/read/tree/search/index operations.

### [x] FS-051: Regression and Acceptance Test Pass
- **Priority:** P0
- **Dependencies:** FS-036
- **Location:** `/Users/henrymascot/Code/entity/e2e/` (existing), `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-TEST-PLAN.md` (new)
- **Description:** Add/execute test plan for R1 and R2 acceptance criteria, including legacy compatibility checks.
- **Acceptance Criteria:**
  - Legacy local file create/edit/save flow still works.
  - Multi-source browse/read/search works for at least 3 source types.
  - QuickSwitcher returns source-aware results.
- **Validation:**
  - `npm test`
  - Manual acceptance checklist complete.
  - `node /Users/henrymascot/Code/entity/scripts/fs-regression-smoke.mjs`
  - Completed on 2026-02-08: regression smoke passed for legacy + multisource flows; test plan documented in `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-TEST-PLAN.md`.

### [x] FS-052: Rollout and Rollback Playbook
- **Priority:** P1
- **Dependencies:** FS-051
- **Location:** `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-ROLLOUT.md` (new), `/Users/henrymascot/Code/entity/docs/decisions.md`
- **Description:** Document launch sequencing, feature-flag strategy, and rollback steps.
- **Acceptance Criteria:**
  - Contains enablement stages (internal -> selected -> default).
  - Contains explicit rollback trigger conditions and commands.
  - Linked from project docs.
- **Validation:**
  - Team can execute dry-run rollout from document alone.
  - Completed on 2026-02-08: rollout playbook added at `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-ROLLOUT.md` and recorded in `/Users/henrymascot/Code/entity/docs/decisions.md`.

## Endpoint-by-Endpoint Ticket Mapping (R1)

| Endpoint | Owning Ticket |
|---|---|
| `GET /api/sources` | FS-012 |
| `POST /api/sources` | FS-012 |
| `PUT /api/sources/:id` | FS-012 |
| `PATCH /api/sources/:id/enabled` | FS-012 |
| `DELETE /api/sources/:id` | FS-012 |
| `POST /api/sources/:id/test` | FS-013 |
| `GET /api/fs/tree` | FS-024 |
| `GET /api/fs/file` | FS-024 |
| `GET /api/fs/search` | FS-043 |

## Parallel Work Suggestions
- Run FS-001 and FS-002 in parallel.
- Run FS-021, FS-022, FS-023 in parallel after FS-020.
- Run FS-031 and FS-030 in parallel once FS-012 is available.
- Run FS-034 and FS-036 in parallel after FS-033 and FS-043.

## Definition of Done (Program-Level)
- R1 acceptance criteria from PRD are met and validated.
- Legacy local file flow remains stable.
- Multi-source browsing and reading is production-usable for local + docsify + http-markdown.
- Rollback path is tested and documented.
