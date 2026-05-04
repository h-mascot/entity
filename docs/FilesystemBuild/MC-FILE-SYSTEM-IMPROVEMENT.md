# MC File System Improvement PRD

> Make Entity the default file workspace for Enterprise agents and humans by unifying multi-source browsing, reading, and search in one interface.

## Implementation Artifacts

- Checklist: `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-IMPLEMENTATION-CHECKLIST.md`
- Test cases: `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-TEST-CASES.md`
- Test plan/results: `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-TEST-PLAN.md`
- Rollout playbook: `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-ROLLOUT.md`

## 1) Context

Entity already ships:
- Local workspace file browsing and editing (`FileTree`, `CodeMirrorEditor`, `MarkdownPreview`)
- Quick file search (`QuickSwitcher` -> `/api/search`)
- Real-time file change broadcast over WebSocket
- Mission Control views integrated in the same app shell

Current limitation:
- File access is effectively single-root and local (`WORKSPACE`)
- Agent outputs are fragmented across docsify endpoints, remote workspaces, and local folders
- Search and filtering are not source-aware and do not support unified metadata discovery

This PRD defines a phased upgrade to a multi-source file system layer without breaking existing local editing flows.

## 2) Problem Statement

Users cannot reliably answer: "Where is the latest output from Ada/Spock/Scotty?" from within Entity.

Primary pain points:
- Multiple file surfaces (docsify links, local folders, ad-hoc paths) with no canonical UI
- No source-level controls (enable/disable, health, auth, sync status)
- No unified filtering by agent/type/date/recurrence
- Filename-only search in current QuickSwitcher workflow
- High context-switching cost between writing, reviewing, and retrieval

## 3) Goals

1. Unified browse/read experience across configured file sources inside Entity.
2. Source-aware discovery (filter + search) with useful metadata.
3. Preserve current local file workflows while introducing multi-source support.
4. Ship an MVP quickly with controlled risk (read-first, additive APIs).

## 4) Non-Goals (Initial Releases)

- Full write-back for every source type in MVP
- Full-text indexing across extremely large archives on day one
- Replacing Mission Control task model or task APIs
- Introducing a new external search engine dependency in MVP

## 5) Users & Jobs To Be Done

### Primary Users
- Henry (operator): find and review agent outputs fast.
- Ada/Spock/Scotty (agent workflows): reference and open shared artifacts in predictable paths.

### Jobs
- "Show me all daily reviews from the last 7 days."
- "Open the latest business review from Spock."
- "Find PRD files mentioning 'watch mode' across sources."
- "Browse remote source trees as naturally as local folders."

## 6) Scope and Phasing

## Release 1 (MVP): Unified Read Layer

### In Scope
- File Sources settings UI (create/edit/enable/disable/delete source)
- Multi-source sidebar mounts (collapsible source roots)
- Source-aware file browse/read
- Unified file dashboard view when no file is selected
- Basic structured filter (source, agent, type, date preset)
- Additive backend APIs for source registry + source file operations
- Backward compatibility for current `/api/files` and `/api/file` local workflows

### Out of Scope
- Cross-source write-back (except existing local source behavior)
- Deep recurrence intelligence
- GitHub/S3 connectors beyond basic stubs

## Release 2: Indexing and Discovery

### In Scope
- Background indexing pipeline per source
- Content preview extraction + metadata enrichment
- Better quick switch/search using index
- Recurring-series grouping (daily/weekly/monthly heuristics)

## Release 3: Advanced Connectors and Controlled Write-Back

### In Scope
- Source-specific auth hardening
- Capability-gated write actions (`read-only`, `write`, `rename`, `delete`)
- Connector expansion (GitHub, S3, cross-gateway workspace adapters)
- Desktop optimizations for local + relay sources

## 7) Product Requirements

### 7.1 Settings -> File Sources

Each source stores:
- `displayName`
- `type` (`local`, `docsify`, `http-markdown`, `github`, `s3`, `custom`)
- `baseUrl` or `basePath`
- Optional auth config
- `enabled` flag
- Optional icon/emoji
- Capability flags (resolved by adapter)

