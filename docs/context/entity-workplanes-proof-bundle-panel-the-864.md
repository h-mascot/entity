# THE-864 / WP1-B-03 — Proof bundle panel

**Decision:** IMPLEMENTED
**Date:** 2026-07-31
**Worktree:** `/Users/enterprise/Code/entity-the-864-wp1-b-03`
**Depends on:** THE-863 / WP1-B-02 (`normalizeProofBundle` at `d90b636`)

## Purpose

Render a Workplane proof bundle panel that consumes THE-863 normalization and clearly distinguishes `raw` / `curated` / `external` / `unknown` proof items, with fail-closed empty/loading/error/malformed behavior.

## Modules

| Path | Role |
| --- | --- |
| `packages/app/src/lib/workplaneProofBundle.ts` | Load envelope + selection tokens + kind counts |
| `packages/app/src/lib/workplaneProofBundle.test.ts` | raw/curated/external/unknown + empty/malformed + shell wiring |
| `packages/app/src/components/workplane/ProofBundlePanel.tsx` | Presentational panel UI |
| `packages/app/src/components/workplane/WorkplaneShell.tsx` | Loads proof bundle; wires `proof_bundle` panel + selectedProof |

## Behavior

| State | When | UI |
| --- | --- | --- |
| `loading` | Fetch in flight for a valid task id | “Loading proof bundle…” |
| `ready` + items | Valid task with normalized proof | Kind counts + item rows with kind badges |
| `ready` + empty | Valid task, no usable proof | Explicit “No proof items” (never invents links) |
| `empty` | No task id, 404, or invalid payload | Explicit “No proof available” |
| `error` | Transport/server failure | Alert + Retry |

Selection uses URL-safe tokens via `toProofBundleSelectionToken` (slashes in href/id are not put into `?proof=`).

## Non-goals honored

- No files/docs panel (THE-865)
- No dedicated missing-proof warning panel (THE-866) — missing evidence is surfaced inline when present
- No layout lock / mobile smoke (THE-867 / THE-868)
- No invented Engineering import data / no DB schema / no prod mutation
