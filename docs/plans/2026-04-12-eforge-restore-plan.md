## Task
Restore the missing Swarm x eforge integration in Entity and verify it end to end.

**MC Task:** #___  
**Created:** 2026-04-12  
**Agent:** Codex  
**Status:** IN PROGRESS

## Context
- Source of truth is `/Users/enterprise/Code/entity`.
- Must restore user-visible Swarm x eforge integration, not replace Swarm.
- Must verify code, API, UI, and an actual dispatch path before calling it done.
- After any `packages/server/` changes, run `cd packages/server && npx vitest run`.
- Related spec: `docs/context/eforge-restore-agent-spec.md`

## Dependencies
- [x] Step 1 has no dependencies
- [ ] Step 2 depends on current Swarm/eforge implementation audit from Step 1
- [ ] Step 3 depends on source changes from Step 2
- [ ] Step 4 depends on successful local runtime from Step 3
- [ ] Step 5 depends on verification evidence from Step 4

## Plan

- [x] Step 1: Audit current Swarm, provider, and UI implementation against the restore spec.
  - **Files:** `packages/app/src/components/SwarmBoard.tsx`, `packages/server/src/swarm/routes.ts`, `packages/server/src/swarm/dispatcher.ts`, `packages/server/src/swarm/providers/eforge.ts`, `packages/server/src/swarm/providers/eforge-queue.ts`
  - **Verify:** `rg -n "eforge|provider|spec|dispatch" packages/app/src/components/SwarmBoard.tsx packages/server/src/swarm`
- [x] Step 2: Implement missing backend and frontend restore pieces for status, monitor visibility, and editable spec flow.
  - **Files:** `packages/server/src/swarm/routes.ts`, `packages/server/src/swarm/dispatcher.ts`, `packages/server/src/swarm/providers/eforge.ts`, `packages/server/src/swarm/providers/eforge-queue.ts`, `packages/app/src/components/SwarmBoard.tsx`
  - **Verify:** `npm --prefix packages/app run build && npm --prefix packages/server run build`
- [x] Step 3: Add or update colocated server tests covering eforge status/spec/dispatch behavior.
  - **Files:** `packages/server/src/swarm/*.test.ts`
  - **Verify:** `cd packages/server && npx vitest run`
- [ ] Step 4: Run live API and browser verification, including an actual queue dispatch path.
  - **Files:** `artifacts/*`, runtime config files only if needed
  - **Verify:** `curl` API checks plus browser/runtime proof
- [ ] Step 5: Capture evidence, summarize remaining gaps, and prepare git state.
  - **Files:** `artifacts/*`, `docs/context/eforge-restore-agent-spec.md`, `docs/plans/ACTIVE_PLAN.md`
  - **Verify:** `git status --short`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 02:54 | Step 0 | ✅ | Loaded restore spec and created execution plan |
| 04:18 | Step 1 | ✅ | Audited current Swarm board, dispatcher, and eforge provider against restore spec |
| 04:22 | Step 2 | ✅ | Restored eforge status API, spec-edit dispatch flow, and provider-specific Swarm UI |
| 04:23 | Step 3 | ✅ | Added route tests for eforge status and queue dispatch; frontend and server builds passed |
| 04:25 | Step 4 | ⏸️ | Live API/browser verification paused to follow GitHub-first deploy flow |

## Files Touched
- `docs/plans/2026-04-12-eforge-restore-plan.md` — created — durable execution plan for this task
- `docs/plans/ACTIVE_PLAN.md` — modified — active copy of current plan
- `packages/app/src/components/SwarmBoard.tsx` — modified — restored prep/edit/dispatch flow and eforge-specific UI
- `packages/server/src/swarm/providers/interface.ts` — modified — provider dispatch result can preserve queue-mode job state
- `packages/server/src/swarm/providers/eforge.ts` — modified — dynamic env config, eforge status payload, queue-aware dispatch
- `packages/server/src/swarm/providers/symphony.ts` — modified — preserves queued state for pull-based dispatch
- `packages/server/src/swarm/dispatcher.ts` — modified — respects provider-selected post-dispatch status
- `packages/server/src/swarm/routes.ts` — modified — exposes `/api/swarm/providers/eforge/status`
- `packages/server/src/swarm/routes.test.ts` — modified — covers eforge status route and saved-spec queue dispatch

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Open `docs/plans/ACTIVE_PLAN.md`
4. Find the first unchecked step above
5. Continue from there and do not redo completed steps

## Done
- [ ] All steps complete
- [ ] Tests pass (if applicable)
- [ ] MC task moved to review
- [ ] ACTIVE_PLAN.md cleared or updated for next task
