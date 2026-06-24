## Task
Build `THE-50` / `THE-11.5`: review/gate UI panels and policy documentation.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** GATE IN PROGRESS

## Context
Live Linear `THE-50` is a child issue under parent `THE-11`, source `THE-11.5`. Scope is UI/documentation: show review reason chains, eligible controls, separate human gate state, and override audit in task detail/admin surfaces; add policy docs explaining resolver, separation of duties, override, and human gate semantics.

Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, canonical PRD, Oracle spec, `.project-gate.json`, execution-pack plan.

## Dependencies
- [x] Required repo rules, context, canonical PRD, Oracle spec, gate config, package scripts, parent epic, and live `THE-50` Linear body read.
- [x] Live Linear `THE-50` confirmed as child `THE-11.5` under parent `THE-11`.
- [x] Parent `THE-11` confirms review, human gate, receipt ordering, reason-chain, and SoD scope.
- [x] Prior siblings `THE-46`, `THE-47`, `THE-48`, and `THE-49` are complete/waived per Linear/run-state.
- [x] Current branch created: `THE-50-build-review-gate-ui-panels-and-policy-documentation`.

## Plan
- [x] Step 1: Inspect existing task detail, admin/settings, task board API shapes, and policy docs.
  - **Files:** likely `packages/app/src/components/mission-control/TaskDetailPanel.tsx`, `packages/app/src/hooks/useTaskBoard.ts`, docs.
  - **Verify:** identify the smallest UI/doc changes that show existing THE-46 through THE-49 state without widening backend scope unnecessarily.
- [x] Step 2: Add visually separate review and human gate panels.
  - **Files:** likely task detail UI components and CSS/module styles if present.
  - **Verify:** panel state renders review reasons, human gate state, and resolved/pending/degraded states distinctly.
- [x] Step 3: Render eligible controls only for eligible actors.
  - **Files:** likely task detail UI plus client API helpers.
  - **Verify:** eligible actor can see review accept/request-fix and human gate approve/reject/request controls; ineligible state is explanatory and non-actionable.
- [x] Step 4: Surface override audit and policy documentation.
  - **Files:** docs and UI text as needed.
  - **Verify:** docs explain resolver, SoD, override, and gate semantics using Entity product language.
- [x] Step 5: Run focused builds/tests and browser/DOM proof.
  - **Files:** proof artifacts only.
  - **Verify:** `npm --prefix packages/app run build`, `npm run build`, server proof if touched, and browser/DOM/screenshot receipt for UI-facing work.
- [ ] Step 6: Run CLI Tester four-step for `THE-50`.
  - **Files:** `output/entity-phase-2/test-gate/THE-50.*`, `output/entity-phase-2/book-review/THE-50.*`, audits if needed.
  - **Verify:** request/run/book-review/verify complete; Book review APPROVED and `safeToContinue=true`; verify unblocks next child or has explicit approved waiver.
- [ ] Step 7: Comment Linear, update run-state, commit, and advance only if proof supports it.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-50`.
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt, screenshots/DOM proof, and blockers if any.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 01:05 | Setup | in progress | `THE-49` completed, Linear marked Done, run-state advanced to `THE-50`, branch created. `THE-50` and parent `THE-11` live Linear bodies read. |
| 01:16 | Steps 1-5 | done | Added separate task-detail Review Policy and Human Gate panels, eligible-actor controls, admin policy summary, policy doc, and browser proof. Proof commands passed: `npm --prefix packages/app run build`, `npm run build`, `cd packages/server && npm run build && npx vitest run` (60 files / 448 tests), and `bash scripts/proof/entity-phase-2-smoke.sh`. |

## Files Touched
- `docs/plans/2026-06-24-entity-phase-2-the-50-review-gate-ui-policy-docs-plan.md` - created - compaction-safe plan for `THE-50`.
- `docs/plans/ACTIVE_PLAN.md` - modified - active resume plan for `THE-50`.
- `docs/context/entity-phase-2-review-gate-policy.md` - created - review/human gate resolver, SoD, override, and UI semantics.
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` - modified - separate review/human gate panels and eligible action controls.
- `packages/app/src/components/TaskMasterSettings.tsx` - modified - admin policy summary.
- `output/playwright/THE-50-review-gate-ui-panels.png` - created - task detail screenshot proof.
- `output/playwright/THE-50-review-gate-ui-dom.md` - created - task detail DOM proof.
- `output/playwright/THE-50-review-gate-admin-policy.png` - created - admin policy screenshot proof.
- `output/playwright/THE-50-review-gate-admin-policy-dom.md` - created - admin policy DOM proof.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Continue from the first unchecked step above.
5. Use Node v22.22.x for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Do not start the next child until `THE-50` proof commands, UI proof, CLI Tester run, Book review, and verify pass, or Henry explicitly approves a waiver.

## Done
- [x] `THE-50` implementation complete.
- [x] UI browser/DOM proof captured.
- [x] Required builds/tests pass.
- [ ] CLI Tester request/run/book-review/verify pass with `nextChildBlocked=false`.
- [ ] Linear proof comment posted.
- [ ] Scoped commit created.
- [ ] Run-state advanced to the next child.