Required UX:
- Add source modal with validation + "Test connection"
- Edit source config
- Enable/disable without deleting
- Last sync + health/error badge

### 7.2 Sidebar: Source Mounts

Required behavior:
- Render each enabled source as a root mount
- Expand/collapse per source and per folder
- Show loading/error states per mount
- Select file opens in main reader pane
- Distinguish same-named files by source context

### 7.3 Main Area: Unified File Dashboard

Shown when no file is selected.

Required sections:
- Search input
- Filter row
- Result cards/table with metadata + preview
- Quick actions (`Open`, `Copy Link`, `Open Source`)

Filter dimensions:
- Source
- Agent (`Ada`, `Spock`, `Scotty`, `Henry`, `Other`)
- Type (`daily-review`, `business-review`, `blog`, `prd`, `project-doc`, `script`, `one-off`)
- Date preset (`today`, `last 7 days`, `last 30 days`, `custom`)
- Recurrence (`all`, `recurring`, `one-off`) in R2+

### 7.4 Reader Pane

Required behavior:
- Render markdown content with current `MarkdownPreview` pipeline
- Show metadata header: source, path, updated time, type, agent
- Allow opening source-native location
- Keyboard support: escape close, cmd/ctrl+f local find

### 7.5 Search Integration

R1:
- Query over indexed metadata + filename where available
- Fallback to connector-specific list matching when index is not ready

R2:
- Indexed content search with snippets/highlights
- QuickSwitcher consumes unified search endpoint

## 8) Technical Requirements

### 8.1 Source Adapter Contract

All source connectors implement a common interface:

```ts
type SourceCapability = {
  read: boolean;
  write: boolean;
  rename: boolean;
  delete: boolean;
  list: boolean;
  search: boolean;
};

type SourceNode = {
  sourceId: string;
  path: string;
  name: string;
  isDirectory: boolean;
  size?: number;
  updatedAt?: string;
};

interface FileSourceAdapter {
  validate(config: FileSourceConfig): Promise<void>;
  capabilities(): SourceCapability;
  list(path: string): Promise<SourceNode[]>;
  read(path: string): Promise<{ content: string; contentType: string; updatedAt?: string }>;
  search?(query: string, opts?: { limit?: number }): Promise<SourceNode[]>;
  write?(path: string, content: string): Promise<void>;
  move?(from: string, to: string): Promise<void>;
  remove?(path: string): Promise<void>;
}
```

### 8.2 Backend API (Additive)

New APIs (R1):
- `GET /api/sources`
- `POST /api/sources`
- `PUT /api/sources/:id`
- `PATCH /api/sources/:id/enabled`
- `DELETE /api/sources/:id`
- `POST /api/sources/:id/test`

- `GET /api/fs/tree?sourceId=...&path=...`
- `GET /api/fs/file?sourceId=...&path=...`
- `GET /api/fs/search?q=...&sourceId=...&type=...&agent=...&from=...&to=...`

Legacy compatibility:
- Keep existing local endpoints (`/api/files`, `/api/file`, `/api/search`) for current UI flows.
- Migrate `FileTree` and `QuickSwitcher` to new APIs incrementally.

### 8.3 Data Model

```ts
interface FileSource {
  id: string;
  displayName: string;
  type: 'local' | 'docsify' | 'http-markdown' | 'github' | 's3' | 'custom';
  baseUrl?: string;
  basePath?: string;
  authType?: 'none' | 'bearer' | 'api-key' | 'basic' | 'ssh';
  authRef?: string; // reference to secure secret store
  enabled: boolean;
  icon?: string;
  capabilities: SourceCapability;
  health: 'ok' | 'degraded' | 'error';
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface FileIndexRecord {
  id: string;
  sourceId: string;
  path: string;
  title: string;
  type: 'daily-review' | 'business-review' | 'blog' | 'prd' | 'project-doc' | 'script' | 'one-off';
  agent: 'ada' | 'spock' | 'scotty' | 'henry' | 'other';
  isRecurring: boolean;
  recurringPattern?: 'daily' | 'weekly' | 'monthly';
  tags: string[];
  updatedAt?: string;
  indexedAt: string;
  preview?: string;
}
```

