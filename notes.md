# Notes: MC File System Improvement PRD

## Sources

### Source: `docs/context.md`
- Entity is a monorepo with React app, Express server, SQLite DB layer, desktop and mobile clients.
- Existing file flow centers on local workspace browsing + markdown editing.
- MC is already integrated; file system work should not destabilize MC flows.

### Source: `docs/todo.md`
- Infrastructure and watch mode items are active.
- File system improvements should be staged and avoid deep platform rewrite in one sprint.

### Source: `docs/MC-FILE-SYSTEM-IMPROVEMENT.md` (existing draft)
- Strong vision exists: unified file browser across agent vaults/docsify/workspaces.
- Needs tighter scope, clearer architecture boundaries, and acceptance criteria.

### Source: `packages/app/src/components/FileTree.tsx`
- Current tree is single-root (`WORKSPACE`) and polls folders every 5s.
- Has filter input and expansion state, but not multi-source mounting.
- Context menu and create actions are TODO placeholders.

### Source: `packages/app/src/components/QuickSwitcher.tsx`
- Search uses `/api/search?q=...` and returns up to 10 filename matches.
- No source-aware metadata and no content indexing.

### Source: `packages/server/src/index.ts`
- Existing local APIs:
  - `GET /api/files?path=...`
  - `GET /api/file?path=...`
  - `PUT /api/file?path=...`
  - `POST /api/file`
  - `DELETE /api/file?path=...`
  - `POST /api/file/move`
  - `GET /api/search?q=...`
- Current behavior is local filesystem access based on `WORKSPACE`; no source registry.

## Synthesized Findings

### Product Direction
- The right direction is a "source registry + unified index + reader" model.
- Start read-only and controlled, then add write-back per-source with capability flags.

### Technical Constraints
- Current APIs can remain for local workspace compatibility.
- New multi-source APIs should be additive, then UI can migrate gradually.
- Source adapters are required for docsify/http/local/git/s3 to avoid coupling.

### Delivery Strategy
- Phase 1 should ship source registry + browse/read + basic source filter.
- Phase 2 should add indexing, better search, recurring detection, and metadata extraction.
- Phase 3+ can add auth hardening, write-back, and desktop-native enhancements.

## Checklist Output

### Deliverable
- Created `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-IMPLEMENTATION-CHECKLIST.md`.
- Added direct reference link in `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-IMPROVEMENT.md`.

### Ticket Model
- Atomic IDs (`FS-001` ... `FS-052`) grouped by sprint.
- Each ticket includes location, dependencies, acceptance criteria, and validation.
- Endpoint map added for R1 API tracking.

## Sprint 0 Execution Notes (2026-02-08)

### FS-001 Implemented
- Added `VITE_ENTITY_FS_MULTISOURCE` support in runtime config.
- Added `runtime.fsMultiSourceEnabled` flag.
- Added `renderFileSidebarTree()` in app shell to gate future multi-source UI path while preserving existing `FileTree` behavior.

### FS-002 Implemented
- Added server feature gate `ENTITY_FS_MULTISOURCE`.
- Created new server module:
  - `/Users/henrymascot/Code/entity/packages/server/src/fs/types.ts`
  - `/Users/henrymascot/Code/entity/packages/server/src/fs/index.ts`
- Mounted dedicated `/api/fs` router only when gate is enabled.
- Added scaffold endpoints:
  - `GET /api/fs/health` (ready)
  - `GET /api/fs/tree` (501 placeholder)
  - `GET /api/fs/file` (501 placeholder)
  - `GET /api/fs/search` (501 placeholder)

### Validation Completed
- `npm --prefix packages/app run build` passed.
- `npm --prefix packages/server run build` passed.

## Loop to 20% (2026-02-08)

### Completed Tickets This Loop
- FS-010: DB schema for `file_sources`, `file_index`, `file_sync_runs`.
- FS-011: File source repository (`packages/db/src/file-sources.ts`).
- FS-012: `/api/sources` CRUD endpoints (`packages/server/src/fs/routes-sources.ts`).
- FS-020: Adapter contract + registry scaffolding (`packages/server/src/fs/adapters/*`).

### Validation
- `npm --prefix packages/db run build` passed.
- `npm --prefix packages/server run build` passed.
- Source endpoint smoke harness passed (create/list/update/enable-delete).

### Artifacts Added
- Ralph loop: `/Users/henrymascot/Code/entity/scripts/ralph/mc-file-system-prd.json`
- Full test cases: `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-TEST-CASES.md`

## Sprint 2-4 Completion (2026-02-08)

### Sprint 2 (Backend Source Access)
- Implemented `FS-013` source test endpoint.
- Implemented adapters:
  - local (`packages/server/src/fs/adapters/local.ts`)
  - docsify (`packages/server/src/fs/adapters/docsify.ts`)
  - http-markdown (`packages/server/src/fs/adapters/http-markdown.ts`)
- Implemented source-aware file routes:
  - `GET /api/fs/tree`
  - `GET /api/fs/file`
- Implemented security/audit guardrails in `packages/server/src/fs/security.ts`.

### Sprint 3 (Frontend Source UX)
- Added typed FS models and source hook:
  - `packages/app/src/types/filesystem.ts`
  - `packages/app/src/hooks/useFileSources.ts`
- Added settings UI:
  - `packages/app/src/components/settings/FileSourcesSettings.tsx`
- Added multi-source tree and dashboard:
  - `packages/app/src/components/SourceFileTree.tsx`
  - `packages/app/src/components/UnifiedFileDashboard.tsx`
- Wired source-aware file selection and read-only handling in `packages/app/src/App.tsx`.
- Migrated quick switcher to unified search mode when feature flag is enabled.

### Sprint 4 (Indexing + Unified Search)
- Added index repository: `packages/db/src/file-index.ts`.
- Added classification and index runner:
  - `packages/server/src/fs/classify.ts`
  - `packages/server/src/fs/index-runner.ts`
- Added unified search endpoint route: `packages/server/src/fs/routes-search.ts`.
- Mounted runner and fs routes in `packages/server/src/fs/index.ts`.

### Validation Summary
- `npm --prefix packages/db run build` passed.
- `npm --prefix packages/server run build` passed.
- `npm --prefix packages/app run build` passed.
- Adapter smoke (`local/docsify/http-markdown`) passed.
- FS route smoke (`/api/sources/test`, `/api/fs/tree`, `/api/fs/file`, `/api/fs/search`) passed.

## Sprint 5 Completion (2026-02-08)

### FS-050 Observability
- Added metrics tracking in `/Users/henrymascot/Code/entity/packages/server/src/fs/metrics.ts`.
- Added `GET /api/fs/metrics` with operation latency/error counters and per-source health/freshness/sync metadata.
- Wired source health updates into source test, file read/tree, search, and index operations.

### FS-051 Regression and Acceptance
- Added and executed `/Users/henrymascot/Code/entity/scripts/fs-regression-smoke.mjs`.
- Verified legacy file flow, source lifecycle, multisource tree/file/search, traversal blocking, and metrics endpoint.
- Recorded results in `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-TEST-PLAN.md`.

### FS-052 Rollout and Rollback
- Added rollout/rollback playbook: `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-ROLLOUT.md`.
- Added decision log entry in `/Users/henrymascot/Code/entity/docs/decisions.md`.
- Linked implementation artifacts from `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-IMPROVEMENT.md`.
