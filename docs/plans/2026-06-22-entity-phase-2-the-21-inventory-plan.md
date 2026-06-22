# Entity Phase 2 THE-21 Inventory Plan

## Task
Execute `THE-21` (`THE-6.1`) by producing a read-only inventory of the current schema/data model and mapping it against Phase 2 required fields.

**MC Task:** THE-21  
**Created:** 2026-06-22  
**Agent:** Cursor  
**Status:** IN PROGRESS

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution pack plan.

`THE-21` is a child of `THE-6` with no blockers. Scope is documentation/inventory only: no source schema changes and no production mutation.

## Dependencies
- [x] Live Linear body confirms `THE-21` maps to `THE-6.1`.
- [x] Parent epic confirms Slice 0 inventory is unblocked.
- [x] Repo inventory identifies current schema/data model files.
- [x] Inventory document exists under `docs/context/`.
- [ ] Required proof commands and CLI Tester gates pass or block with receipts.

## Plan
- [x] Step 1: Confirm issue mapping, parent, and dependency safety.
  - **Files:** Linear `THE-21`, `THE-6`
  - **Verify:** `linear_api.py get-issue THE-21` and `linear_api.py get-issue THE-6`
- [x] Step 2: Inventory current schema/data model surfaces.
  - **Files:** `packages/db/src/**`, `packages/server/src/**`, relevant setup/migration scripts
  - **Verify:** targeted code reads/searches only, no source edits
- [x] Step 3: Write current-state inventory and Phase 2 field mapping.
  - **Files:** `docs/context/entity-phase-2-current-schema-inventory.md`
  - **Verify:** document covers tables/entities, metadata blobs, field mapping, migration risks
- [ ] Step 4: Run proof and gate commands.
  - **Files:** proof receipts under `output/entity-phase-2/`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, `cd packages/server && npm run build && npx vitest run`, and CLI Tester request/run/book-review/verify
- [ ] Step 5: Update Linear proof comment and local run state.
  - **Files:** `.cursor/run-state/entity-phase-2.json`
  - **Verify:** Linear comment URL or blocker recorded

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 05:10 | Step 1 | done | Linear child and parent fetched with local helper; no OAuth used. |
| 05:31 | Step 2 | done | Read DB bootstrap, task route, review-policy, task-board metadata, file/document/token schemas. |
| 05:36 | Step 3 | done | Created `docs/context/entity-phase-2-current-schema-inventory.md`; no source schema changes. |
| 05:46 | Step 4 | blocked | Repo proofs pass under Node 22 with external-provider keys unset for test isolation; CLI `run` and `verify` pass, but Book receipt is packet-only `REQUESTED`/`safeToContinue=false`. |
| 05:50 | Step 5 | blocked | Linear blocker/proof comment posted: `289c76f4-752d-4a8a-ada0-d1e7b7010579`. |

## Files Touched
- `docs/plans/2026-06-22-entity-phase-2-the-21-inventory-plan.md` - created - compaction-safe plan for current issue.
- `docs/plans/ACTIVE_PLAN.md` - modified - points to current execution plan.
- `.cursor/run-state/entity-phase-2.json` - created/modified - local-only runtime state.
- `docs/context/entity-phase-2-current-schema-inventory.md` - created - THE-21 inventory output.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Continue from the first unchecked step above.
5. Do not redo completed Linear or proof steps.

## Done
- [ ] All steps complete.
- [x] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass.
- [x] Linear proof/blocker comment added.
- [ ] `THE-22` identified as next candidate only after verify allows continuation.

## Blocker

`project-test-gate book-review THE-21` produced `output/project/book-review/THE-21.json` with `decision: REQUESTED`, `status: BLOCKED`, and `safeToContinue: false` because the local Book review mode is packet-only. Do not start `THE-22` until a real Book approval receipt exists or Henry explicitly waives it.
