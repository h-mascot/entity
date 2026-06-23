## Task
Resume the approved Entity Phase 2 child queue and work one dependency-safe child issue at a time, starting with `THE-32`.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** IN PROGRESS

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

The approved queue is fixed (`THE-21` through `THE-95`) and cannot be reordered, expanded, or skipped without explicit approval. `THE-31` is complete by current Linear state, Book review approval, and fresh CLI Tester verify.

The active issue is `THE-32`, source `THE-8.2`, parent `THE-8`, title `Implement append/query ActivityEvent service`. Live Linear confirms it is a child issue with no children, state `Todo`, and blocker text satisfied by completed Slice 0 plus `THE-31`.

## Dependencies
- [x] Required repo rules and Phase 2 context files are read.
- [x] `.project-gate.json` is read and requires proof commands plus Book review.
- [x] `THE-31` Book review receipt is `APPROVED` and `safeToContinue=true`.
- [x] `THE-31` fresh CLI Tester verify passed with blockers empty.
- [x] Mapping table identifies `THE-32` as source `THE-8.2`, parent `THE-8`.
- [x] Live Linear body confirms `THE-32` maps to `THE-8.2` and is dependency-safe.
- [x] Branch for `THE-32` exists before implementation.

## Plan
- [x] Step 1: Re-read repo rules, Phase 2 context, specs, package scripts, gate config, execution pack, mapping table, run-state, and current receipts.
  - **Files:** `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, `docs/specs/entity-phase-2-prd-canonical-20260620.md`, `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`, `package.json`, `.project-gate.json`, execution-pack plan, mapping table, run-state.
  - **Verify:** Required files read and current queue position identified.
- [x] Step 2: Reconcile `THE-31` state against current receipts and live Linear.
  - **Files:** `output/entity-phase-2/book-review/THE-31.json`, `output/entity-phase-2/test-gate/THE-31.json`, `.cursor/run-state/entity-phase-2.json`, Linear `THE-31`.
  - **Verify:** Book review is approved, verify records PASS, and Linear state is Done.
- [x] Step 3: Fetch and validate live `THE-32` and parent `THE-8`.
  - **Files:** Linear `THE-32`, Linear `THE-8`, mapping table, `.cursor/run-state/entity-phase-2.json`.
  - **Verify:** live body contains `THE-8.2`, issue is a child, no dependency violation or blocker.
- [x] Step 4: Implement only `THE-32`.
  - **Files:** `packages/server/src/activity-events.ts`, `packages/server/src/activity-events.test.ts`, `packages/server/src/index.ts`.
  - **Verify:** focused service/API tests cover append, query envelope, permission denial, malformed/unknown payload behavior, and mutation event classification.
- [x] Step 5: Run proof commands and CLI Tester gates for `THE-32`.
  - **Files:** `output/entity-phase-2/test-gate/THE-32.*`, `output/entity-phase-2/book-review/THE-32.*`.
  - **Verify:** proof commands and CLI Tester request/run pass; Book review is `REQUESTED` with `safeToContinue=false`; verify is blocked on Book review, so `THE-33` must not start.
- [x] Step 6: Update local run-state and Linear proof comment for `THE-32`.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-32`.
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt, and blockers if any.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 06:34 | Step 1 | done | Required context and receipts reviewed; `THE-31` stale blocker reconciled. |
| 06:35 | Step 2 | done | Fresh `THE-31` verify passed under Node 22 with clean-tree baseline. |
| 06:36 | Step 3 | done | `THE-32` and parent `THE-8` fetched live; source mapping and dependency safety confirmed. |
| 06:41 | Steps 4-5 | blocked | `THE-32` implementation complete; focused tests, server suite, root build, smoke, and machine gate pass. Book review remains `REQUESTED` with `safeToContinue=false`; `THE-33` not started. |
| 06:43 | Step 6 | done | Linear proof/blocker comment posted: `6bbea95f-3c91-4234-b89e-e1a8c73bc4eb`. |

## Files Touched
- `docs/plans/ACTIVE_PLAN.md` - modified - current resume plan for `THE-32`.
- `.cursor/run-state/entity-phase-2.json` - modified local-only run state.
- `packages/server/src/activity-events.ts` - added - ActivityEvent append/query service and API router.
- `packages/server/src/activity-events.test.ts` - added - service/API tests for structured append/query, permission denial, degraded payloads, and mutation classification.
- `packages/server/src/index.ts` - modified - route mounting and explicit ActivityEvent payloads for task mutations.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Find the first unchecked step above.
5. Use Node v22.22.2/22.22.3 for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Do not start any issue after `THE-32` until `THE-32` proof commands pass, CLI Tester `run` passes, Book review is `APPROVED` with `safeToContinue=true`, and CLI Tester `verify THE-32` passes with `nextChildBlocked=false`, or Henry explicitly waives the gate.

## Done
- [x] `THE-31` complete by current receipts and Linear state.
- [x] `THE-32` identified as next candidate from the approved queue.
- [x] `THE-32` live Linear validation complete.
- [x] `THE-32` implementation complete.
- [x] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass; currently blocked at Book review.
- [x] Linear proof comment added.
- [ ] Next queue candidate identified only after verify allows continuation.
