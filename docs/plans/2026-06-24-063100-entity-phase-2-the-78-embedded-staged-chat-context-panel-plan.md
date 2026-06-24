# Entity Phase 2 THE-78 Plan: Embedded/Staged Chat Context Panel

Issue: THE-78
Branch: THE-78-build-embedded-staged-chat-context-panel
Status: IN PROGRESS

## Scope

Render an embedded ClickClack chat context panel near Entity work objects, starting with the task detail surface. The panel must show live/staged/degraded/unavailable readiness, keep task/doc/proof links canonical Entity links, and make unavailable chat visible without hiding proof/review/docs. Do not change ClickClack primitives, add deep chat administration, or make task/docs/proof/review state depend on chat readiness.

## Dependencies

- [x] THE-78 is confirmed as a child issue of THE-17.
- [x] THE-76 readiness contract is Done and current HEAD exposes readiness.
- [x] THE-77 ObjectRef links are Done and current HEAD exposes permission-filtered chat ObjectRef routes.
- [x] THE-6 Slice 0 dependency is satisfied by the verified completed queue/run-state receipts.
- [x] Browser/DOM proof, full proof, and CLI Tester gate must pass before Linear status changes.

## Plan

- [x] Step 1: Confirm Linear scope, dependency safety, clean HEAD, and create branch.
  - Files: `.cursor/run-state/entity-phase-2.json`, Linear THE-78/THE-17 bodies
  - Verify: `git status --short --branch`
- [x] Step 2: Add a task-level embedded chat context component.
  - Files: `packages/app/src/components/mission-control/TaskChatContextPanel.tsx`
  - Verify: `npm run build`
- [x] Step 3: Mount the panel in task detail without hiding proof/review/docs.
  - Files: `packages/app/src/components/mission-control/TaskDetailPanel.tsx`
  - Verify: browser DOM proof includes panel plus receipt/proof area under unavailable readiness.
- [x] Step 4: Add server/UI support fixtures only if needed for ObjectRef/readiness rendering.
  - Files: `packages/app/src/lib/chat-store.ts`, `packages/server/src/routes/chat-object-refs.test.ts` if needed
  - Verify: focused build/test command for touched area
- [x] Step 5: Run browser/DOM proof, full proof commands, and four-step CLI Tester gate.
  - Files: `output/entity-phase-2/browser-proof/THE-78-*`, `output/entity-phase-2/test-gate/THE-78.*`, `output/entity-phase-2/book-review/THE-78*`
  - Verify: `bash scripts/proof/entity-phase-2-smoke.sh && npm run build && cd packages/server && npm run build && npx vitest run`
  - Verify: `project-test-gate request/run/book-review/verify THE-78`
- [ ] Step 6: Comment Linear, mark THE-78 Done if proof supports it, update run-state to THE-79, and commit scoped work.
  - Files: `.cursor/run-state/entity-phase-2.json`
  - Verify: `git status --short --branch`

## Checkpoints

| Time | Step | Status | Notes |
|------|------|--------|-------|
| 2026-06-24T06:31Z | Step 1 | Done | Run-state currentIssue confirmed as THE-78; branch created from `e2c995c`. |
| 2026-06-24T06:31Z | Step 2 | In progress | Existing task detail proof/docs sections and chat readiness/ObjectRef APIs located. |
| 2026-06-24T06:34Z | Steps 2-4 | Done | Embedded task chat context panel added and mounted; workspace build passes with proof/docs sections preserved. |
| 2026-06-24T06:36Z | Step 5 | Done | Browser DOM/screenshot proof passed for unavailable readiness; full proof passed; CLI Tester run PASS, packet-mode Book review locally approved, verify PASS with no blockers; GitNexus low risk. |

## Files Touched

- `docs/plans/2026-06-24-063100-entity-phase-2-the-78-embedded-staged-chat-context-panel-plan.md` - created - compaction-survivable plan
- `docs/plans/ACTIVE_PLAN.md` - modified - mirrored active plan
- `packages/app/src/components/mission-control/TaskChatContextPanel.tsx` - created - embedded readiness/chat context panel
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` - modified - mounted panel in task detail

## Resume Instructions

1. Re-read this file fully.
2. Run `git status` and `git diff`.
3. Continue from the first unchecked step.
4. Keep scope limited to a task-detail embedded chat context panel and proof. Stop if implementation requires ClickClack admin/configuration controls or broad chat primitive changes.

## Done

- [ ] All steps complete
- [ ] Browser/DOM proof passes
- [ ] Focused/full tests pass
- [ ] CLI Tester request/run/book-review/verify completed
- [ ] Linear proof comment posted and THE-78 marked Done if supported
