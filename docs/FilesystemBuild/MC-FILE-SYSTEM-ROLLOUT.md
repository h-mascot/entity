# MC File System Rollout and Rollback Playbook

**Date:** February 8, 2026  
**Feature:** Multi-source file system (`ENTITY_FS_MULTISOURCE` / `VITE_ENTITY_FS_MULTISOURCE`)

## 1. Rollout Strategy

Roll out in 3 stages with explicit checks between each stage.

### Stage A: Internal Validation (default)
- Server flag: `ENTITY_FS_MULTISOURCE=true`
- App flag: `VITE_ENTITY_FS_MULTISOURCE=true` for internal users only
- Indexer flag: `ENTITY_FS_INDEXER_ENABLED=true`
- Verify:
  - `/api/fs/health` returns `200`
  - `/api/fs/metrics` returns operation and per-source health payload
  - `/api/sources/:id/test` passes for configured sources

Exit criteria:
- No critical errors in tree/read/search flows for 24 hours.

### Stage B: Selected User Cohort
- Keep feature flags on for selected operators.
- Add 2+ real sources (local + docsify/http-markdown) and validate:
  - browse/read on each source
  - quick switcher and dashboard results across sources
  - index freshness and sync status

Exit criteria:
- No Sev-1/Sev-2 issues in 3 consecutive business days.

### Stage C: Default-On
- Enable `ENTITY_FS_MULTISOURCE=true` and `VITE_ENTITY_FS_MULTISOURCE=true` in default environment configs.
- Keep legacy endpoints (`/api/files`, `/api/file`, `/api/search`) active for compatibility.

Exit criteria:
- Error rate stable, operator workflows unaffected, rollback not triggered.

## 2. Operational Monitoring

Use `/api/fs/metrics` as primary operational endpoint:

- Global operation metrics: `fs.tree`, `fs.file`, `fs.search`, `sources.test`, `index.source`
- Per-source state:
  - `health`
  - `lastSyncedAt`
  - `freshnessSeconds`
  - `operations` (latency/error counters)
  - `latestSyncRun`
  - `lastError` / `lastErrorAt`

## 3. Rollback Triggers

Trigger rollback immediately if any condition is met:

1. `fs.file` or `fs.tree` error rate > 10% for 10+ minutes.
2. Any source repeatedly transitions to `error` and blocks core operator workflows.
3. Legacy local file edit flow fails (`POST/PUT/GET /api/file`) in production.
4. Critical UI regression in Files tab prevents document access.

## 4. Rollback Procedure

### Immediate rollback (safe mode)
1. Set server flag off: `ENTITY_FS_MULTISOURCE=false`
2. Set app flag off: `VITE_ENTITY_FS_MULTISOURCE=false`
3. Redeploy app/server.
4. Confirm:
   - Legacy endpoints still respond (`/api/files`, `/api/file`, `/api/search`)
   - Files UI falls back to legacy tree

### Partial rollback (if only indexer is unstable)
1. Keep multisource on.
2. Disable background indexing: `ENTITY_FS_INDEXER_ENABLED=false`
3. Redeploy server.
4. Confirm fallback search and direct tree/read still work.

## 5. Dry-Run Checklist

Before each production stage change, run:

1. `npm --prefix packages/db run build`
2. `npm --prefix packages/server run build`
3. `npm --prefix packages/app run build`
4. `node /Users/henrymascot/Code/entity/scripts/fs-regression-smoke.mjs`

Required outcome: all pass.

## 6. Ownership

- Release owner: Mission Control operator on duty
- Incident owner: backend/server maintainer
- Decision log update location: `/Users/henrymascot/Code/entity/docs/decisions.md`
