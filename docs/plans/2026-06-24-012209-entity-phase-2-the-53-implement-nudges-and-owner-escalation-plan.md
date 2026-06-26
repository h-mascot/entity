## Task
Entity Phase 2 THE-53: implement Task Master nudges and owner escalation for assigned stalled work.

**MC Task:** THE-53
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** VERIFIED - COMMIT/LINEAR HANDOFF PENDING

## Context
Live Linear issue THE-53 is child issue THE-12.3 under THE-12 Task Master routing. Scope is limited to assigned stalled tasks: nudge the assignee before escalation, escalate to the owner after policy thresholds, and record degraded notification channel failure. THE-54 owns auto-reassignment and must not be included here.

## Dependencies
- [x] Current run-state points to THE-53.
- [x] THE-51 and THE-52 are complete; THE-53 is dependency-safe.
- [x] Branch created from 06072b8: `THE-53-implement-nudges-and-owner-escalation`.
- [x] Existing Task Master routing/activity patterns inspected before implementation.
- [x] Tests pass before CLI Tester gate.

## Plan

- [x] Step 1: Inspect existing stale-scan, activity, and policy projection paths.
  - **Files:** `packages/server/src/agent/index.ts`, `packages/server/src/activity-events.ts`, `packages/db/src/index.ts`
  - **Verify:** `rg "stale_scan|nudge_sent|owner_escalated|notification_routed" packages/server/src packages/db/src`
- [x] Step 2: Implement scoped nudge/escalation service behavior for assigned stalled tasks.
  - **Files:** likely `packages/server/src/agent/index.ts`, possibly a focused helper/test file
  - **Verify:** targeted Vitest for changed server tests
- [x] Step 3: Add focused success and degraded tests.
  - **Files:** server colocated tests covering nudge-before-escalation and notification failure degraded record
  - **Verify:** `cd packages/server && npx vitest run <changed tests>`
- [x] Step 4: Run required proof commands.
  - **Files:** no source edits expected
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`
- [x] Step 5: Run CLI Tester request/run/book-review/verify and apply packet-mode local approval only if scans are 0/0 and diff is issue-scoped.
  - **Files:** `output/entity-phase-2/test-gate/THE-53.*`, `output/entity-phase-2/book-review/THE-53*`
  - **Verify:** CLI Tester verify reports PASS and `nextChildBlocked=false`
- [ ] Step 6: Comment Linear, mark THE-53 Done, update run-state to THE-54, and commit only scoped source/test/plan changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/tests/docs plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 01:22Z | Setup | done | Read run-state, child issue, parent epic; branch created. |
| 01:26Z | Steps 1-3 | done | Added first-pass nudge, owner escalation after prior nudge, degraded notification failure recording, and focused tests. |
| 01:31Z | Steps 4-5 | done | Smoke, root build, server build + full Vitest, CLI Tester run/book-review/verify passed under Node 22. |

## Files Touched
- `docs/plans/2026-06-24-012209-entity-phase-2-the-53-implement-nudges-and-owner-escalation-plan.md` - created - THE-53 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-53 plan.
- `packages/server/src/agent/events.ts` - modified - stale nudge, owner escalation, and notification failure handling.
- `packages/server/src/agent/index.test.ts` - modified - Task Agent nudge/escalation/degraded notification tests.
- `packages/server/src/activity-events.ts` - modified - canonical mappings and warning preservation for degraded notification events.
- `packages/server/src/activity-events.test.ts` - modified - degraded notification envelope test.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-53 scoped to nudges, owner escalation, and degraded notification failure recording. Do not implement auto-reassignment.

## Done
- [ ] All steps complete
- [x] Tests pass
- [x] CLI Tester request/run/book-review/verify complete
- [ ] Linear THE-53 proof comment added and status moved to Done
- [ ] Run-state advanced to THE-54
