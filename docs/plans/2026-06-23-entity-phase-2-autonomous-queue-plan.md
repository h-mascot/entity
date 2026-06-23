## Task
Resume the approved Entity Phase 2 child queue and work one dependency-safe child issue at a time, starting with `THE-34`.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-23
**Agent:** Cursor
**Status:** IN PROGRESS

## Context
Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, Phase 2 context/spec files, `.project-gate.json`, and the execution-pack plan.

The approved queue is fixed (`THE-21` through `THE-95`) and cannot be reordered, expanded, or skipped without explicit approval. `THE-33` is complete by live parent child state, Book review approval, CLI Tester receipt with `reviewGateStatus=PASS`, and `nextChildBlocked=false`.

The active issue is `THE-34`, source `THE-8.4`, parent `THE-8`, title `Render task activity provenance UI`. Live Linear confirms it is a child issue with no children, state `Todo`, and blocker text satisfied by completed Slice 0 plus completed `THE-31`, `THE-32`, and `THE-33`.

## Dependencies
- [x] Required repo rules and Phase 2 context files are read.
- [x] `.project-gate.json` is read and requires proof commands plus Book review.
- [x] `THE-33` Book review receipt is `APPROVED` and `safeToContinue=true`.
- [x] `THE-33` CLI Tester receipt records `reviewGateStatus=PASS` and `nextChildBlocked=false`.
- [x] Mapping table identifies `THE-34` as source `THE-8.4`, parent `THE-8`.
- [x] Live Linear body confirms `THE-34` maps to `THE-8.4` and is dependency-safe.
- [x] Branch for `THE-34` exists before implementation.

## Plan
- [x] Step 1: Re-read repo rules, Phase 2 context, specs, package scripts, gate config, execution pack, mapping table, run-state, and current receipts.
  - **Files:** `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, `docs/specs/entity-phase-2-prd-canonical-20260620.md`, `docs/specs/entity-phase-2-spec-oracle55pro-20260620.md`, `package.json`, `.project-gate.json`, execution-pack plan, mapping table, run-state.
  - **Verify:** Required files read and current queue position identified.
- [x] Step 2: Reconcile `THE-33` state against current receipts and live Linear.
  - **Files:** `output/entity-phase-2/book-review/THE-33.json`, `output/entity-phase-2/test-gate/THE-33.json`, `.cursor/run-state/entity-phase-2.json`, Linear `THE-8`.
  - **Verify:** Book review is approved, receipt records `nextChildBlocked=false`, and live parent shows `THE-33` Done.
- [x] Step 3: Fetch and validate live `THE-34` and parent `THE-8`.
  - **Files:** Linear `THE-34`, Linear `THE-8`, mapping table, `.cursor/run-state/entity-phase-2.json`.
  - **Verify:** live body contains `THE-8.4`, issue is a child, no dependency violation or blocker.
- [x] Step 4: Create/use scoped branch and inspect existing task activity UI/API seams.
  - **Files:** `packages/app/src/components/mission-control/TaskDetailPanel.tsx`, `packages/server/src/activity-events.ts`, `packages/server/src/index.ts`, `packages/db/src/index.ts`.
  - **Verify:** current task detail API already returns activity rows; current `TaskDetailPanel` normalizer/render path is the right UI seam.
- [x] Step 5: Implement only `THE-34`.
  - **Files:** `packages/app/src/components/mission-control/TaskDetailPanel.tsx`.
  - **Verify:** task activity UI shows event type, actor, object ref, timestamp, reason/provenance, honest weak/unknown labels, and restricted placeholders without leaking content.
- [x] Step 6: Run focused tests/builds and capture UI proof for `THE-34`.
  - **Files:** `output/playwright/THE-34-activity-provenance-ui.png`, `output/playwright/THE-34-activity-provenance-dom.md`, `output/playwright/THE-34-restricted-activity-api.json`.
  - **Verify:** `npm --prefix packages/app run build` passed; Playwright DOM checks passed for structured event, weak legacy event, object ref, actor, reason, and restricted API `permissionState=hidden`.
- [ ] Step 7: Run proof commands and CLI Tester gates for `THE-34`.
  - **Files:** `output/entity-phase-2/test-gate/THE-34.*`, `output/entity-phase-2/book-review/THE-34.*`.
  - **Verify:** smoke, root build, server build+Vitest passed; CLI Tester request/run passed; Book review is `REQUESTED` with `safeToContinue=false`; verify was not run.
- [x] Step 8: Update local run-state and Linear proof comment for `THE-34`.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-34`.
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt, screenshot/DOM receipt, and blockers if any.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 08:28 | Step 1 | done | Required context, run-state, and execution pack reviewed after user goal prompt. |
| 08:34 | Step 2 | done | `THE-33` Book review approved and test-gate receipt shows `reviewGateStatus=PASS`, `nextChildBlocked=false`; live parent shows `THE-33` Done. |
| 08:35 | Step 3 | done | `THE-34` and parent `THE-8` fetched live; source mapping and dependency safety confirmed. |
| 08:37 | Step 4 | done | Branch `THE-34-render-task-activity-provenance-ui` created; existing task detail activity row seam selected. |
| 08:43 | Step 5 | done | `TaskDetailPanel` now renders structured ActivityEvent provenance, weak legacy labels, and restricted placeholders. |
| 08:49 | Step 6 | done | App build passed; Playwright screenshot/DOM and restricted API receipts written under `output/playwright/`. |
| 08:40 | Step 7 | blocked | Required proof commands and CLI Tester run passed under Node 22; Book review returned `REQUESTED` with `safeToContinue=false`; verify not run and `THE-35` not started. |
| 08:40 | Step 8 | done | Run-state updated and Linear proof/blocker comment posted: `9dd92d0e-9372-4eaf-8014-eadc2fa5dab2`. |

## Files Touched
- `docs/plans/ACTIVE_PLAN.md` - modified - current resume plan for `THE-34`.
- `docs/plans/2026-06-23-entity-phase-2-autonomous-queue-plan.md` - modified - compaction-safe queue plan copy.
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` - modified - structured ActivityEvent provenance rendering in task detail activity UI.
- `output/playwright/THE-34-activity-provenance-ui.png` - generated local UI proof screenshot.
- `output/playwright/THE-34-activity-provenance-dom.md` - generated local DOM proof receipt.
- `output/playwright/THE-34-restricted-activity-api.json` - generated restricted activity API proof.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Find the first unchecked step above.
5. Use Node v22.22.2/22.22.3 for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Do not start any issue after `THE-34` until `THE-34` proof commands pass, CLI Tester `run` passes, Book review is `APPROVED` with `safeToContinue=true`, and CLI Tester `verify THE-34` passes with `nextChildBlocked=false`, or Henry explicitly waives the gate.

## Done
- [x] `THE-33` complete by current receipts and live parent state.
- [x] `THE-34` identified as next candidate from the approved queue.
- [x] `THE-34` live Linear validation complete.
- [x] `THE-34` implementation complete.
- [x] UI screenshot/DOM proof captured.
- [x] Proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass; currently blocked at Book review.
- [x] Linear proof comment added.
- [ ] Next queue candidate identified only after verify allows continuation.
