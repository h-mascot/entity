# Entity Engineering todo.md import mapping

## Authority and safety

- Linear: THE-852 / EE-B-04; dependency THE-851 is Done.
- Consolidated source packet SHA-256: `84541727830ef8f4018ad2b9fdf587d653dfbba940b38b279ae3f90ca18ba895`.
- Retrieved QMD todo snapshot SHA-256: `e2715adba665d61f8d467a550737364f57595bef53deb73e460505d0f2842bcc`.
- Coverage: 181 checklist rows (127 open, 54 completed).
- This artifact is plan-only: it creates no task, writes no database, and performs no production promotion.
- Raw todo notes are intentionally not copied; the CSV retains sanitized titles, source lines, sections, and fingerprints.

## Deterministic rules

1. Every checklist row receives exactly one disposition; unmatched open rows fail generation.
2. Completed rows are excluded. Exact duplicates/status variants merge into one canonical source line.
3. Loaded Linear/source-packet work links to existing issues instead of creating duplicates.
4. Deep runtime/provider/config work routes to Helm or its owning runtime; manual OAuth/destructive work is excluded.
5. Q47/Q48/Q50/Q58/Q60 deferrals remain deferred; Q62+ is not authority.
6. Import candidates use `entity-engineering`, backlog state, and a title-derived SHA-256 key.
7. `verify_then_create` candidates must be checked against current `origin/main` and existing Linear titles before creation.
8. No manual OAuth, destructive-data, or production-only item is eligible for import.

## Disposition totals

| Disposition | Rows |
|---|---:|
| `defer_by_roadmap` | 21 |
| `exclude_completed` | 54 |
| `exclude_external_or_noncoding` | 15 |
| `exclude_manual_or_destructive` | 6 |
| `exclude_stale_or_status` | 15 |
| `import_candidate` | 7 |
| `link_existing_linear` | 21 |
| `merge_duplicate` | 15 |
| `route_external_runtime_owner` | 27 |

## Canonical import candidates

| Source | Candidate | Action | Lane | Risk | Stable key | Prerequisite |
|---:|---|---|---|---|---|---|
| 28 | Agent Focus Tracking in Sidebar (story 5) | `verify_then_create` | `app-ui` | `low` | `todo-agent-focus-tracking-in-sidebar-story-5-033c333052aa` | Confirm source patch is absent from origin/main |
| 31 | Split Pane View (story 8) | `verify_then_create` | `app-ui` | `low` | `todo-split-pane-view-story-8-73a661272a65` | Confirm source patch is absent from origin/main |
| 34 | Auto-Follow Agent Files (story 4) | `verify_then_create` | `app-ui` | `low` | `todo-auto-follow-agent-files-story-4-b63aadd8b14f` | Confirm source patch is absent from origin/main |
| 39 | GitHub→Gateway deploy path with self-hosted runner or webhook deployer | `verify_then_create` | `delivery-infrastructure` | `high` | `todo-github-gateway-deploy-path-with-self-hosted-runn-5596f4e947a0` | No production promotion; verify current webhook/pipeline completion semantics |
| 90 | Production-ready server (not ts-node, 166 TS errors in dist) | `verify_then_create` | `server-build` | `medium` | `todo-production-ready-server-not-ts-node-166-ts-error-003591088191` | Reproduce against current origin/main; historical error count is not authority |
| 92 | Browser testing of Activity Stream grouping | `create` | `app-test` | `low` | `todo-browser-testing-of-activity-stream-grouping-3e025d19cc70` | Stable local browser fixture |
| 96 | Auto-Subtask Breakdown | `create` | `task-product` | `medium` | `todo-auto-subtask-breakdown-e1942e588c8f` | Workplanes slice 1 and task hierarchy contract |

## Landing protocol for EE-B-05/06

1. EE-B-05 reads only rows with `disposition=import_candidate` and performs a no-write dry run.
2. Scope every key as `(project_id, source_system='entity-todo', source_key)`; title/fuzzy matching is advisory only.
3. Revalidate `verify_then_create` rows against current source and close them as stale if already landed.
4. EE-B-06 must add an import ledger with a database `UNIQUE(project_id, source_system, source_key)` constraint.
5. Create the task, its `task_import_keys` ledger row, and `metadata.engineering_import` provenance in one transaction.
6. A unique conflict returns the ledger-linked task; the importer must never use `create_anyway`.
7. Preserve source line, source fingerprint, todo snapshot SHA, mapping SHA, and import actor in provenance.
8. Use append-only receipt identity `ee-b-06:<todo_sha>:<mapping_sha>:<approved_set_sha>`; never overwrite a prior receipt.
9. Refuse unresolved project identity, changed source/mapping hash, prerequisite failure, or ledger/task drift.

Required future ledger shape:

```sql
CREATE TABLE task_import_keys (
  project_id INTEGER NOT NULL,
  source_system TEXT NOT NULL,
  source_key TEXT NOT NULL,
  task_id INTEGER NOT NULL UNIQUE,
  source_fingerprint TEXT NOT NULL,
  source_snapshot_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, source_system, source_key)
);
```

Full row-level decisions are in `entity-engineering-import-mapping.csv`; normalized source identity is in `entity-engineering-import-mapping-source.csv`.
