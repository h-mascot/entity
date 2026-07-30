# THE-862 / WP1-B-01 — Workplane task summary panel

**Decision:** IMPLEMENTED  
**Date:** 2026-07-30  
**Worktree:** `/Users/enterprise/Code/entity-the-862-wp1-b-01`  
**Depends on:** THE-861 / WP1-A-06 (deep-link refresh restore)

## Purpose

Replace the Workplane `task_summary` panel placeholder with a real summary section that shows concise task context and explicit empty / loading / error states.

## Modules

| Path | Role |
| --- | --- |
| `packages/app/src/lib/workplaneTaskSummary.ts` | Pure normalize + load envelope + `/tasks/:id` fetch helper |
| `packages/app/src/components/workplane/TaskSummaryPanel.tsx` | Presentational empty/loading/error/ready UI |
| `packages/app/src/components/workplane/WorkplaneShell.tsx` | Loads summary for current task; wires panel + retry |

## Behavior

| State | When | UI |
| --- | --- | --- |
| `loading` | Fetch in flight for a valid task id | “Loading task summary…” |
| `ready` | Valid task payload | Title, `#id`, status, review, proof context |
| `empty` | No task id, 404, or invalid payload | Explicit “No task available” |
| `error` | Transport/server failure | Alert + Retry |

Non-summary panels remain placeholders (THE-863+).

## Non-goals honored

- No ProofBundle normalization (THE-863/THE-864)
- No files/docs / missing-proof dedicated panels (THE-865/THE-866)
- No layout lock / mobile smoke (THE-867/THE-868)
- No invented Engineering board data / no DB schema changes
