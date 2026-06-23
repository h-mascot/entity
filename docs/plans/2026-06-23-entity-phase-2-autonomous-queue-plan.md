## Task
Resume the approved Entity Phase 2 child queue and work one dependency-safe child issue at a time, starting with `THE-30`.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** IN PROGRESS

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

The approved queue is fixed (`THE-21` through `THE-95`) and cannot be reordered, expanded, or skipped without explicit approval. Current run-state records `THE-29` as complete: proof commands passed, CLI Tester `request`, `run`, `book-review`, and `verify` passed, Book review is `APPROVED` with `safeToContinue=true`, `nextChildBlocked=false`, and Linear state is `Done`.

The next candidate is `THE-30`, source `THE-7.5`, parent `THE-7`, title `Backfill hierarchy and accountability fields safely`. Before editing, fetch the live Linear body for `THE-30` and parent `THE-7`, confirm it is a child issue, confirm no blockers, and create/switch to `THE-30-backfill-hierarchy-and-accountability-fields-safely`.

## Dependencies
- [x] Required repo rules and Phase 2 context files are read.
- [x] `.project-gate.json` is read and requires proof commands plus Book review.
- [x] Git status reviewed on `THE-29-build-workspace-navigation-and-accountability-ui`.
- [x] `THE-29` current Book review receipt is `APPROVED` and `safeToContinue=true`.
- [x] `THE-29` current machine gate receipt has `reviewGateStatus=PASS` and `nextChildBlocked=false`.
- [x] Mapping table identifies `THE-30` as source `THE-7.5`, parent `THE-7`.
- [x] Live Linear body confirms `THE-30` maps to `THE-7.5` and is dependency-safe.
- [x] Branch for `THE-30` exists before implementation.
- [ ] Required Book review approves `THE-30`.

## Plan
- [x] Step 1: Re-read repo rules, Phase 2 context, specs, package scripts, gate config, execution pack, mapping table, and run-state.
  - **Files:** `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, `docs/specs/entity-phase-2-prd-canonical-20260620.md`, `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`, `package.json`, `.project-gate.json`, execution-pack plan, mapping table, run-state.
  - **Verify:** Required files read and current queue position identified.
- [x] Step 2: Reconcile `THE-29` state against current receipts.
  - **Files:** `output/entity-phase-2/book-review/THE-29.json`, `output/entity-phase-2/test-gate/THE-29.json`, `.cursor/run-state/entity-phase-2.json`.
  - **Verify:** Book review is approved and machine receipt permits continuation.
- [x] Step 3: Fetch and validate live `THE-30` and parent `THE-7`.
  - **Files:** Linear `THE-30`, Linear `THE-7`, mapping table, `.cursor/run-state/entity-phase-2.json`.
  - **Verify:** live body contains `THE-7.5`, issue is a child, no dependency violation or blocker.
- [x] Step 4: Create/use the `THE-30` branch and implement only that issue.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/__tests__/db-repositories.test.ts`, `docs/context/entity-phase-2-the-30-backfill-notes.md`.
  - **Verify:** focused tests for safe backfill success and explicit uncertain/degraded path pass.
- [ ] Step 5: Run proof commands and CLI Tester gates for `THE-30`.
  - **Files:** `output/entity-phase-2/test-gate/THE-30.*`, `output/entity-phase-2/book-review/THE-30.*`.
  - **Verify:** proof commands and CLI Tester request/run pass; Book review is `REQUESTED` with `safeToContinue=false`, so verify is not run.
- [ ] Step 6: Update local run-state and Linear proof comment for `THE-30`.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-30`.
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt, and blockers if any.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 04:40 | Step 1 | done | Required context files, gate config, execution pack, mapping, and run-state reviewed. |
| 04:55 | Previous issue | done | `THE-29` is recorded complete with machine gate PASS, Book approval, verify PASS, Linear proof comment `0dca4972-cab8-427b-b597-fbf1f91a887e`, and Linear state Done. |
| 05:20 | Step 2 | done | Mapping table identifies `THE-30` as source `THE-7.5`, parent `THE-7`; live Linear validation is next. |
| 05:24 | Steps 3-5 | blocked | `THE-30` live Linear validation, branch creation, implementation, dry-run artifact, focused tests, proof commands, and CLI Tester request/run passed. Book review is `REQUESTED` with `safeToContinue=false`; verify and `THE-31` were not started. |

## Files Touched
- `docs/plans/ACTIVE_PLAN.md` - modified - current resume plan for the Phase 2 queue.
- `docs/plans/2026-06-23-entity-phase-2-autonomous-queue-plan.md` - modified - compaction-safe queue plan copy.
- `packages/db/src/index.ts` - modified - dry-run/apply hierarchy/accountability backfill helper with confidence/provenance and cleanup warnings.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - before/after fixture tests for inferred fields and unresolved cleanup warnings.
- `docs/context/entity-phase-2-the-30-backfill-notes.md` - created - non-destructive and rollback notes.
- `output/entity-phase-2/backfill/THE-30-dry-run-report.md` - created - ignored dry-run proof artifact.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Find the first unchecked step above.
5. Use Node v22.22.2 for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Do not start any issue after `THE-30` until `THE-30` proof commands pass, CLI Tester `run` passes, Book review is `APPROVED` with `safeToContinue=true`, and CLI Tester `verify THE-30` passes with `nextChildBlocked=false`, or Henry explicitly waives the gate.

## Done
- [x] `THE-29` complete by current run-state.
- [x] `THE-30` identified as next candidate from the approved queue.
- [x] `THE-30` live Linear validation complete.
- [x] `THE-30` implementation complete.
- [x] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass; currently blocked at Book review.
- [ ] Linear proof comment added.
- [ ] Next queue candidate identified only after verify allows continuation.
