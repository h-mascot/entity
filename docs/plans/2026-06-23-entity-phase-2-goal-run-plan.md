## Task
Execute the remaining approved Entity Phase 2 child queue one issue at a time, currently implementing `THE-40`.

**MC Task:** Entity Phase 2 approved queue  
**Created:** 2026-06-23  
**Agent:** Cursor  
**Status:** IN_PROGRESS

## Context
Authority order is live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

The approved queue is fixed (`THE-21` through `THE-95`) and cannot be reordered, expanded, or skipped without explicit approval. `THE-39` implementation, browser proof, proof commands, machine gate, Book review, and verify gate now pass. The current local step is to implement `THE-40` receipt immutability/path-stability tests and protocol docs.

Current local receipts show `THE-39` machine proof passed, Book review is `decision=APPROVED` with `safeToContinue=true`, and the gate receipt has `reviewGateStatus=PASS` plus `nextChildBlocked=false`.

## Dependencies
- [x] Required repo rules and Phase 2 context/spec files are read.
- [x] `.project-gate.json` is read and requires proof commands plus Book review.
- [x] `.cursor/run-state/entity-phase-2.json` is read.
- [x] `THE-36` local Book review receipt is approved.
- [x] `project-test-gate verify THE-36` passed under Node v22.22.3.
- [x] `THE-37` live issue and parent were fetched and validated.
- [x] `THE-37` machine proof passed.
- [x] `THE-37` Book review is `APPROVED` with `safeToContinue=true`.
- [x] `project-test-gate verify THE-37` passed with `nextChildBlocked=false`.
- [x] `THE-38` live issue and parent were fetched and validated.
- [x] `THE-38` machine proof passed.
- [x] `THE-38` Book review is `APPROVED` with `safeToContinue=true`.
- [x] `project-test-gate verify THE-38` passed with no blockers.
- [x] `THE-39` live issue and parent were fetched and validated.
- [x] `THE-39` Book review is `APPROVED` with `safeToContinue=true`.
- [x] `project-test-gate verify THE-39` passed with no blockers after refreshing the clean-tree request baseline.
- [x] `THE-40` live issue and parent were fetched and validated.
- [x] Branch `THE-40-harden-receipt-immutability-path-stability-and-protocol-docs` exists before implementation.

