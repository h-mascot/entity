## Task
Resume the approved Entity Phase 2 child queue and work one dependency-safe child issue at a time, starting with `THE-33`.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** IN PROGRESS

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

The approved queue is fixed (`THE-21` through `THE-95`) and cannot be reordered, expanded, or skipped without explicit approval. `THE-32` is complete by live parent child state, Book review approval, and CLI Tester receipt with `nextChildBlocked=false`.

The active issue is `THE-33`, source `THE-8.3`, parent `THE-8`, title `Migrate existing activity payloads progressively`. Live Linear confirms it is a child issue with no children, state `Todo`, and blocker text satisfied by completed Slice 0 plus completed `THE-31` and `THE-32`.

## Dependencies
- [x] Required repo rules and Phase 2 context files are read.
- [x] `.project-gate.json` is read and requires proof commands plus Book review.
- [x] `THE-32` Book review receipt is `APPROVED` and `safeToContinue=true`.
- [x] `THE-32` CLI Tester receipt records `nextChildBlocked=false`.
- [x] Mapping table identifies `THE-33` as source `THE-8.3`, parent `THE-8`.
- [x] Live Linear body confirms `THE-33` maps to `THE-8.3` and is dependency-safe.
- [x] Branch for `THE-33` exists before implementation.

## Plan
- [x] Step 1: Re-read repo rules, Phase 2 context, specs, package scripts, gate config, execution pack, mapping table, run-state, and current receipts.
  - **Files:** `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, `docs/specs/entity-phase-2-prd-canonical-20260620.md`, `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`, `package.json`, `.project-gate.json`, execution-pack plan, mapping table, run-state.
  - **Verify:** Required files read and current queue position identified.
- [x] Step 2: Reconcile `THE-32` state against current receipts and live Linear.
  - **Files:** `output/entity-phase-2/book-review/THE-32.json`, `output/entity-phase-2/test-gate/THE-32.json`, `.cursor/run-state/entity-phase-2.json`, Linear `THE-8`.
  - **Verify:** Book review is approved, receipt records `nextChildBlocked=false`, and live parent shows `THE-32` Done.
- [x] Step 3: Fetch and validate live `THE-33` and parent `THE-8`.
  - **Files:** Linear `THE-33`, Linear `THE-8`, mapping table, `.cursor/run-state/entity-phase-2.json`.
  - **Verify:** live body contains `THE-8.3`, issue is a child, no dependency violation or blocker.
- [x] Step 4: Implement only `THE-33`.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/__tests__/db-repositories.test.ts`, `output/entity-phase-2/backfill/THE-33-dry-run-report.md`.
  - **Verify:** legacy event fixture tests cover known mapping, weak-event warnings, old-task visibility, idempotency, and rollback/dry-run behavior.
- [ ] Step 5: Run proof commands and CLI Tester gates for `THE-33`.
  - **Files:** `output/entity-phase-2/test-gate/THE-33.*`, `output/entity-phase-2/book-review/THE-33.*`.
  - **Verify:** smoke, root build, server build+Vitest passed; CLI Tester request/run passed; Book review is `REQUESTED` with `safeToContinue=false`; verify was not run.
- [ ] Step 6: Update local run-state and Linear proof comment for `THE-33`.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-33`.
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt, and blockers if any.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 07:20 | Step 1 | done | Required context, run-state, and `THE-32` receipts reviewed. |
| 07:22 | Step 2 | done | `THE-32` Book review is approved and receipt shows `nextChildBlocked=false`; live parent shows `THE-32` Done. |
| 07:23 | Step 3 | done | `THE-33` and parent `THE-8` fetched live; source mapping and dependency safety confirmed. |
| 07:24 | Step 4 | in progress | Branch `THE-33-migrate-existing-activity-payloads-progressively` created; code search next. |
| 07:32 | Step 4 | done | Added progressive ActivityEvent backfill report/apply helper and fixture tests for mapped and weak legacy events. |
| 07:34 | Step 5 | in progress | Focused DB tests, server build+Vitest, root build, and smoke passed under Node 22; CLI Tester next. |
| 07:52 | Step 5 | blocked | CLI Tester request/run passed; Book review returned `REQUESTED` with `safeToContinue=false`; verify not run and `THE-34` not started. Linear proof/blocker comment posted: `afa9f47a-fae8-40ce-ad65-c560d3ff3afe`. |

## Files Touched
- `docs/plans/ACTIVE_PLAN.md` - modified - current resume plan for `THE-33`.
- `docs/plans/2026-06-23-entity-phase-2-autonomous-queue-plan.md` - modified - compaction-safe queue plan copy.
- `packages/db/src/index.ts` - modified - ActivityEvent progressive dry-run/apply backfill report with confidence, provenance, warnings, metadata audit, and idempotency.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - legacy ActivityEvent backfill fixture tests for mapped and weak events.
- `output/entity-phase-2/backfill/THE-33-dry-run-report.md` - generated local proof artifact.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Find the first unchecked step above.
5. Use Node v22.22.2/22.22.3 for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Do not start any issue after `THE-33` until `THE-33` proof commands pass, CLI Tester `run` passes, Book review is `APPROVED` with `safeToContinue=true`, and CLI Tester `verify THE-33` passes with `nextChildBlocked=false`, or Henry explicitly waives the gate.

## Done
- [x] `THE-32` complete by current receipts and live parent state.
- [x] `THE-33` identified as next candidate from the approved queue.
- [x] `THE-33` live Linear validation complete.
- [x] `THE-33` implementation complete.
- [x] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass; currently blocked at Book review.
- [x] Linear proof comment added.
- [ ] Next queue candidate identified only after verify allows continuation.
