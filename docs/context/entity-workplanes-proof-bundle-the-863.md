# THE-863 / WP1-B-02 — ProofBundle normalization

**Decision:** IMPLEMENTED  
**Date:** 2026-07-31  
**Worktree:** `/Users/enterprise/Code/entity-the-863-wp1-b-02`  
**Depends on:** THE-856 / WP1-A-01 (TaskDetailPanel seams); prior shell through THE-862

## Purpose

Define a typed ProofBundle normalization contract from existing task output / evidence / receipt / document-object fields so THE-864 can render a proof bundle panel without scraping ad hoc strings.

## Module

| Path | Role |
| --- | --- |
| `packages/app/src/lib/proofBundle.ts` | `normalizeProofBundle`, `classifyProofBundleItemKind`, types |
| `packages/app/src/lib/proofBundle.test.ts` | raw / curated / external / unknown / empty / duplicate / malformed |

## Contract

`normalizeProofBundle(raw)` always returns a `ProofBundle` value (never null):

- `items[]` with `kind: raw | curated | external | unknown`
- Preserves `href` / `path` / `title` / `label` / `status` / `artifactKind` when present
- Empty/missing inputs → `{ empty: true, items: [] }`
- Duplicates keyed by href (else id/title); first wins
- Malformed entries (no id/label/href) dropped

Classification uses existing TaskDetailPanel rules: receipt/raw artifact kinds → `raw`; native/curated → `curated`; http(s) / external refs → `external`; else `unknown`.

## Non-goals honored

- Visual proof bundle panel lands in THE-864 (`ProofBundlePanel` + `workplaneProofBundle.ts`)
- No files/docs / missing-proof panels (THE-865 / THE-866)
- No layout lock / mobile smoke (THE-867 / THE-868)
- No DB schema / prod mutation / invented Engineering data
