## Task
Entity Phase 2 THE-69: build inbox and notification UI.

**MC Task:** THE-69
**Created:** 2026-06-24
**Agent:** Cursor
**Status:** IN PROGRESS

## Context
Live Linear issue THE-69 is child issue THE-15.4 under THE-15 inbox and notifications. Scope is UI for canonical notification records and delivery routes: distinguish Entity inbox state from external delivery state, show failed/degraded deliveries, policy reasons, object refs, and deep links.

## Dependencies
- [x] Current run-state points to THE-69.
- [x] THE-66 notification schema and THE-67 routing service are complete.
- [x] THE-68 owner accountability inbox is complete.
- [x] Branch created from THE-68 closeout commit: `THE-69-build-inbox-and-notification-ui`.
- [x] Existing toast notification panel and canonical notification repository inspected.

## Plan

- [x] Step 1: Add read/update notification inbox API routes backed by the canonical notification repository.
  - **Files:** server route module/tests and server mount
  - **Verify:** tests list notifications for a recipient, include delivery attempts, and update inbox state
- [x] Step 2: Add app hook/types for canonical Entity notifications.
  - **Files:** app hook/lib types
  - **Verify:** app build covers payload normalization
- [x] Step 3: Extend the notification panel to render Entity inbox records with delivery failures/degraded state, policy reasons, object refs, and deep links.
  - **Files:** notification panel/App wiring
  - **Verify:** DOM selectors for canonical state, delivery state, policy reason, and object ref
- [x] Step 4: Run focused proof, DOM/browser proof artifact, GitNexus, and CLI Tester request/run/book-review/verify.
  - **Files:** `output/entity-phase-2/test-gate/THE-69.*`, `output/entity-phase-2/book-review/THE-69*`, browser proof under `output/entity-phase-2/browser-proof/`
  - **Verify:** `bash scripts/proof/entity-phase-2-smoke.sh`; `npm run build`; `cd packages/server && npm run build && npx vitest run`; CLI Tester verify PASS
- [ ] Step 5: Comment Linear, mark THE-69 Done, update run-state to THE-70, and commit scoped changes.
  - **Files:** `.cursor/run-state/entity-phase-2.json` local state only, source/test/plan for commit as appropriate
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 04:27Z | Setup | done | Read live child issue; branch created after THE-68 completion. |
| 04:31Z | Steps 1-3 | done | Added notification routes/tests, app hook, panel rendering for canonical state/delivery state/policy/object refs, and DOM proof artifact. |
| 04:36Z | Proof | done | Full proof commands passed; CLI Tester request/run/book-review/verify passed with hard rule 22 local Book approval. |

## Files Touched
- `docs/plans/2026-06-24-052700-entity-phase-2-the-69-notification-inbox-ui-plan.md` - created - THE-69 execution plan.
- `docs/plans/ACTIVE_PLAN.md` - mirrored - active THE-69 plan.
- `packages/server/src/routes/notifications.ts` - created - canonical notification inbox API routes.
- `packages/server/src/routes/notifications.test.ts` - created - notification list/update and failed/degraded delivery tests.
- `packages/server/src/index.ts` - updated - notification route mounts.
- `packages/app/src/hooks/useEntityNotifications.ts` - created - canonical notification fetch/update hook.
- `packages/app/src/components/NotificationHistoryPanel.tsx` - updated - Entity inbox records and delivery state UI.
- `packages/app/src/App.tsx` - updated - hook wiring and unread count badge.
- `output/entity-phase-2/browser-proof/THE-69-dom-proof.json` - created - DOM/failed-channel proof artifact.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. Continue from the first unchecked step; do not redo completed work.
5. Keep THE-69 scoped to canonical notification inbox API/UI, delivery states, policy reasons, object refs, and proof.

## Done
- [ ] All steps complete
- [ ] Tests/build pass
- [ ] CLI Tester request/run/book-review/verify complete
- [ ] Linear THE-69 proof comment added and status moved to Done
- [ ] Run-state advanced to THE-70
