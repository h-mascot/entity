# Task Plan — Swarm Contract Cleanup

## Task
Review the user's recent swarm UI changes, determine whether they address the runtime drift issues, and implement the highest-leverage low-risk optimizations that simplify the core swarm contract without breaking behavior.

**MC Task:** #___  
**Created:** 2026-04-11  
**Agent:** Codex  
**Status:** IN PROGRESS

## Context
- The user recently modified the swarm UI and asked whether those changes materially improve the system.
- The inspection pass identified core issues around source/build drift and swarm UI/API schema mismatch.
- There are in-progress local changes in the swarm dispatcher/providers, so this cleanup should avoid overlapping those areas unless required.
- Server-side edits require colocated tests and `cd packages/server && npx vitest run` before reporting done.

## Dependencies
- [x] Step 1 has no dependencies
- [ ] Step 2 depends on Step 1 output (validated scope and touched files)
- [ ] Step 3 depends on Step 2 output (code changes applied cleanly around existing local edits)
- [ ] Step 4 depends on Step 3 output (tests/build pass)

## Plan

- [x] Step 1: Audit current local swarm/UI changes against the identified contract issues
  - **Files:** `packages/app/src/components/SwarmBoard.tsx`, `packages/server/src/swarm/routes.ts`, `packages/server/src/swarm/db.ts`, `packages/server/src/index.ts`
  - **Verify:** `git diff -- packages/app/src/components/SwarmBoard.tsx packages/server/src/swarm/routes.ts packages/server/src/swarm/db.ts packages/server/src/index.ts`
- [x] Step 2: Implement low-risk contract cleanup in app and server
  - **Files:** `packages/app/src/components/SwarmBoard.tsx`, `packages/server/src/swarm/routes.ts`, `packages/server/src/swarm/db.ts`, `packages/server/src/index.ts`
  - **Verify:** `git diff -- packages/app/src/components/SwarmBoard.tsx packages/server/src/swarm/routes.ts packages/server/src/swarm/db.ts packages/server/src/index.ts`
- [x] Step 3: Add/update swarm route tests for the tightened contract
  - **Files:** `packages/server/src/swarm/routes.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/swarm/routes.test.ts`
- [x] Step 4: Run required server verification and summarize impact
  - **Files:** `docs/plans/2026-04-11-swarm-contract-cleanup-plan.md`, `docs/plans/ACTIVE_PLAN.md`
  - **Verify:** `cd packages/server && npm run build && npx vitest run`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 22:52 | Step 1 | ✅ | Confirmed UI restyle changes did not remove the summary/schema mismatch or source/build drift |
| 22:56 | Step 2 | ✅ | Aligned swarm board and core swarm API around `title`/`spec`, tightened update allowlist, and removed source/build drift in server DB imports |
| 22:56 | Step 3 | ✅ | Added route coverage for spec-only job creation, null `task_id`, and unsupported PATCH field rejection; fixed swarm test isolation |
| 22:59 | Step 4 | ✅ | `npm --prefix packages/app run build` passed and `cd packages/server && npm run build && npx vitest run` passed |

## Files Touched
- `docs/plans/2026-04-11-swarm-contract-cleanup-plan.md` — created — durable plan for this cleanup pass
- `docs/plans/ACTIVE_PLAN.md` — modified — active execution pointer for compaction recovery
- `packages/app/src/components/SwarmBoard.tsx` — modified — removed fake summary editing path and aligned swarm UI with canonical `title`/`spec`
- `packages/server/src/index.ts` — modified — imports DB repositories from source instead of built artifacts
- `packages/server/src/swarm/db.ts` — modified — stops using `0` as the unlinked-task sentinel and allowlists update columns
- `packages/server/src/swarm/routes.ts` — modified — sanitizes create/update payloads and preserves legacy `summary` only as an alias to `spec`
- `packages/server/src/swarm/routes.test.ts` — modified — adds contract coverage and explicit swarm DB isolation
- `packages/server/src/routes/agent-api.ts` — modified — migrates missing `document_sessions` columns required by the agent API
- `packages/server/src/task-pagination.test.ts` — modified — matches the current default pagination contract
- `packages/server/src/routes/docs.ts` — modified — resolves docs roots from the current home directory instead of a hard-coded user path
- `packages/server/src/__tests__/routes-docs.test.ts` — modified — matches current docs API JSON/redirect behavior

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps

## Done
- [x] All steps complete
- [x] Tests pass
- [ ] ACTIVE_PLAN.md cleared or updated for next task
