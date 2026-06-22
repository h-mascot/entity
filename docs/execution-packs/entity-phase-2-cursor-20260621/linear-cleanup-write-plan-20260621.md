# Entity Phase 2 Linear Cleanup Write Plan — 2026-06-21 (DRAFT, DRY-RUN ONLY)

**Status:** generated as a write proposal. **No Linear writes performed in this run.**

- Source mapping: `docs/specs/entity-phase-2-linear_id_to_source_id.json`
- Drafts directory: `docs/execution-packs/entity-phase-2-cursor-20260621/cleanup-drafts/` (per-issue `<ISSUE>.current.md`, `<ISSUE>.proposed.md`, `<ISSUE>.diff`)

## Why this plan exists

The current preflight blocks Cursor because Linear issue bodies do not contain the child source key (e.g. `THE-6.1`). Titles, parent links, and URL slugs already carry the source identity; bodies need an explicit anchor so Cursor does not infer it. This plan adds an explicit `## Source ID` anchor block to each of the 75 children and preserves all existing acceptance/proof/copy below it.

## Change set

- Title: **unchanged** (already canonical post-patch).
- Body: **prepend anchor block** under the existing `## Parent` section.
- Anchor block always contains:
  - `## Source ID` heading with `THE-X.Y` source id
  - `Parent slice: THE-N` line
  - `Parent section heading: <heading>` when present in parent description, else omitted
  - `## Mapping basis (validated 2026-06-21)` block with linear_id/linear_uuid/parent linkage
- Nothing else in the body is altered. Acceptance criteria, proof commands, blocked-by, and source-coverage sections stay byte-for-byte.

## Write order (when approval lands)

1. Lowest parent first: THE-6, then THE-7, ..., then THE-20. Five children per parent, in source-id order (`.1` → `.5`).
2. For each child: fetch live, verify the proposed anchor block matches the latest mapping, then call `issueUpdate` once.
3. After each write, re-fetch and re-run the body-source-key alignment check.
4. After every parent group, run the project test gate to confirm nothing about local state regressed.
5. After all 75 writes, re-run the validator + full preflight.

## Post-write verification

- Per issue: live body now contains `Source ID` heading + source id string + parent slice id.
- Per issue: `mapping_basis.body_contains_source_id` = true.
- Per issue: `mapping_basis.body_heading_match` = true (Source ID heading is the explicit match).
- Pack-level: preflight `body_source_key_alignment_not_all_confirmed` blocker clears.
- Validator: still PASS.
- Proof command: still PASS (body content changes do not affect smoke gate).

## What this plan deliberately does NOT do

- Does NOT rewrite acceptance criteria or proof commands.
- Does NOT rename titles.
- Does NOT change parent epics.
- Does NOT add new comments, labels, or assignees.
- Does NOT change state.
- Does NOT register cron or scheduler.
- Does NOT touch public dispatch surfaces.

## Rollback strategy

Each `<ISSUE>.current.md` artifact in `cleanup-drafts/` is the literal current body. To roll back, re-set `issueUpdate.description` to the captured current body. The dry-run sets are retained until Henry confirms the final state.

## Approval gating

Before any Linear write:

- Henry explicitly approves this plan in-thread.
- No other agent runs the writes without the same approval.
- All 75 mutations happen in one approved session with a clean run-state file at `docs/execution-packs/entity-phase-2-cursor-20260621/cleanup-drafts/cleanup-write-run-state.json`.

## Dry-run coverage summary

- Children drafted: 75
- Parents involved: 15
- Titles changed in any draft: 0
- Average current body length: 1771 chars
- Average proposed body length: 2255 chars

Per-issue full proposed bodies are under `cleanup-drafts/<THE-XX>.proposed.md`. The plan JSON mirrors this summary.
