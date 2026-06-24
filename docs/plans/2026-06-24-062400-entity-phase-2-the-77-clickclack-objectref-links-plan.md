# Entity Phase 2 THE-77 Plan: ClickClack ObjectRef Links

Issue: THE-77
Branch: THE-77-link-clickclack-threads-channels-to-entity-objects-with-objectref
Status: IN PROGRESS

## Scope

Allow ClickClack-backed chat channels and threads to carry Entity-owned ObjectRef links to tasks, docs, artifacts, and projects without making chat the source of truth. Permission checks must run before rendering linked context, and links must survive degraded/unavailable ClickClack readiness because they are persisted as Entity-owned refs. Do not change chat primitives, add ClickClack admin behavior, or make Entity work state depend on ClickClack availability.

## Dependencies

- [x] THE-77 is confirmed as a child issue of THE-17.
- [x] THE-76 readiness contract is Done and current HEAD includes readiness states.
- [x] THE-6 Slice 0 dependency is satisfied by the verified completed queue/run-state receipts.
- [x] Full proof and CLI Tester gate must pass before Linear status changes.

## Plan

- [x] Step 1: Confirm Linear scope, dependency safety, clean HEAD, and create branch.
  - Files: `.cursor/run-state/entity-phase-2.json`, Linear THE-77/THE-17 bodies
  - Verify: `git status --short --branch`
- [x] Step 2: Persist ObjectRef links on chat channels and threads.
  - Files: `packages/db/src/chat.ts`
  - Verify: `cd packages/server && npx vitest run src/routes/chat-object-refs.test.ts`
- [x] Step 3: Add permission-filtered chat ObjectRef link routes.
  - Files: `packages/server/src/routes/chat.ts`
  - Verify: `cd packages/server && npx vitest run src/routes/chat-object-refs.test.ts`
- [x] Step 4: Add ObjectRef fixtures/tests for channel/thread links, permission denial/filtering, and degraded readiness independence.
  - Files: `packages/server/src/routes/chat-object-refs.test.ts`
  - Verify: `cd packages/server && npx vitest run src/routes/chat-object-refs.test.ts`
- [x] Step 5: Run proof commands and four-step CLI Tester gate.
  - Files: `output/entity-phase-2/test-gate/THE-77.*`, `output/entity-phase-2/book-review/THE-77*`
  - Verify: `bash scripts/proof/entity-phase-2-smoke.sh && npm run build && cd packages/server && npm run build && npx vitest run`
  - Verify: `project-test-gate request/run/book-review/verify THE-77`
- [ ] Step 6: Comment Linear, mark THE-77 Done if proof supports it, update run-state to THE-78, and commit scoped work.
  - Files: `.cursor/run-state/entity-phase-2.json`
  - Verify: `git status --short --branch`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-06-24T06:24Z | Step 1 | Done | Run-state currentIssue confirmed as THE-77; branch created from `96946c8`. |
| 2026-06-24T06:24Z | Step 2 | In progress | Existing ObjectRef normalization and chat repository located; implementation will add Entity-owned link columns/routes only. |
| 2026-06-24T06:27Z | Steps 2-4 | Done | Chat channel/thread ObjectRefs persist in Entity DB; routes require request org and filter inaccessible refs; focused tests pass. |
| 2026-06-24T06:29Z | Step 5 | Done | Full proof passed; CLI Tester run PASS, packet-mode Book review locally approved, verify PASS with no blockers; GitNexus high-risk hub contexts reviewed for `createChatRepository` and `registerChatRoutes`. |

## Files Touched

- `docs/plans/2026-06-24-062400-entity-phase-2-the-77-clickclack-objectref-links-plan.md` - created - compaction-survivable plan
- `docs/plans/ACTIVE_PLAN.md` - modified - mirrored active plan
- `packages/db/src/chat.ts` - modified - channel/thread linked ObjectRef persistence
- `packages/server/src/routes/chat.ts` - modified - permission-filtered ObjectRef routes
- `packages/server/src/routes/chat-object-refs.test.ts` - created - ObjectRef link and degraded readiness tests

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff`.
3. Continue from the first unchecked step.
4. Keep scope limited to ObjectRef links and permission-filtered route/service tests. Stop if implementation requires ClickClack admin controls, chat primitive ownership changes, or broad UI work.

## Done

- [ ] All steps complete
- [ ] Focused tests pass
- [ ] Full proof commands pass
- [ ] CLI Tester request/run/book-review/verify completed
- [ ] Linear proof comment posted and THE-77 marked Done if supported
