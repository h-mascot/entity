# Entity Phase 2 THE-70 Notification Contracts And Degraded Behavior Plan

## Task
Entity Phase 2 THE-70: document notification contracts and degraded behavior.

**MC Task:** THE-70
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** IN PROGRESS

## Context
Live Linear issue THE-70 is child issue THE-15.5 under THE-15 inbox and notifications. Scope is docs plus tests for notification contracts: Entity inbox/activity is canonical, external channels are delivery routes only, failed/degraded routes remain visible, and no notification claim depends solely on external channel success.

## Dependencies
- [x] Current run-state points to THE-70.
- [x] THE-66 canonical notification schema is complete.
- [x] THE-67 notification routing policy and delivery adapters are complete.
- [x] THE-69 inbox/notification UI is complete.
- [x] Branch created from THE-69 closeout commit: `THE-70-document-notification-contracts-and-degraded-behavior`.
- [x] Live child issue and parent THE-15 body inspected.

## Plan

- [x] Step 1: Add a focused notification contract doc covering source-of-truth behavior, delivery route status, failure handling, supported types, and deep-link/object-ref expectations.
  - **Files:** `docs/context/entity-phase-2-notification-contracts.md`
  - **Verify:** doc references canonical records and external route behavior without adding product scope.
- [x] Step 2: Add degraded-channel test coverage proving canonical notification retention when all external delivery routes fail, are skipped, or are degraded.
  - **Files:** `packages/server/src/notification-routing.test.ts`
  - **Verify:** focused Vitest test passes and asserts Entity inbox delivery is not dependent on external success.
- [x] Step 3: Run proof commands and GitNexus/diff checks.
  - **Files:** proof artifacts under `output/entity-phase-2/`
  - **Verify:** `cd packages/server && npx vitest run src/notification-routing.test.ts`; `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`
- [ ] Step 4: Run CLI Tester request/run/book-review/verify.
  - **Files:** `output/entity-phase-2/test-gate/THE-70.*`, `output/entity-phase-2/book-review/THE-70*`
  - **Verify:** machine gate PASS, Book review approved by packet-mode local approval only if scans are clean and diff is scoped.
- [ ] Step 5: Comment Linear, mark THE-70 Done, update run-state to THE-71, and commit scoped changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/docs/tests/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 04:47Z | Setup | done | Read live child/parent issue; branch created after THE-69 completion. |
| 04:50Z | Steps 1-2 | done | Added notification contract doc and degraded external-route retention test. |
| 04:52Z | Proof | done | Focused test, full proof commands, and GitNexus detect-changes passed; risk low. |

## Files Touched
- `docs/plans/2026-06-24-044700-entity-phase-2-the-70-notification-contracts-degraded-behavior-plan.md` - created - THE-70 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-70 plan.
- `docs/context/entity-phase-2-notification-contracts.md` - created - canonical notification and delivery route contract.
- `packages/server/src/notification-routing.test.ts` - updated - all-external-routes-degraded canonical retention test.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-70 scoped to notification contract docs and degraded external route tests.

## Done
- [ ] All steps complete
- [ ] Tests/build pass
- [ ] CLI Tester request/run/book-review/verify complete
- [ ] Linear THE-70 proof comment added and status moved to Done
- [ ] Run-state advanced to THE-71
