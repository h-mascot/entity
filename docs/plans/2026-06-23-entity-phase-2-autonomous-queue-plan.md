## Task
Resume the approved Entity Phase 2 child queue and work one dependency-safe child issue at a time, starting this segment with `THE-35`.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** BLOCKED

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

The approved queue is fixed (`THE-21` through `THE-95`) and cannot be reordered, expanded, or skipped without explicit approval. `THE-34` is complete by live parent child state, Book review approval, CLI Tester receipt with `reviewGateStatus=PASS`, and `nextChildBlocked=false`.

The active issue is `THE-35`, source `THE-8.5`, parent `THE-8`, title `Wire ActivityEvent consumers for receipts, review, routing, and notifications`. Live Linear confirms it is a child issue with no children, state `Todo`, and blocker text satisfied by completed Slice 0 plus completed `THE-31`, `THE-32`, `THE-33`, and `THE-34`.

## Dependencies
- [x] Required repo rules and Phase 2 context/spec files are read.
- [x] `.project-gate.json` is read and requires proof commands plus Book review.
- [x] `THE-34` Book review receipt is `APPROVED` and `safeToContinue=true`.
- [x] `THE-34` CLI Tester receipt records `reviewGateStatus=PASS` and `nextChildBlocked=false`.
- [x] Mapping table identifies `THE-35` as source `THE-8.5`, parent `THE-8`.
- [x] Live Linear body confirms `THE-35` maps to `THE-8.5` and is dependency-safe.
- [x] Branch for `THE-35` exists before implementation.

## Plan
- [x] Step 1: Re-read repo rules, Phase 2 context/specs, package scripts, gate config, execution pack, mapping table, run-state, and current receipts.
  - **Files:** `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, `docs/specs/entity-phase-2-prd-canonical-20260620.md`, `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`, `package.json`, `.project-gate.json`, execution-pack plan, mapping table, run-state.
  - **Verify:** Required files read and current queue position identified.
- [x] Step 2: Reconcile `THE-34` state against current receipts and live Linear.
  - **Files:** `output/entity-phase-2/book-review/THE-34.json`, `output/entity-phase-2/test-gate/THE-34.json`, `.cursor/run-state/entity-phase-2.json`, Linear `THE-8`.
  - **Verify:** Book review is approved, receipt records `nextChildBlocked=false`, and live parent shows `THE-34` Done.
- [x] Step 3: Fetch and validate live `THE-35` and parent `THE-8`.
  - **Files:** Linear `THE-35`, Linear `THE-8`, mapping table, `.cursor/run-state/entity-phase-2.json`.
  - **Verify:** live body contains `THE-8.5`, issue is a child, no dependency violation or blocker.
- [x] Step 4: Inspect existing ActivityEvent consumers and current ad hoc reconstruction seams.
  - **Files:** `packages/server/src/activity-events.ts`, `packages/server/src/index.ts`, `packages/server/src/agent/*`, `packages/db/src/index.ts`, relevant tests.
  - **Verify:** identify receipt/review/routing/notification paths that should append/read canonical ActivityEvents for this issue.
- [x] Step 5: Implement only `THE-35`.
  - **Files:** `packages/server/src/activity-events.ts`, `packages/server/src/agent/index.ts`.
  - **Verify:** receipt, review/routing, and notification consumers use canonical ActivityEvent APIs or explicit deferred-gap notes where the issue scope cannot safely complete all consumers.
- [x] Step 6: Add/update focused regression tests and fixture receipt/proof artifacts.
  - **Files:** `packages/server/src/activity-events.test.ts`, `packages/server/src/agent/index.test.ts`.
  - **Verify:** focused tests cover required ActivityEvent consumer behavior and degraded/deferred cases.
- [ ] Step 7: Run proof commands and CLI Tester gates for `THE-35`.
  - **Files:** `output/entity-phase-2/test-gate/THE-35.*`, `output/entity-phase-2/book-review/THE-35.*`.
  - **Verify:** smoke, root build, server build+Vitest, and CLI Tester request/run passed on commit `2c97a603d6f1f590d9632229a18700a9b37e1167`; Book review is `REQUESTED` with `safeToContinue=false`, so verify has not run and `THE-36` is blocked.
- [x] Step 8: Update local run-state and Linear proof comment for `THE-35`.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-35`.
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt, and blockers if any.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 09:08 | Step 1 | done | Required context/specs, run-state, gate config, and execution pack reviewed after user goal prompt. |
| 09:15 | Step 2 | done | `THE-34` Book review approved and test-gate receipt shows `reviewGateStatus=PASS`, `nextChildBlocked=false`; live parent shows `THE-34` Done. |
| 09:16 | Step 3 | done | `THE-35` and parent `THE-8` fetched live; source mapping and dependency safety confirmed. |
| 09:17 | Step 4 | done | Existing ActivityEvent service, TaskAgent action path, task mutation logging, and receipt/review/routing/notification gaps inspected. |
| 09:23 | Step 5 | done | Added receipt consumer summary, consumer append mapper, TaskAgent action mapper, object-ref preservation, and TaskAgent canonical event writes. |
| 09:25 | Step 6 | done | Focused `activity-events` and TaskAgent tests pass; server build passes under Node 22. |
| 09:17Z | Step 7 | blocked | Required proof commands and CLI Tester run passed on commit `2c97a603d6f1f590d9632229a18700a9b37e1167`; Book review receipt is `REQUESTED`/`safeToContinue=false`, so verify was not run. |
| 09:18Z | Step 8 | done | Linear comment `91ae94aa-7b02-45c8-bcf3-846e9d8b5ba9` posted with proof paths and blocker. |

## Files Touched
- `docs/plans/ACTIVE_PLAN.md` - modified - current resume plan for `THE-35`.
- `docs/plans/2026-06-23-entity-phase-2-autonomous-queue-plan.md` - modified - compaction-safe queue plan copy.
- `packages/server/src/activity-events.ts` - modified - ActivityEvent consumer summary/mapping helpers and object-ref preservation.
- `packages/server/src/activity-events.test.ts` - modified - consumer summary, object-ref, and mapper regression tests.
- `packages/server/src/agent/index.ts` - modified - TaskAgent writes canonical ActivityEvents alongside legacy logs.
- `packages/server/src/agent/index.test.ts` - created - TaskAgent canonical ActivityEvent regression test.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Find the first unchecked step above.
5. Use Node v22.22.x for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Do not start any issue after `THE-35` until `THE-35` proof commands pass, CLI Tester `run` passes, Book review is `APPROVED` with `safeToContinue=true`, and CLI Tester `verify THE-35` passes with `nextChildBlocked=false`, or Henry explicitly waives the gate.

## Done
- [x] `THE-34` complete by current receipts and live parent state.
- [x] `THE-35` identified as next candidate from the approved queue.
- [x] `THE-35` live Linear validation complete.
- [x] `THE-35` implementation complete.
- [x] Focused tests and fixture receipts complete.
- [x] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass.
- [x] Linear proof comment added.
- [ ] Next queue candidate identified only after verify allows continuation.
