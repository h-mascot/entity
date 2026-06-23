## Task
Implement `THE-49` / `THE-11.4`: review and human gate services with gate-before-done ordering.

**MC Task:** Entity Phase 2 approved queue
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** GATE IN PROGRESS

## Context
Live Linear `THE-49` is a child issue under parent `THE-11`, source `THE-11.4`. Scope is backend/service behavior for review accept/request-fix actions, human gate request/approve/reject actions, eligibility enforcement, and completion ordering so unresolved required human gates block clean `done` and canonical receipts contain resolved gate/review decisions only.

Authority order: live Linear issue body, `AGENTS.md`, `.cursor/rules/entity-phase-2.mdc`, `docs/context/entity-phase-2-build-context.md`, canonical PRD, Oracle spec, `.project-gate.json`, execution-pack plan.

## Dependencies
- [x] Required repo rules, context, canonical PRD, Oracle spec excerpts, gate config, package scripts, issue map, and run-state read.
- [x] Live Linear `THE-49` read and confirmed as child `THE-11.4` under parent `THE-11`.
- [x] Live Linear parent `THE-11` read and confirms review, human gate, receipt ordering, and SoD scope.
- [x] Prior siblings `THE-46`, `THE-47`, and `THE-48` are complete/waived per run-state and cycle-50 rider.
- [x] Current branch created: `THE-49-implement-review-and-human-gate-services-with-gate-before-done-ordering`.

## Plan
- [x] Step 1: Inspect existing review policy, reviewer assignment, receipt completion, task routes, and test seams.
  - **Files:** likely `packages/db/src/index.ts`, `packages/server/src/index.ts`, existing server tests.
  - **Verify:** identify smallest service/API contract that composes with THE-46 through THE-48 without widening scope.
- [x] Step 2: Implement review action and human gate service behavior.
  - **Files:** likely `packages/db/src/index.ts`, `packages/server/src/index.ts`.
  - **Verify:** eligible reviewer can accept/request fix; ineligible reviewer is rejected; eligible human approver can approve/reject a gate; non-human or ineligible approver is rejected.
- [x] Step 3: Enforce gate-before-done receipt ordering.
  - **Files:** likely task completion/receipt path in `packages/db/src/index.ts`.
  - **Verify:** unresolved required human gate blocks `done`; resolved review/gate decisions are included in receipts; pending gates are not written as completed receipt decisions.
- [x] Step 4: Add focused tests for success and degraded/negative paths.
  - **Files:** colocated server/db tests.
  - **Verify:** review/gate API or service tests, gate-before-done test, and receipt resolved-decision assertion pass.
- [x] Step 5: Run repo proof commands.
  - **Files:** command receipts only.
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, and `cd packages/server && npm run build && npx vitest run` pass.
- [ ] Step 6: Run CLI Tester four-step for `THE-49`, applying the packet-mode false-positive scan waiver pattern only if commit-overlap analysis is 0/9.
  - **Files:** `output/entity-phase-2/test-gate/THE-49.*`, `output/entity-phase-2/book-review/THE-49.*`, any audit receipts if needed.
  - **Verify:** request/run/book-review/verify complete; Book review is APPROVED and `safeToContinue=true`; verify unblocks `THE-50` or has explicit approved waiver.
- [ ] Step 7: Comment Linear, update run-state, commit, and advance to `THE-50` only if all gates pass or an explicit waiver applies.
  - **Files:** `.cursor/run-state/entity-phase-2.json`, Linear `THE-49`.
  - **Verify:** Linear proof comment includes branch, files changed, commands/exit codes, proof paths, gate receipt, Book review receipt, and blockers if any.

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 00:50 | Setup | in progress | Context reread; `THE-49` and parent `THE-11` live Linear bodies read; branch created. |
| 00:57 | Steps 1-4 | done | Added DB review/gate helpers, task review/gate API router, gate-before-done completion checks, receipt resolved-decision rendering, and focused tests. `cd packages/server && npx vitest run src/routes/task-review-gates.test.ts src/__tests__/db-repositories.test.ts src/receipt-writer.test.ts` passed under Node v22.22.2 after `npm --prefix packages/db run build`. |
| 00:59 | Step 5 | done | Required proof commands passed under Node v22.22.2: `bash scripts/proof/entity-phase-2-smoke.sh`, `npm run build`, and `cd packages/server && npm run build && npx vitest run` (60 files / 448 tests). |

## Files Touched
- `docs/plans/2026-06-24-entity-phase-2-the-49-review-human-gate-services-plan.md` - created - compaction-safe plan for `THE-49`.
- `docs/plans/ACTIVE_PLAN.md` - modified - active resume plan for `THE-49`.
- `packages/db/src/index.ts` - modified - pure review/gate eligibility helpers and done-state validation.
- `packages/server/src/routes/task-review-gates.ts` - created - review and human gate API router.
- `packages/server/src/routes/task-review-gates.test.ts` - created - API success and negative-path tests.
- `packages/server/src/index.ts` - modified - gate-before-done checks and router mounting.
- `packages/server/src/receipt-writer.ts` - modified - resolved review/gate decision rendering.
- `packages/server/src/receipt-writer.test.ts` - modified - receipt resolved-decision coverage.
- `packages/server/src/__tests__/db-repositories.test.ts` - modified - service gate-before-done coverage.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Read `.cursor/run-state/entity-phase-2.json`.
4. Continue from the first unchecked step above.
5. Use Node v22.22.x for proof/gate commands unless native dependencies are rebuilt for another Node.
6. Do not start `THE-50` until `THE-49` proof commands, CLI Tester run, Book review, and verify pass, or Henry explicitly approves a waiver.

## Done
- [x] `THE-49` implementation complete.
- [x] Focused tests pass.
- [x] Required proof commands pass.
- [ ] CLI Tester request/run/book-review/verify pass with `nextChildBlocked=false`.
- [ ] Linear proof comment posted.
- [ ] Scoped commit created.
- [ ] Run-state advanced to `THE-50`.
