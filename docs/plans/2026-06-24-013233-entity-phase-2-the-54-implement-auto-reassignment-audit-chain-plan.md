## Task
Entity Phase 2 THE-54: implement Task Master auto-reassignment audit chain for stalled work.

**MC Task:** THE-54
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** VERIFIED - COMMIT/LINEAR HANDOFF PENDING

## Context
Live Linear issue THE-54 is child issue THE-12.4 under THE-12 Task Master routing. Scope is limited to auto-reassigning stalled tasks only when policy eligibility and exhausted thresholds permit it, resolving the new assignee to an individual principal, and preserving prior assignee, new assignee, escalation history, policy reason, actor, and final executor chain for receipts. THE-53 already implemented nudge and owner escalation.

## Dependencies
- [x] Current run-state points to THE-54.
- [x] THE-53 is complete and Linear Done.
- [x] Branch created from 0954512: `THE-54-implement-auto-reassignment-audit-chain`.
- [x] Existing Task Master routing, metadata, activity, and receipt paths inspected before implementation.
- [x] Tests pass before CLI Tester gate.

## Plan

- [x] Step 1: Inspect existing Task Master routing metadata, stale scan, activity summary, and receipt routing chain rendering.
  - **Files:** `packages/server/src/agent/events.ts`, `packages/server/src/activity-events.ts`, `packages/server/src/receipt-writer.ts`, `packages/db/src/index.ts`
  - **Verify:** `rg "auto_reassign|auto_reassigned|reassign|routing" packages/server/src packages/db/src`
- [x] Step 2: Implement scoped auto-reassignment eligibility and audit event behavior.
  - **Files:** likely `packages/server/src/agent/events.ts`, `packages/server/src/activity-events.ts`, maybe `packages/server/src/receipt-writer.ts`
  - **Verify:** targeted Vitest for changed server tests
- [x] Step 3: Add focused reassignment and receipt-chain tests.
  - **Files:** server colocated tests covering policy eligibility, individual assignee resolution, and receipt/audit chain
  - **Verify:** `cd packages/server && npx vitest run <changed tests>`
- [x] Step 4: Run required proof commands.
  - **Files:** no source edits expected
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`
- [x] Step 5: Run CLI Tester request/run/book-review/verify and apply packet-mode local approval only if scans are 0/0 and diff is issue-scoped.
  - **Files:** `output/entity-phase-2/test-gate/THE-54.*`, `output/entity-phase-2/book-review/THE-54*`
  - **Verify:** CLI Tester verify reports PASS and `nextChildBlocked=false`
- [ ] Step 6: Comment Linear, mark THE-54 Done, update run-state to THE-55, and commit only scoped source/test/plan changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/tests/docs plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 01:32Z | Setup | done | Read run-state and live child issue; branch created from THE-53 commit. |
| 01:36Z | Steps 1-3 | done | Added policy-gated auto-reassignment after prior nudge/escalation, structured audit details, and receipt-chain tests. |
| 01:40Z | Steps 4-5 | done | Smoke, root build, server build + full Vitest, CLI Tester run/book-review/verify passed under Node 22. |

## Files Touched
- `docs/plans/2026-06-24-013233-entity-phase-2-the-54-implement-auto-reassignment-audit-chain-plan.md` - created - THE-54 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-54 plan.
- `packages/server/src/agent/events.ts` - modified - auto-reassignment eligibility and audit metadata.
- `packages/server/src/agent/index.test.ts` - modified - reassignment success and guard tests.
- `packages/server/src/activity-events.ts` - modified - `auto_reassigned` ActivityEvent mapping with action details.
- `packages/server/src/activity-events.test.ts` - modified - Task Agent mapping test for `auto_reassigned`.
- `packages/server/src/receipt-writer.test.ts` - modified - receipt routing-chain proof.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-54 scoped to policy-eligible auto-reassignment and audit/receipt chain. Do not add routing UI.

## Done
- [ ] All steps complete
- [x] Tests pass
- [x] CLI Tester request/run/book-review/verify complete
- [ ] Linear THE-54 proof comment added and status moved to Done
- [ ] Run-state advanced to THE-55
