# Crew Moderators Plan

## Task
Add crew moderator persistence with owner/mod roles and expose moderator CRUD endpoints under `/api/crews/:name/moderators`.

**MC Task:** #___  
**Created:** 2026-03-25  
**Agent:** Codex  
**Status:** IN PROGRESS

## Context
- Add a new moderators table in `packages/db/src/index.ts` tied to crews.
- Expose DB CRUD helpers: `getModerators`, `addModerator`, and `removeModerator`.
- Add `GET`, `POST`, and `DELETE` moderator endpoints on crew routes used by `packages/server/src/index.ts`.
- Per repo rules, any change in `packages/server/` requires colocated tests plus `cd packages/server && npx vitest run`.
- The worktree already contains unrelated changes; do not revert them.

## Dependencies
- [x] Step 1 has no dependencies
- [ ] Step 2 depends on Step 1 output in `packages/db/src/index.ts`
- [ ] Step 3 depends on Step 2 output in `packages/db/src/index.ts`
- [ ] Step 4 depends on Steps 2 and 3 outputs
- [ ] Step 5 depends on Steps 3 and 4 being complete

## Plan

- [x] Step 1: Inspect existing crew repository, route registration, and current DB/server tests for strategic features.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/index.ts`, `packages/server/src/crews-routes.ts`, `packages/server/src/crews-routes.test.ts`, `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** `rg -n "createCrew|getCrews|registerCrewRoutes|Strategic Repository" packages/db packages/server --glob '!**/dist/**'`
- [x] Step 2: Add moderator schema, types, and exported DB CRUD helpers with owner/mod validation.
  - **Files:** `packages/db/src/index.ts`
  - **Verify:** `cd packages/server && npm run build`
- [x] Step 3: Extend crew route registration from `packages/server/src/index.ts` with moderator GET/POST/DELETE endpoints and request validation.
  - **Files:** `packages/server/src/crews-routes.ts`, `packages/server/src/index.ts`
  - **Verify:** `cd packages/server && npm run build`
- [x] Step 4: Add or update colocated tests for DB moderator CRUD and crew moderator route handling.
  - **Files:** `packages/server/src/crews-routes.test.ts`, `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** `cd packages/server && npx vitest run packages/server/src/crews-routes.test.ts packages/server/src/__tests__/db-repositories.test.ts`
- [x] Step 5: Run the full required server test gate and confirm the change is done.
  - **Files:** `packages/server/src`, `packages/db/src`
  - **Verify:** `cd packages/server && npx vitest run`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 18:34 | Step 1 | ✅ | Located existing crew schema, route helper, tests, and repo state. |
| 18:30 | Steps 2-5 | ✅ | Added moderator persistence and routes, rebuilt `packages/db`, fixed the server test gate, `npm run build` passed, and `cd packages/server && npx vitest run` passed (24 files / 209 tests). |

## Files Touched
- `docs/plans/2026-03-25-crew-moderators-plan.md` — created — persistent execution plan for crew moderator work
- `docs/plans/ACTIVE_PLAN.md` — modified — active plan for compaction recovery
- `packages/db/src/index.ts` — modified — crew moderator schema, DB helpers, and exports
- `packages/server/src/index.ts` — modified — registered crew moderator endpoints
- `packages/server/src/crews-routes.ts` — modified — crew moderator route handlers and validation
- `packages/server/src/crews-routes.test.ts` — modified — route coverage for crew moderator flows
- `packages/server/src/__tests__/db-repositories.test.ts` — modified — repository coverage for moderator CRUD
- `packages/server/src/task-pagination.test.ts` — modified — aligned default pagination expectation with implementation
- `packages/server/src/plugins/routes.ts` — modified — reject invalid plugin settings payloads
- `packages/server/src/routes/docs.ts` — modified — made docs roots portable across home directories
- `packages/server/src/__tests__/routes-docs.test.ts` — modified — use portable docs root path in test
- `packages/server/src/routes/agent-api.ts` — modified — backfilled schema columns and normalized presence status
- `packages/server/src/swarm/routes.test.ts` — modified — isolated swarm tests and removed slow auto-dispatch assumptions

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to inspect the current state.
3. Check `docs/plans/ACTIVE_PLAN.md` matches this task.
4. Find the first unchecked step in the plan.
5. Continue from there without redoing completed steps.

## Done
- [x] All steps complete
- [x] Tests pass (if applicable)
- [ ] MC task moved to review
- [ ] ACTIVE_PLAN.md cleared or updated for next task
