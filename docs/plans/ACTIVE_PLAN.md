## Task
Resume the approved Entity Phase 2 child queue and work one dependency-safe child issue at a time, currently implementing `THE-39`.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** IN_PROGRESS

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

The approved queue is fixed (`THE-21` through `THE-95`) and cannot be reordered, expanded, or skipped without explicit approval. `THE-38` is implemented and fully verified locally: machine gate `PASS`, Book review `APPROVED` with `safeToContinue=true`, and `project-test-gate verify THE-38` exited 0 with no blockers.

The active issue is `THE-39`, source `THE-9.4`, parent `THE-9`, title `Build receipt viewer and missing-evidence UI`. Live Linear confirms it is a child issue with no children, state `Todo`, and parent `THE-9` shows `THE-36`, `THE-37`, and `THE-38` done.

## Dependencies
- [x] Required repo rules and Phase 2 context/spec files are read.
- [x] `.project-gate.json` is read and requires proof commands plus Book review.
- [x] `THE-36` Book review receipt is `APPROVED` and `safeToContinue=true`.
- [x] `project-test-gate verify THE-36` passed.
- [x] Mapping table identifies `THE-37` as source `THE-9.2`, parent `THE-9`.
- [x] Live Linear body confirms `THE-37` maps to `THE-9.2` and is a child issue.
- [x] Branch for `THE-37` exists before implementation.
- [x] `THE-37` Book review receipt is `APPROVED` and `safeToContinue=true`.
- [x] `project-test-gate verify THE-37` passed after Book review approval.
- [x] Mapping table identifies `THE-38` as source `THE-9.3`, parent `THE-9`.
- [x] Live Linear body confirms `THE-38` maps to `THE-9.3` and is a child issue.
- [x] Branch for `THE-38` exists before implementation.
- [x] `THE-38` Book review receipt is `APPROVED` and `safeToContinue=true`.
- [x] `project-test-gate verify THE-38` passed with no blockers.
- [x] Mapping table identifies `THE-39` as source `THE-9.4`, parent `THE-9`.
- [x] Live Linear body confirms `THE-39` maps to `THE-9.4` and is a child issue.

## Plan
- [x] Step 1: Re-read repo rules, Phase 2 context/specs, package scripts, gate config, execution pack, mapping table, run-state, and current receipts.
  - **Files:** `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, `docs/specs/entity-phase-2-prd-canonical-20260620.md`, `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`, `package.json`, `.project-gate.json`, execution-pack plan, mapping table, run-state.
  - **Verify:** Required files read and current queue position identified.
- [x] Step 2: Verify `THE-36` continuation gate.
  - **Files:** `output/entity-phase-2/book-review/THE-36.json`, `output/entity-phase-2/test-gate/THE-36.json`.
  - **Verify:** Book review is approved, receipt records `nextChildBlocked=false`, and `project-test-gate verify THE-36` exits 0.
- [x] Step 3: Fetch and validate live `THE-37` and parent `THE-9`.
  - **Files:** Linear `THE-37`, Linear `THE-9`, mapping table, `.cursor/run-state/entity-phase-2.json`.
  - **Verify:** live body contains `THE-9.2`, issue is a child, no dependency violation or blocker.
- [x] Step 4: Inspect existing receipt/artifact schema, completion paths, and tests.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/index.ts`, `packages/server/src/activity-events.ts`, existing tests.
  - **Verify:** identify smallest synchronous receipt writer slice for `THE-37`.
- [x] Step 5: Implement only `THE-37`.
  - **Files:** `packages/server/src/receipt-writer.ts`, `packages/server/src/index.ts`.
  - **Verify:** clean done transition writes receipt markdown, computes hash, creates EvidenceArtifact metadata, records receipt activity, then updates the task to `done`.
- [x] Step 6: Add focused regression tests and receipt snapshot proof.
  - **Files:** `packages/server/src/receipt-writer.test.ts`.
  - **Verify:** tests cover canonical receipt fields, artifact metadata/activity linkage, and body-write failure preventing completion.
- [x] Step 7: Run proof commands and CLI Tester gates for `THE-37`.
  - **Files:** `output/entity-phase-2/test-gate/THE-37.*`, `output/entity-phase-2/book-review/THE-37.*`.
  - **Verify:** proof commands, machine gate, Book review, and verify all pass; `nextChildBlocked=false`.
