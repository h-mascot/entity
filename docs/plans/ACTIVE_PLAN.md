## Task
Resume the approved Entity Phase 2 child queue and work one dependency-safe child issue at a time, starting this segment with `THE-36`.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** BLOCKED

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

The approved queue is fixed (`THE-21` through `THE-95`) and cannot be reordered, expanded, or skipped without explicit approval. `THE-35` is complete enough to advance: machine gate `PASS`, Book review `APPROVED`, `safeToContinue=true`, and CLI Tester `verify THE-35` passed with no blockers.

The active issue is `THE-36`, source `THE-9.1`, parent `THE-9`, title `Add receipt artifact metadata and stable identity`. Live Linear confirms it is a child issue with no children, state `Todo`, and blocker text satisfied by completed Slice 0 inventory/gap matrix.

## Dependencies
- [x] Required repo rules and Phase 2 context/spec files are read.
- [x] `.project-gate.json` is read and requires proof commands plus Book review.
- [x] `THE-35` Book review receipt is `APPROVED` and `safeToContinue=true`.
- [x] `THE-35` CLI Tester receipt records `reviewGateStatus=PASS` and `nextChildBlocked=false`.
- [x] `project-test-gate verify THE-35` passed.
- [x] Mapping table identifies `THE-36` as source `THE-9.1`, parent `THE-9`.
- [x] Live Linear body confirms `THE-36` maps to `THE-9.1` and is a child issue.
- [x] Branch for `THE-36` exists before implementation.

## Plan
- [x] Step 1: Re-read repo rules, Phase 2 context/specs, package scripts, gate config, execution pack, mapping table, run-state, and current receipts.
  - **Files:** `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, `docs/specs/entity-phase-2-prd-canonical-20260620.md`, `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`, `package.json`, `.project-gate.json`, execution-pack plan, mapping table, run-state.
  - **Verify:** Required files read and current queue position identified.
- [x] Step 2: Verify `THE-35` continuation gate.
  - **Files:** `output/entity-phase-2/book-review/THE-35.json`, `output/entity-phase-2/test-gate/THE-35.json`.
  - **Verify:** Book review is approved, receipt records `nextChildBlocked=false`, and `project-test-gate verify THE-35` exits 0.
- [x] Step 3: Fetch and validate live `THE-36` and parent `THE-9`.
  - **Files:** Linear `THE-36`, Linear `THE-9`, mapping table, `.cursor/run-state/entity-phase-2.json`.
  - **Verify:** live body contains `THE-9.1`, issue is a child, no dependency violation or blocker.
- [x] Step 4: Inspect existing receipt/artifact schema, repositories, completion paths, and tests.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/**`, relevant tests and fixture outputs.
  - **Verify:** identify the smallest receipt metadata/stable identity slice for `THE-36`.
- [x] Step 5: Implement only `THE-36`.
  - **Files:** `packages/db/src/index.ts`.
  - **Verify:** receipt metadata persists stable artifact identity, origin task linkage, hash, explicit mutability, integrity state, availability, and human-friendly aliases without making aliases canonical.
- [x] Step 6: Add/update focused regression tests and fixture proof.
  - **Files:** `packages/server/src/__tests__/db-repositories.test.ts`.
  - **Verify:** schema/data tests cover stable id/path/hash metadata, origin task linkage, raw receipt mutability policy, and alias/path stability.
- [ ] Step 7: Run proof commands and CLI Tester gates for `THE-36`.
  - **Files:** `output/entity-phase-2/test-gate/THE-36.*`, `output/entity-phase-2/book-review/THE-36.*`.
  - **Verify:** smoke, root build, server build+Vitest, CLI Tester request/run passed; Book review is `REQUESTED` with `safeToContinue=false`, so verify has not run and `THE-37` is blocked.
- [ ] Step 8: Update local run-state and Linear proof comment for `THE-36`.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-36`.
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt, and blockers if any.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 09:48 | Step 1 | done | Required context/specs, run-state, gate config, and execution pack reviewed after user goal prompt. |
| 09:50 | Step 2 | done | `THE-35` Book review approved and `verify THE-35` passed with no blockers. |
| 09:51 | Step 3 | done | `THE-36` and parent `THE-9` fetched live; source mapping and dependency safety confirmed. |
| 09:52 | Step 4 | done | Existing receipt references are ActivityEvent/task metadata only; no dedicated EvidenceArtifact metadata model existed. |
| 09:54 | Step 5 | done | Added EvidenceArtifact metadata schema/repository with stable path, alias, hash, mutability, origin task, integrity, and availability fields. |
| 09:55 | Step 6 | done | Focused DB repository tests pass after rebuilding `@entity/db`: 36 tests passed. |
| 09:57 | Step 7 | blocked | Smoke, root build, server build+Vitest, CLI Tester request, and CLI Tester run passed. Book review returned `REQUESTED`/`safeToContinue=false`; verify was not run. |

## Files Touched
- `docs/plans/ACTIVE_PLAN.md` - modified - current resume plan for `THE-36`.
- `packages/db/src/index.ts` - modified - EvidenceArtifact metadata schema and repository helpers.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - receipt artifact metadata/stable identity tests.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Find the first unchecked step above.
5. Use Node v22.22.x for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Do not start any issue after `THE-36` until `THE-36` proof commands pass, CLI Tester `run` passes, Book review is `APPROVED` with `safeToContinue=true`, and CLI Tester `verify THE-36` passes with `nextChildBlocked=false`, or Henry explicitly waives the gate.

## Done
- [x] `THE-35` complete by current receipts and verify gate.
- [x] `THE-36` identified as next candidate from the approved queue.
- [x] `THE-36` live Linear validation complete.
- [x] `THE-36` implementation complete.
- [x] Focused tests and fixture receipts complete.
- [x] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass.
- [ ] Linear proof comment added.
- [ ] Next queue candidate identified only after verify allows continuation.
