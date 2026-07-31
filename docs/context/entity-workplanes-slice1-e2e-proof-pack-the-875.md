# THE-875 / WP1-C-07 — Workplanes slice 1 end-to-end proof pack

**Decision:** IMPLEMENTED (proof pack + durable scenario contract)  
**Date:** 2026-07-31  
**Worktree:** `/Users/enterprise/Code/entity-the-875-wp1-c-07`  
**Depends on:** THE-868 / WP1-B-07; THE-871 / WP1-C-03; THE-874 / WP1-C-06

## Purpose

Prove the integrated Slice-1 Workplane user surface end-to-end:

1. **with_proof** — task with a populated proof bundle
2. **without_proof** — missing-proof warning (no invented healthy state)
3. **raw_proof** — raw proof artifact kind + selectable URL token
4. **linked_doc** — linked native doc via Doc Hub opener
5. **refresh** — deep-link refresh restores task, panel, selected proof

## Modules

| Path | Role |
| --- | --- |
| `packages/app/src/lib/workplaneSlice1E2EProofPack.ts` | Durable scenario contract + fixture evaluation |
| `packages/app/src/lib/workplaneSlice1E2EProofPack.test.ts` | Focused contract + shell wiring tests |
| Runner receipts `.../receipts/proof/WP1-C-07/` | Browser/DOM/screenshot proof artifacts |

## Non-goals

- No new panel product features beyond pack durability
- No Doc Hub rebuild / Provider Registry / secrets / OAuth
- No production promotion; isolated worktree only
