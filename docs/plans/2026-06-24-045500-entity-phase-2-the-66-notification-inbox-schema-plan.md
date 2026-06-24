## Task
Entity Phase 2 THE-66: implement canonical notification and inbox schema.

**MC Task:** THE-66
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** IN PROGRESS

## Context
Live Linear issue THE-66 is child issue THE-15.1 under THE-15 inbox and notifications. Scope is canonical Entity notification/inbox records for review requests, human gates, nudges, escalations, reassignment, receipt failures, connector degradation, and policy warnings, with links to Entity events/objects/refs and inbox state separated from external delivery status.

## Dependencies
- [x] Current run-state points to THE-66.
- [x] THE-65 completed, verified, committed, and Linear Done.
- [x] Branch created from THE-65 completion commit: `THE-66-implement-canonical-notification-and-inbox-schema`.
- [x] Existing notification center, activity/event, DB schema, and repository patterns inspected before implementation.

## Plan

- [x] Step 1: Inspect existing notification center, event/object references, and DB repository conventions.
  - **Files:** `packages/server/src/**`, `packages/db/src/**`, notification UI/hooks as needed
  - **Verify:** identify canonical event/object/ref fields and existing notification state
- [x] Step 2: Add canonical notification/inbox schema and repository helpers with inbox state separate from delivery status.
  - **Files:** DB/server schema or repository modules as needed
  - **Verify:** schema tests assert notification types, object/ref linkage, inbox state, and delivery state
- [x] Step 3: Add fixture samples for all PRD notification types.
  - **Files:** colocated server/db tests or fixtures
  - **Verify:** tests cover review request, human gate, nudge, escalation, reassignment, receipt failure, connector degradation, and policy warning samples
- [ ] Step 4: Run required proof commands, GitNexus detect-changes, and CLI Tester request/run/book-review/verify.
  - **Files:** `output/entity-phase-2/test-gate/THE-66.*`, `output/entity-phase-2/book-review/THE-66*`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`; CLI Tester verify PASS
- [ ] Step 5: Comment Linear, mark THE-66 Done, update run-state to THE-67, and commit scoped changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/test/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 03:55Z | Setup | done | Read live child issue; branch created after THE-65 completion. |
| 03:57Z | Implementation | done | Added canonical notification repository schema, delivery attempts, fixture samples, and repository tests for all THE-66 notification types. |

## Files Touched
- `docs/plans/2026-06-24-045500-entity-phase-2-the-66-notification-inbox-schema-plan.md` - created - THE-66 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-66 plan.
- `packages/db/src/index.ts` - updated - canonical notification/inbox schema, delivery attempts, repository, and fixture samples.
- `packages/server/src/__tests__/db-repositories.test.ts` - updated - DB repository tests for canonical event/object links, separate delivery status, malformed records, and notification fixtures.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-66 scoped to canonical notification/inbox schema, repository helpers, fixtures, and tests.

## Done
- [ ] All steps complete
- [ ] Tests/build pass
- [ ] CLI Tester request/run/book-review/verify complete
- [ ] Linear THE-66 proof comment added and status moved to Done
- [ ] Run-state advanced to THE-67
