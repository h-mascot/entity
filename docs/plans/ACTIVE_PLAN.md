## Task
Entity Phase 2 THE-67: implement notification routing policy and delivery adapters.

**MC Task:** THE-67
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** DONE

## Context
Live Linear issue THE-67 is child issue THE-15.2 under THE-15 inbox and notifications. Scope is routing canonical notifications to configured delivery channels while preserving Entity inbox/activity as source of truth, recording external delivery failures, and avoiding secret leakage in delivery records.

## Dependencies
- [x] Current run-state points to THE-67.
- [x] THE-66 completed, verified, committed, and Linear Done.
- [x] Branch created from THE-66 completion commit: `THE-67-implement-notification-routing-policy-and-delivery-adapters`.
- [x] Existing notification repository, policy route projections, and channel fields inspected before implementation.

## Plan

- [x] Step 1: Add notification routing policy selection for urgency, risk, user preferences, and channel availability.
  - **Files:** server notification routing service/tests
  - **Verify:** unit tests assert ordered routes and policy reason chain
- [x] Step 2: Add mockable delivery adapter execution that creates canonical inbox notification first, then records external delivery attempts.
  - **Files:** server notification routing service/tests
  - **Verify:** success and failure adapter fixtures preserve notification and delivery status
- [x] Step 3: Sanitize delivery failure/log metadata so secrets/tokens are not persisted.
  - **Files:** server notification routing service/tests
  - **Verify:** tests assert sensitive values are redacted from failure/degraded records
- [x] Step 4: Run required proof commands, GitNexus detect-changes, and CLI Tester request/run/book-review/verify.
  - **Files:** `output/entity-phase-2/test-gate/THE-67.*`, `output/entity-phase-2/book-review/THE-67*`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`; CLI Tester verify PASS
- [x] Step 5: Comment Linear, mark THE-67 Done, update run-state to THE-68, and commit scoped changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/test/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 04:05Z | Setup | done | Read live child issue; branch created after THE-66 completion. |
| 04:07Z | Implementation | done | Added notification routing service with policy channel selection, mockable adapters, inbox-first delivery, failure/degraded records, and metadata redaction tests. |
| 04:12Z | Proof/close | done | Full proof, CLI Tester request/run/book-review/verify passed; Book packet locally approved under hard rule 22; Linear proof comment posted and status moved to Done; run-state advanced to THE-68. |

## Files Touched
- `docs/plans/2026-06-24-050500-entity-phase-2-the-67-notification-routing-policy-plan.md` - created - THE-67 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-67 plan.
- `packages/server/src/notification-routing.ts` - created - routing policy service and adapter execution.
- `packages/server/src/notification-routing.test.ts` - created - route selection, inbox-first, failure/degraded, and redaction tests.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-67 scoped to notification routing policy, delivery adapters/mocks, failure records, and secret-safe delivery metadata.

## Done
- [x] All steps complete
- [x] Tests/build pass
- [x] CLI Tester request/run/book-review/verify complete
- [x] Linear THE-67 proof comment added and status moved to Done
- [x] Run-state advanced to THE-68