- [x] Step 8: Update local run-state and Linear proof comment for `THE-37`.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-37`.
  - **Verify:** Linear follow-up includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt, and blocker.
- [x] Step 9: Create/switch to `THE-38` branch and validate live issue before implementation.
  - **Files:** Linear `THE-38`, Linear `THE-9`, `.cursor/run-state/entity-phase-2.json`.
  - **Verify:** `THE-38` is a child issue, dependency-safe, mapped to `THE-9.3`, and branch exists before implementation.
- [x] Step 10: Inspect receipt failure, metadata integrity, and regeneration seams.
  - **Files:** `packages/server/src/receipt-writer.ts`, `packages/server/src/index.ts`, `packages/db/src/index.ts`, existing receipt/artifact tests.
  - **Verify:** identify smallest `THE-38` implementation path for failed body writes, metadata failures after body write, orphan reconciliation, and metadata regeneration without rewriting bodies.
- [x] Step 11: Implement only `THE-38`.
  - **Files:** `packages/server/src/receipt-writer.ts`, `packages/server/src/receipt-writer.test.ts`.
  - **Verify:** body write failure leaves task non-done with `receipt_status=failed` and event; metadata failure after body write leaves task non-done with `receipt_status=integrity_error` and reconciliation queue; regeneration refuses missing body and never rewrites the body.
- [x] Step 12: Run proof commands and CLI Tester gates for `THE-38`.
  - **Files:** `output/entity-phase-2/test-gate/THE-38.*`, `output/entity-phase-2/book-review/THE-38.*`.
  - **Verify:** proof commands, request, run, Book review, and verify all pass; `nextChildBlocked=false`.
- [x] Step 13: Create/switch to `THE-39` branch and validate receipt viewer UI seams before editing.
  - **Files:** `packages/app/src/components/mission-control/TaskDetailPanel.tsx`, task board hooks/types, receipt API response fields.
  - **Verify:** branch exists, relevant UI/server response paths are read, and edit scope is limited to receipt viewer/missing-evidence UI.
- [x] Step 14: Implement only `THE-39`.
  - **Files:** task detail UI and focused supporting API/type/test files as needed.
  - **Verify:** task detail shows receipt status/link, evidence summary, missing evidence, output links, provenance, integrity/degraded state, and raw-vs-curated distinction.
- [ ] Step 15: Prove `THE-39` with UI/browser evidence and gates.
  - **Files:** `output/playwright/THE-39-*`, `output/entity-phase-2/test-gate/THE-39.*`, `output/entity-phase-2/book-review/THE-39.*`.
  - **Verify:** screenshot/DOM proof, missing-evidence proof, proof commands, request/run/book-review/verify pass before moving to `THE-40`.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 12:55 | Step 1 | done | Required context/specs, run-state, gate config, and execution pack reviewed after new goal prompt. |
| 12:57 | Step 2 | done | `THE-36` Book review now approved; `verify THE-36` passed under Node v22.22.3 after a Node v26 ABI false start. |
| 12:58 | Step 3 | done | `THE-37` and parent `THE-9` fetched live; source mapping and dependency safety confirmed. |
| 13:00 | Step 4 | done | Existing completion routes updated tasks before any receipt writer; no dedicated receipt service existed. |
| 13:02 | Step 5 | done | Added synchronous receipt writer and wired update/move done transitions to require receipt body, metadata, and receipt activity before `done`. |
| 13:02 | Step 6 | done | Focused receipt writer tests passed; snapshot covers canonical required receipt sections. |
| 13:05 | Step 7 | blocked | Smoke, root build, server build+Vitest (58 files / 416 tests), CLI Tester request, and CLI Tester run passed. Book review returned `REQUESTED`/`safeToContinue=false`; verify was not run. |
| 13:34 | Step 7 | done | Book review receipt repaired to `APPROVED`/`safeToContinue=true`; first verify attempt used Node v26 and failed with the known `better-sqlite3` ABI mismatch, rerun with Node v22.22.3 passed with blockers=[]. |
| 13:37 | Step 7 | blocked | Fixed receipt hash basis, reran focused test and proof commands successfully, then reran CLI request/run/book-review. Machine gate passed, but fresh Book review returned `REQUESTED`/`safeToContinue=false`; verify was not run. |
| 13:38 | Step 8 | done | Linear blocker follow-up posted: `0ddad8f8-b5d7-482f-a9f3-c3398ae38294`. |
| 14:16 | Step 7 | done | Current local receipts now show `THE-37` Book review `APPROVED`/`safeToContinue=true`; test gate has `reviewGateStatus=PASS` and `nextChildBlocked=false`. |
| 14:18 | Step 8 | done | Scoped `THE-37` commit created: `cf3a34d`. Final Linear proof update posted: `ee799ee6-759f-4d18-a6ff-3cd1a0414744`. |
| 14:20 | Step 9 | done | Created branch `THE-38-implement-receipt-failure-and-integrity-recovery-states`; live Linear confirms child `THE-9.3`, no children, state `Todo`; parent `THE-9` shows `THE-36` and `THE-37` done. |
| 14:24 | Step 12 | blocked | Focused receipt tests passed (6 tests), required proof commands passed (58 files / 419 tests), CLI Tester request/run passed, GitNexus low risk. Book review returned `REQUESTED`/`safeToContinue=false`; verify was not run. |
| 14:25 | Step 12 | blocked | Scoped implementation commit created: `e3db8ab`. Linear proof/blocker comment posted: `9b547170-449c-4b15-9b31-97fbc182d4c1`. |
| 14:35 | Step 12 | done | Local receipts now show `THE-38` Book review `APPROVED`/`safeToContinue=true`; `project-test-gate verify THE-38` exited 0 with status `PASS` and no blockers. |
| 14:36 | Step 13 | in progress | Live `THE-39` and parent `THE-9` fetched; child mapping and dependency safety confirmed. |
| 14:47 | Step 13 | done | Branch `THE-39-build-receipt-viewer-and-missing-evidence-ui` active; receipt metadata/UI seams inspected. |
| 14:47 | Step 14 | done | `TaskDetailPanel` renders the Receipt and Proof panel with receipt link/status, evidence summary, missing evidence, output links, provenance, integrity/degraded states, content hash, and raw-vs-curated distinction. |
| 14:47 | Step 15 | blocked | Screenshot and DOM proof captured; smoke, root build, server build+Vitest, and CLI Tester request/run passed. Book review is packet-mode `REQUESTED` with `safeToContinue=false`; `verify THE-39` exited 1, so `THE-40` was not started. Linear blocker/proof comment: `4e4327d5-d270-4407-a2c9-61329f1eec9e`. |
| 14:53 | Step 15 | blocked | After language cleanup, refreshed browser proof and reran proof commands plus CLI Tester request/run/book-review/verify. Machine gate remains `PASS` with scans zero; Book remains `REQUESTED`/`safeToContinue=false`; verify exits 1. |

## Files Touched
- `docs/plans/ACTIVE_PLAN.md` - modified - current resume plan for `THE-39`.
- `docs/plans/2026-06-23-entity-phase-2-goal-run-plan.md` - modified - dated goal-mode plan.
- `packages/server/src/index.ts` - modified - completion routes require synchronous receipt writing before `done`.
- `packages/server/src/receipt-writer.ts` - modified - explicit failed/integrity receipt states and metadata regeneration helper.
- `packages/server/src/receipt-writer.test.ts` - modified - failure, orphan reconciliation, and missing-body regeneration tests.
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` - modified - receipt viewer and missing-evidence UI.
- `output/playwright/THE-39-receipt-viewer-missing-evidence.png` - generated - browser screenshot proof.
- `output/playwright/THE-39-receipt-viewer-dom.html` - generated - browser DOM proof.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Find the first unchecked step above.
5. Use Node v22.22.x for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Continue `THE-39` from Step 15. Do not start `THE-40` until `output/entity-phase-2/book-review/THE-39.json` records `decision=APPROVED` and `safeToContinue=true`, then rerun `project-test-gate verify THE-39` successfully.

## Done
- [x] `THE-36` complete by current receipts and verify gate.
- [x] `THE-37` identified as next candidate from the approved queue.
- [x] `THE-37` live Linear validation complete.
- [x] `THE-37` implementation complete.
- [x] Focused tests and fixture receipts complete.
- [x] Proof commands pass.
- [x] CLI Tester request/run/book-review/verify pass.
- [x] Linear follow-up comment added for the fresh blocker.
- [x] Next queue candidate identified only after verify allows continuation.
- [x] `THE-37` scoped commit created.
- [x] `THE-38` branch created and live issue validation complete.
- [x] `THE-38` implementation complete.
- [x] `THE-38` proof commands and machine gate pass.
- [x] `THE-38` implementation commit and Linear blocker comment complete.
- [x] `THE-38` Book review and verify pass.
- [x] `THE-39` live issue validation complete.
- [x] `THE-39` implementation and UI proof complete.
- [x] `THE-39` proof/blocker Linear comment posted.
- [ ] `THE-39` Book review and verify complete.
