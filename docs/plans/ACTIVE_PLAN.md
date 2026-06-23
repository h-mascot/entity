## Task
Resume the approved Entity Phase 2 child queue and work one dependency-safe child issue at a time, starting with `THE-31`.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** IN PROGRESS

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

The approved queue is fixed (`THE-21` through `THE-95`) and cannot be reordered, expanded, or skipped without explicit approval. `THE-30` is confirmed Done in Linear with Book review `APPROVED`, `safeToContinue=true`, verify override `nextChildBlocked=false`, and proof comment posted.

The next candidate is `THE-31`, source `THE-8.1`, parent `THE-8`, title `Define ActivityEvent schema, enum, and payload versioning`. Live Linear confirms it is a child issue with no children, state `Todo`, and blocker text satisfied by completed Slice 0 and Slice 2 foundation through `THE-30`.

## Dependencies
- [x] Required repo rules and Phase 2 context files are read.
- [x] `.project-gate.json` is read and requires proof commands plus Book review.
- [x] Git status reviewed on `THE-30-backfill-hierarchy-and-accountability-fields-safely`.
- [x] `THE-30` Book review receipt is `APPROVED` and `safeToContinue=true`.
- [x] `THE-30` Linear state is `Done` with approval/verify override comment.
- [x] Mapping table identifies `THE-31` as source `THE-8.1`, parent `THE-8`.
- [x] Live Linear body confirms `THE-31` maps to `THE-8.1` and is dependency-safe.
- [x] Branch for `THE-31` exists before implementation.

## Plan
- [x] Step 1: Re-read repo rules, Phase 2 context, specs, package scripts, gate config, execution pack, mapping table, and run-state.
  - **Files:** `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, `docs/specs/entity-phase-2-prd-canonical-20260620.md`, `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`, `package.json`, `.project-gate.json`, execution-pack plan, mapping table, run-state.
  - **Verify:** Required files read and current queue position identified.
- [x] Step 2: Reconcile `THE-30` state against current receipts and live Linear.
  - **Files:** `output/entity-phase-2/book-review/THE-30.json`, `output/entity-phase-2/test-gate/THE-30.json`, `.cursor/run-state/entity-phase-2.json`, Linear `THE-30`.
  - **Verify:** Book review is approved, verify override records `nextChildBlocked=false`, and Linear state is Done.
- [x] Step 3: Fetch and validate live `THE-31` and parent `THE-8`.
  - **Files:** Linear `THE-31`, Linear `THE-8`, mapping table, `.cursor/run-state/entity-phase-2.json`.
  - **Verify:** live body contains `THE-8.1`, issue is a child, no dependency violation or blocker.
- [x] Step 4: Create/use the `THE-31` branch and implement only that issue.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/__tests__/db-repositories.test.ts`, `packages/server/src/agent/tools.test.ts`.
  - **Verify:** focused schema/type tests cover required event enum, payload versioning, and unknown legacy events.
- [ ] Step 5: Run proof commands and CLI Tester gates for `THE-31`.
  - **Files:** `output/entity-phase-2/test-gate/THE-31.*`, `output/entity-phase-2/book-review/THE-31.*`.
  - **Verify:** proof commands and CLI Tester request/run pass; Book review is `REQUESTED` with `safeToContinue=false`, so `THE-32` is blocked.
- [x] Step 6: Update local run-state and Linear proof comment for `THE-31`.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-31`.
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt, and blockers if any.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 05:55 | Step 1 | done | Required context files, gate config, execution pack, mapping, and run-state reviewed. |
| 06:00 | Step 2 | done | `THE-30` confirmed Done in Linear; Book approval and verify override allow queue advance. |
| 06:02 | Step 3 | done | `THE-31` and parent `THE-8` fetched live; source mapping and dependency safety confirmed. |
| 06:04 | Steps 4-6 | blocked | `THE-31` implementation, proof commands, CLI Tester request/run, verify receipt, GitNexus, and Linear comment completed. Book review remains `REQUESTED` with `safeToContinue=false`; `THE-32` not started. |

## Files Touched
- `docs/plans/ACTIVE_PLAN.md` - modified - current resume plan for `THE-31`.
- `docs/plans/2026-06-23-entity-phase-2-autonomous-queue-plan.md` - modified - compaction-safe queue plan copy.
- `packages/db/src/index.ts` - modified - ActivityEvent enum, typed payload projection, additive activity table columns, and legacy event mapping.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - focused ActivityEvent enum/payload/legacy tests.
- `packages/server/src/agent/tools.test.ts` - modified - ActivityRecord fixture updated for ActivityEvent fields.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Find the first unchecked step above.
5. Use Node v22.22.2 for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Do not start any issue after `THE-31` until `THE-31` proof commands pass, CLI Tester `run` passes, Book review is `APPROVED` with `safeToContinue=true`, and CLI Tester `verify THE-31` passes with `nextChildBlocked=false`, or Henry explicitly waives the gate.

## Done
- [x] `THE-30` complete by current receipts and Linear state.
- [x] `THE-31` identified as next candidate from the approved queue.
- [x] `THE-31` live Linear validation complete.
- [x] `THE-31` implementation complete.
- [x] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass; currently blocked at Book review.
- [x] Linear proof comment added.
- [ ] Next queue candidate identified only after verify allows continuation.