## Plan
- [x] Step 1: Re-read required repo rules, context, specs, package scripts, gate config, execution pack, mapping table, run-state, and current receipts.
  - **Files:** `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, `docs/specs/entity-phase-2-prd-canonical-20260620.md`, `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`, `package.json`, `.project-gate.json`, `docs/execution-packs/entity-phase-2-cursor-20260621/plan.md`, `.cursor/run-state/entity-phase-2.json`.
  - **Verify:** Required context read and current queue position identified.
- [x] Step 2: Confirm whether the `THE-36` Book review blocker still exists using local receipts and live Linear.
  - **Files:** `output/entity-phase-2/book-review/THE-36.json`, `output/entity-phase-2/test-gate/THE-36.json`, live Linear `THE-36`, live Linear parent `THE-9`.
  - **Verify:** Book review is approved and verify can run.
- [x] Step 3: Only if Step 2 clears, run `project-test-gate verify THE-36`.
  - **Files:** `output/entity-phase-2/test-gate/THE-36.json`.
  - **Verify:** `verify THE-36` exits 0 and reports `nextChildBlocked=false`.
- [x] Step 4: Only if Step 3 clears, start `THE-37`.
  - **Files:** live Linear `THE-37`, live Linear parent `THE-9`, mapping table, implementation files identified from issue body.
  - **Verify:** `THE-37` is a child issue, dependency-safe, and mapped to `THE-9.2`.
- [x] Step 5: Implement and prove `THE-37`.
  - **Files:** `packages/server/src/index.ts`, `packages/server/src/receipt-writer.ts`, `packages/server/src/receipt-writer.test.ts`.
  - **Verify:** required proof commands and CLI Tester machine gate pass.
- [x] Step 6: Clear `THE-37` Book review and verify gate before starting `THE-38`.
  - **Files:** `output/entity-phase-2/book-review/THE-37.json`, `output/entity-phase-2/test-gate/THE-37.json`.
  - **Verify:** Book review is `APPROVED`, `safeToContinue=true`, and gate receipt reports `nextChildBlocked=false`.
- [x] Step 7: Commit `THE-37`, post final Linear follow-up, then create/switch to `THE-38` branch and validate live issue.
  - **Files:** Linear `THE-37`, Linear `THE-38`, `.cursor/run-state/entity-phase-2.json`.
  - **Verify:** scoped commit exists, Linear has final proof, `THE-38` is child/dependency-safe before implementation.
- [x] Step 8: Implement, prove, and verify `THE-38`.
  - **Files:** `packages/server/src/receipt-writer.ts`, `packages/server/src/receipt-writer.test.ts`, receipt gate outputs.
  - **Verify:** proof commands, CLI Tester request/run/book-review/verify pass.
- [x] Step 9: Branch and implement `THE-39` receipt viewer/missing-evidence UI.
  - **Files:** `packages/app/src/components/mission-control/TaskDetailPanel.tsx`, task detail support files as needed.
  - **Verify:** UI displays receipt status/link, evidence summary, missing evidence, integrity/degraded states, output links, provenance, and raw-vs-curated distinction.
- [x] Step 10: Prove `THE-39` and update Linear/run-state.
  - **Files:** screenshot/DOM receipts, gate receipts, `.cursor/run-state/entity-phase-2.json`, Linear `THE-39`.
  - **Verify:** browser/DOM proof, proof commands, CLI Tester request/run/book-review/verify pass.
- [x] Step 11: Implement `THE-40` receipt immutability/path-stability tests and protocol docs.
  - **Files:** receipt tests, receipt/path stability docs under `docs/`, supporting source files as needed.
  - **Verify:** raw receipt overwrite attempts are rejected, task/project/team move path stability is covered, and protocol docs explain creation/failure/regeneration/review usage.
- [ ] Step 12: Prove `THE-40`, run the four-step CLI Tester gate, update Linear/run-state, and commit scoped work.
  - **Files:** `output/entity-phase-2/test-gate/THE-40.*`, `output/entity-phase-2/book-review/THE-40.*`, `.cursor/run-state/entity-phase-2.json`, Linear `THE-40`.
  - **Verify:** proof commands, request/run/book-review/verify pass with `nextChildBlocked=false`.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 12:17 | Step 1 | done | Required context and existing run-state read after the new goal prompt. |
| 12:20 | Step 2 | blocked | Live Linear marks `THE-36` Done and includes a comment claiming approval, but local `project-test-gate book-review THE-36` rerun exited 1 with `REQUESTED` and `safeToContinue=false`; `THE-37` was not started. Linear comment `2a688a8b-b3d9-4846-9441-67bf29e7ccad` records the blocker. |
| 12:57 | Step 2 | done | Local Book review receipt for `THE-36` now records `APPROVED`/`safeToContinue=true`; `verify THE-36` passed under Node v22.22.3. |
| 12:58 | Step 4 | done | `THE-37` and parent `THE-9` fetched live; child mapping and dependency safety confirmed. |
| 13:05 | Step 5 | blocked | `THE-37` proof commands and CLI Tester run passed, but Book review returned `REQUESTED`/`safeToContinue=false`; `THE-38` not started. |
| 13:34 | Step 6 | done | Book review receipt now records `APPROVED`/`safeToContinue=true`; first verify attempt used Node v26 and failed with known `better-sqlite3` ABI mismatch, rerun with Node v22.22.3 passed with blockers=[]. |
| 13:37 | Step 6 | blocked | Fixed receipt hash basis, reran focused test and proof commands successfully, then reran CLI request/run/book-review. Machine gate passed, but fresh Book review returned `REQUESTED`/`safeToContinue=false`; verify was not run. |
| 13:38 | Step 7 | blocked | Linear blocker follow-up posted: `0ddad8f8-b5d7-482f-a9f3-c3398ae38294`; no commit and no `THE-38` branch because Book approval is still missing. |
| 14:16 | Step 6 | done | Current local receipts now show Book `APPROVED`/`safeToContinue=true` and gate `reviewGateStatus=PASS`, `nextChildBlocked=false`; commit is now unblocked. |
| 14:18 | Step 7 | done | Scoped `THE-37` commit created: `cf3a34d`. Final Linear proof update posted: `ee799ee6-759f-4d18-a6ff-3cd1a0414744`. |
| 14:35 | Step 8 | done | `THE-38` receipts show Book `APPROVED`/`safeToContinue=true`; `project-test-gate verify THE-38` exited 0 with no blockers. |
| 14:36 | Step 9 | in progress | Live `THE-39` and parent `THE-9` fetched; child mapping and dependency safety confirmed. |
| 14:47 | Step 9 | done | `TaskDetailPanel` receipt viewer/missing-evidence UI implemented on `THE-39-build-receipt-viewer-and-missing-evidence-ui`. |
| 14:47 | Step 10 | blocked | Browser screenshot and DOM proof captured; proof commands and CLI Tester request/run passed. Book review remains packet-mode `REQUESTED`/`safeToContinue=false`; verify exited 1 and `THE-40` was not started. Linear proof/blocker comment: `4e4327d5-d270-4407-a2c9-61329f1eec9e`. |
| 14:53 | Step 10 | blocked | Refreshed browser proof after language cleanup and reran proof commands plus CLI Tester request/run/book-review/verify. Machine gate remains `PASS`; Book remains `REQUESTED`/`safeToContinue=false`; verify exits 1. |
| 15:14 | Step 10 | done | `THE-39` Book review now records `APPROVED`/`safeToContinue=true`; refreshed clean-tree request baseline and reran `project-test-gate verify THE-39`, which passed with blockers=[]. Live Linear shows `THE-39` Done. |
| 15:16 | Step 11 | in progress | Created branch `THE-40-harden-receipt-immutability-path-stability-and-protocol-docs`; live Linear confirms `THE-40` is child `THE-9.5`, no children, with prior canonical receipt siblings done. |
| 15:19 | Step 11 | done | Receipt writer now writes raw receipt bodies with exclusive creation; focused tests cover overwrite rejection and task/project/team alias moves; protocol docs added. |
| 15:21 | Step 12 | blocked | Focused tests, smoke, root build, server build+Vitest, CLI Tester request/run passed. Book review returned `REQUESTED`/`safeToContinue=false`; verify exited 1 with review gate blocked. Do not start `THE-41`. |

## Files Touched
- `docs/plans/2026-06-23-entity-phase-2-goal-run-plan.md` - created/modified - dated resume plan for the current goal-mode run.
- `docs/plans/ACTIVE_PLAN.md` - modified - active resume plan, currently implementing `THE-40`.
- `packages/server/src/index.ts` - modified - completion routes require synchronous receipt writing before `done`.
- `packages/server/src/receipt-writer.ts` - created - receipt body/hash/artifact/activity writer.
- `packages/server/src/receipt-writer.test.ts` - created - receipt snapshot, success, and write-failure tests.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - receipt path stability across task/project/team alias moves.
- `docs/context/entity-phase-2-canonical-receipt-protocol.md` - created - canonical receipt protocol for creation, failure, regeneration, review usage, immutability, and path stability.
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` - modified - receipt viewer and missing-evidence UI.
- `output/playwright/THE-39-receipt-viewer-missing-evidence.png` - generated - browser screenshot proof.
- `output/playwright/THE-39-receipt-viewer-dom.html` - generated - browser DOM proof.

## Resume Instructions
1. Re-read this file and `docs/plans/ACTIVE_PLAN.md` fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Confirm the first unchecked step above.
5. Continue from `THE-40` Step 12. Do not start `THE-41` until `output/entity-phase-2/book-review/THE-40.json` records `decision=APPROVED` and `safeToContinue=true`, then rerun `project-test-gate verify THE-40` successfully.

## Done
- [x] Required preread complete.
- [x] Current queue stop point identified.
- [x] `THE-36` blocker cleared or reported.
- [x] `THE-37` implemented and machine-proven.
- [x] `THE-37` Book review/verify passed.
- [x] `THE-37` final Linear blocker follow-up complete.
- [x] `THE-37` scoped commit complete after Book approval.
- [x] `THE-38` implementation/proof/Book review/verify complete.
- [x] `THE-39` live issue validation complete.
- [x] `THE-39` implementation and UI proof complete.
- [x] `THE-39` Linear proof/blocker comment posted.
- [x] `THE-39` Book review and verify complete.
- [x] `THE-40` implementation and machine proof complete.
- [ ] `THE-40` Book review and verify complete.
- [ ] Remaining dependency-safe queue complete.
