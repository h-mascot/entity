# Entity Phase 2 THE-25 Gap Matrix Plan

## Task
Execute `THE-25` (`THE-6.5`) by consolidating Slice 0 inventories into a current-state gap matrix and dependency map for downstream Phase 2 implementation tickets.

**MC Task:** THE-25  
**Created:** 2026-06-23  
**Agent:** Cursor  
**Status:** IN PROGRESS

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

`THE-25` is a child of `THE-6` with no explicit blockers. It is dependency-safe because prior Slice 0 inventory artifacts exist for schema/data model, activity/provenance, review/proof/receipt-like outputs, and integration boundaries, and `THE-24` has approved Book and verify receipts.

Scope is documentation/inventory only: no source schema changes, no production mutation, no connector mutation, no implementation-complete claims, and no credential values copied into docs.

## Dependencies
- [x] Live Linear body confirms `THE-25` maps to `THE-6.5`.
- [x] Parent epic `THE-6` confirms Slice 0 inventory is unblocked.
- [x] `THE-24` gate and Book review receipts report `PASS`, `APPROVED`, `safeToContinue=true`, and `nextChildBlocked=false`.
- [x] Branch `THE-25-publish-phase-2-gap-matrix-and-dependency-map` exists.
- [x] Prior Slice 0 inventory artifacts are reread and summarized.
- [x] Gap matrix document exists under `docs/context/`.
- [x] Required proof commands and CLI Tester gates pass or block with receipts.

## Plan
- [x] Step 1: Confirm issue mapping, parent, and dependency safety.
  - **Files:** Linear `THE-25`, `THE-6`, `.cursor/run-state/entity-phase-2.json`, `output/entity-phase-2/test-gate/THE-24.json`, `output/entity-phase-2/book-review/THE-24.json`
  - **Verify:** `linear_api.py get-issue THE-25` and `linear_api.py get-issue THE-6`
- [x] Step 2: Reread prior Slice 0 inventories and extract confirmed gaps.
  - **Files:** `docs/context/entity-phase-2-current-schema-inventory.md`, `docs/context/entity-phase-2-activity-provenance-inventory.md`, `docs/context/entity-phase-2-review-proof-inventory.md`, `docs/context/entity-phase-2-integration-boundary-inventory.md`
  - **Verify:** targeted document reads, no source edits
- [x] Step 3: Write the consolidated current-state gap matrix and dependency map.
  - **Files:** `docs/context/entity-phase-2-current-state-gap-matrix.md`
  - **Verify:** document covers schema, ActivityEvent, review/proof, integrations, permissions/search, notifications, migration, implementation order, and open decisions without implementation-complete claims
- [x] Step 4: Update local run state for `THE-25`.
  - **Files:** `.cursor/run-state/entity-phase-2.json`
  - **Verify:** `git status --short --branch`
- [x] Step 5: Run proof and gate commands.
  - **Files:** proof receipts under `output/entity-phase-2/`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, `cd packages/server && npm run build && npx vitest run`, and CLI Tester request/run/book-review/verify
- [ ] Step 6: Commit scoped docs work and post Linear proof comment.
  - **Files:** changed docs and local state (state remains uncommitted)
  - **Verify:** `git status --short --branch`, `git log -1 --oneline`, Linear comment response

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 01:59 | Step 1 | done | Linear child and parent fetched; branch created; `THE-24` receipts allow continuation. |
| 02:13 | Steps 2-3 | done | Prior Slice 0 inventories consolidated into `docs/context/entity-phase-2-current-state-gap-matrix.md`; build context now points downstream tickets at it. |
| 02:16 | Step 4 | done | `.cursor/run-state/entity-phase-2.json` validates and now points at `THE-25`. |
| 02:59 | Step 5 | blocked | Repo proof and CLI Tester machine gate pass under Node v22.22.2; Book review is `REQUESTED`/`safeToContinue=false`, so verify exits 1 and `THE-26` remains blocked. |

## Files Touched
- `docs/plans/2026-06-23-entity-phase-2-the-25-gap-matrix-plan.md` - created - compaction-safe plan for current issue.
- `docs/plans/ACTIVE_PLAN.md` - modified - active execution plan for current issue.
- `docs/context/entity-phase-2-current-state-gap-matrix.md` - created - consolidated current-state gap matrix and dependency map.
- `docs/context/entity-phase-2-build-context.md` - modified - points downstream tickets at the Slice 0 gap matrix.
- `.cursor/run-state/entity-phase-2.json` - modified - ignored local run state for current issue progress.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Continue from the first unchecked step above.
5. Do not start `THE-26` until `THE-25` proof commands, CLI Tester `run`, `book-review`, and `verify` pass with `safeToContinue=true` and `nextChildBlocked=false`, or Henry explicitly waives the gate.

## Done
- [x] All local implementation/proof steps complete.
- [x] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass.
- [ ] Linear proof comment added.
- [ ] `THE-26` identified as next candidate only after verify allows continuation.
