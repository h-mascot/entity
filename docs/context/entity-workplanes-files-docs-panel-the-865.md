# THE-865 / WP1-B-04 — Files/docs panel linked to Doc Hub openers

**Decision:** IMPLEMENTED
**Date:** 2026-07-31
**Worktree:** `/Users/enterprise/Code/entity-the-865-wp1-b-04`
**Depends on:** THE-862 / WP1-B-01 (task summary); THE-864 / WP1-B-03 Done at `622c878`

## Purpose

Render a Workplane files/docs panel for task-linked documents and files, linking open actions to existing Doc Hub source routes (`/docs/source/:sourceId/...`) or external/docs-route fallbacks. Fail-closed when nothing is linked or when objects are restricted.

## Modules

| Path | Role |
| --- | --- |
| `packages/app/src/lib/workplaneFilesDocs.ts` | Normalize linked docs/files + Doc Hub opener builder + load envelope |
| `packages/app/src/lib/workplaneFilesDocs.test.ts` | Linked rows, opener hrefs, empty/degraded, shell wiring |
| `packages/app/src/components/workplane/FilesDocsPanel.tsx` | Presentational panel UI |
| `packages/app/src/components/workplane/WorkplaneShell.tsx` | Loads files/docs; wires `files_docs` panel |

## Behavior

| State | When | UI |
| --- | --- | --- |
| `loading` | Fetch in flight for a valid task id | “Loading files and docs…” |
| `ready` + items | Valid task with linked docs/files | Kind counts + rows with Doc Hub/external openers |
| `ready` + empty | Valid task, no linked docs/files | Explicit “No linked files or docs” |
| `empty` | No task id, 404, or invalid payload | Explicit “No files or docs available” |
| `error` | Transport/server failure | Alert + Retry |

Doc Hub openers prefer `buildDocHubRoutePath(resolveDocHubRouteTarget(href))`. Restricted objects keep titles redacted and openers unavailable.

## Non-goals honored

- No Doc Hub rebuild
- No dedicated missing-proof warning panel (THE-866)
- No layout lock / mobile smoke (THE-867 / THE-868)
- No invented Engineering import data / no DB schema / no prod mutation
