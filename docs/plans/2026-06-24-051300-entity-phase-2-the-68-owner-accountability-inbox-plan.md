## Task
Entity Phase 2 THE-68: build owner accountability inbox and escalation queues.

**MC Task:** THE-68
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** IN PROGRESS

## Context
Live Linear issue THE-68 is child issue THE-15.3 under THE-15 inbox and notifications. Scope is a canonical owner view of accountable tasks across stalled, escalated, review-blocked, gate-pending, receipt-failed, and migration-warning states, with deep links to Entity tasks.

## Dependencies
- [x] Current run-state points to THE-68.
- [x] THE-67 completed, verified, committed, and Linear Done.
- [x] Branch created from THE-67 completion commit: `THE-68-build-owner-accountability-inbox-and-escalation-queues`.
- [x] Existing task accountability helpers, task routes, and Mission Control task UI inspected before implementation.

## Plan

- [x] Step 1: Add owner accountability query/grouping logic across stalled, escalated, review/gate, receipt failure, and migration warning states.
  - **Files:** server task accountability helper/tests
  - **Verify:** tests assert each group and canonical task deep links
- [x] Step 2: Expose read-only owner inbox task API query.
  - **Files:** server task route
  - **Verify:** query helper and route build from canonical task records
- [x] Step 3: Add visible Mission Control owner inbox summary with grouped state chips and canonical task links.
  - **Files:** app task board/Mission Control UI
  - **Verify:** app build and DOM proof show grouped states
- [x] Step 4: Run required proof commands, browser/DOM proof, GitNexus detect-changes, and CLI Tester request/run/book-review/verify.
  - **Files:** `output/entity-phase-2/test-gate/THE-68.*`, `output/entity-phase-2/book-review/THE-68*`, browser proof under `output/entity-phase-2/browser-proof/`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`; CLI Tester verify PASS
- [ ] Step 5: Comment Linear, mark THE-68 Done, update run-state to THE-69, and commit scoped changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/test/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 04:13Z | Setup | done | Read live child issue; branch created after THE-67 completion. |
| 04:16Z | Implementation | done | Added owner accountability grouping, read-only owner inbox route, Mission Control summary panel, and focused server tests. |
| 04:18Z | DOM proof | done | App/server focused builds passed; DOM proof artifact records grouped queue selectors and browser automation blocker. |
| 04:24Z | Proof | done | Full proof commands passed; CLI Tester request/run/book-review/verify passed with hard rule 22 local Book approval. |

## Files Touched
- `docs/plans/2026-06-24-051300-entity-phase-2-the-68-owner-accountability-inbox-plan.md` - created - THE-68 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-68 plan.
- `packages/server/src/task-accountability.ts` - updated - owner inbox grouping and canonical deep links.
- `packages/server/src/task-accountability.test.ts` - updated - grouped owner inbox query tests.
- `packages/server/src/index.ts` - updated - owner inbox task API route.
- `packages/app/src/hooks/useTaskBoard.ts` - updated - review/gate task fields.
- `packages/app/src/components/mission-control/MCOpsView.tsx` - updated - owner accountability inbox summary.
- `output/entity-phase-2/browser-proof/THE-68-dom-proof.json` - created - DOM proof artifact.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-68 scoped to owner accountability inbox queries, grouped state visibility, canonical task links, and DOM proof.

## Done
- [ ] All steps complete
- [ ] Tests/build pass
- [ ] CLI Tester request/run/book-review/verify complete
- [ ] Linear THE-68 proof comment added and status moved to Done
- [ ] Run-state advanced to THE-69