Suggested DB tables:
- `file_sources`
- `file_index`
- `file_sync_runs`

### 8.4 Frontend Integration Plan

1. Introduce source registry UI in Admin/Settings.
2. Build `SourceFileTree` (multi-root) and feature-flag it.
3. Add unified dashboard view for file discovery.
4. Upgrade `QuickSwitcher` to unified search endpoint.
5. Keep existing `FileTree` path as fallback until stabilization.

## 9) Security and Access Controls

Required controls:
- Default all new sources to read-only unless explicitly write-enabled.
- Path traversal protection and strict path normalization in adapters.
- Token/credential material stored via secure references, never plain logs.
- Source-level allowlisting (host/path).
- Per-request audit event for read/write operations.

## 10) Performance and Reliability

Targets:
- Tree expand response p95 < 500ms for warm paths.
- Open file response p95 < 700ms for markdown files under 1 MB.
- Unified search response p95 < 900ms for first 20 results.

Operational requirements:
- Cache list/read responses with short TTL for remote sources.
- Background index runs with bounded concurrency.
- Retries with backoff for transient remote source errors.
- Clear source-specific error UX with retry actions.

## 11) Observability

Track:
- Source health by connector type
- Index freshness lag (`now - lastSyncedAt`)
- Search latency and empty-result rate
- File open success/error rate
- Most-used sources and filters

## 12) Rollout Plan

1. Internal feature flag: `entity.fs.multisource`.
2. Enable for local + docsify sources first.
3. Migrate sidebar and reader in stages while preserving existing endpoints.
4. Enable unified QuickSwitcher search.
5. Expand to additional connector types after stability window.

Rollback:
- Disable feature flag to revert to existing local-only tree/search behavior.

## 13) Acceptance Criteria

### R1 Exit Criteria
- User can add/edit/enable/disable at least 3 source types (`local`, `docsify`, `http-markdown`).
- Sidebar shows enabled sources and supports folder navigation.
- User can open and read markdown files from any enabled source.
- Unified dashboard filters by source/type/agent/date presets.
- Existing local edit flow remains functional.

### R2 Exit Criteria
- Unified indexed search returns results across enabled sources.
- QuickSwitcher uses unified search and shows source metadata.
- Recurring-series identification works for daily/weekly/monthly naming patterns.

## 14) Risks and Mitigations

- Risk: connector inconsistency across source types.
  - Mitigation: strict adapter interface + capability checks.

- Risk: degraded UX from slow remote sources.
  - Mitigation: caching, async loading states, per-source health indicators.

- Risk: security issues from arbitrary path/URL access.
  - Mitigation: allowlists, path guards, read-only defaults, credential isolation.

- Risk: migration regressions in current file workflows.
  - Mitigation: additive APIs + feature flag + fallback to legacy tree.

## 15) Open Questions

1. Should local source write actions be enabled in R1 or deferred to R3 gating?
2. Should source configuration live in SQLite only, or sync to a cloud profile later?
3. What is the default index refresh cadence per source type?
4. How should mobile show source trees and filters without overcrowding?

## 16) References

- `/Users/henrymascot/Code/entity/docs/context.md`
- `/Users/henrymascot/Code/entity/docs/todo.md`
- `/Users/henrymascot/Code/entity/docs/MC-FILE-SYSTEM-IMPLEMENTATION-CHECKLIST.md`
- `/Users/henrymascot/Code/entity/packages/app/src/components/FileTree.tsx`
- `/Users/henrymascot/Code/entity/packages/app/src/components/QuickSwitcher.tsx`
- `/Users/henrymascot/Code/entity/packages/server/src/index.ts`
