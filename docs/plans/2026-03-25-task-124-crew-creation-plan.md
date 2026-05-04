# Crew Creation Plan

## Task
Implement CrewLink task #124 by adding crew persistence and API endpoints for creating and listing crews.

**MC Task:** #124  
**Created:** 2026-03-25  
**Agent:** Codex  
**Status:** VERIFICATION BLOCKED BY PRE-EXISTING SERVER TEST FAILURES

## Context
- Add a new `crews` table to the shared SQLite initialization in `packages/db/src/index.ts`.
- Expose `createCrew` and `getCrews` from the DB package.
- Add `POST /api/crews` and `GET /api/crews` in `packages/server/src/index.ts`.
- Per repo rules, any code in `packages/server/` requires colocated tests and a full `cd packages/server && npx vitest run` pass before completion.

## Dependencies
- [x] Step 1 has no dependencies
- [ ] Step 2 depends on Step 1 output in `packages/db/src/index.ts`
- [ ] Step 3 depends on Steps 1 and 2 outputs in `packages/db/src/index.ts` and `packages/server/src/index.ts`
- [ ] Step 4 depends on Steps 2 and 3 being implemented

## Plan

- [x] Step 1: Inspect existing DB repository patterns, route validation style, and current tests for similar create/list flows.
  - **Files:** `packages/db/src/index.ts`, `packages/server/src/index.ts`, related `*.test.ts`
  - **Verify:** `rg -n "app.post|app.get|createProject|getProjects|createRoadmap|getRoadmaps" packages/db packages/server --glob '!**/dist/**'`
- [x] Step 2: Add the `crews` table and exported DB accessors for creating and listing crews.
  - **Files:** `packages/db/src/index.ts`
  - **Verify:** `cd packages/server && npm run build`
- [x] Step 3: Add `POST /api/crews` and `GET /api/crews` with request validation and response wiring.
  - **Files:** `packages/server/src/index.ts`, `packages/server/src/crews-routes.ts`
  - **Verify:** `cd packages/server && npm run build`
- [ ] Step 4: Add/update colocated server tests covering crew creation and listing, then run the required server test gate.
  - **Files:** `packages/server/src/crews-routes.test.ts`, `packages/server/src/__tests__/db-repositories.test.ts`
  - **Verify:** `cd packages/server && npx vitest run`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 13:46 | Step 1 | ⏳ | Initial schema and route pattern inspection started |
| 18:12 | Step 1 | ✅ | Matched crews to the existing strategic repository and route-validation patterns. |
| 18:15 | Step 2 | ✅ | Added `crews` table plus DB accessors in `packages/db/src/index.ts`. |
| 18:15 | Step 3 | ✅ | Added `/crews` route registration via a small `crews-routes.ts` helper wired from `server/src/index.ts`. |
| 18:17 | Step 4 | ⚠️ | `packages/db` build, `packages/server` build, and targeted crew tests passed. Full `cd packages/server && npx vitest run` is still red in unrelated existing suites: `src/task-pagination.test.ts`, `src/plugins/routes.test.ts`, `src/__tests__/routes-docs.test.ts`, `src/__tests__/agent-api.test.ts`, and `src/swarm/routes.test.ts`. |

## Files Touched
- `docs/plans/2026-03-25-task-124-crew-creation-plan.md` — created — persistent execution plan for task #124
- `docs/plans/ACTIVE_PLAN.md` — modified — active pointer for compaction recovery
- `packages/db/src/index.ts` — modified — adds crew schema and exported create/list accessors
- `packages/db/dist/index.js` — modified — rebuilt DB package output consumed by existing server-side tests
- `packages/db/dist/index.d.ts` — modified — rebuilt DB package types
- `packages/server/src/index.ts` — modified — wires crew routes into the strategic route registration path
- `packages/server/src/crews-routes.ts` — created — dedicated GET/POST crew route registration helper
- `packages/server/src/crews-routes.test.ts` — created — colocated tests for crew route registration and validation
- `packages/server/src/__tests__/db-repositories.test.ts` — modified — covers crew create/list DB behavior

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to inspect current changes.
3. Read `docs/plans/ACTIVE_PLAN.md` to confirm it matches this plan.
4. Find the first unchecked step above.
5. Continue from there without redoing completed work.

## Done
- [ ] All steps complete
- [ ] Tests pass (if applicable)
- [ ] MC task moved to review
- [ ] ACTIVE_PLAN.md cleared or updated for next task
