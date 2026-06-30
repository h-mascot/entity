## Task
Fix `/api/fs/tree` closed database connection caused by stale file source repository binding.

**MC Task:** n/a
**Created:** 2026-06-30
**Agent:** GPT-5.5
**Status:** COMPLETE

## Context
User reports `curl -s "http://127.0.0.1:3000/api/fs/tree?sourceId=workspace&path="` hangs and logs `The database connection is not open` from `packages/db/src/file-sources.ts:290` via `packages/server/src/fs/routes-files.ts:105`. The server runs with config bootstrap and a configured DB path.

## Dependencies
- [x] Step 1 has no dependencies.
- [x] Step 2 depends on identifying repository construction order.
- [x] Step 3 depends on a minimal route/repository patch.
- [x] Step 4 depends on server restart with patched code.

## Plan

- [x] Step 1: Confirm runtime root cause and affected construction order.
  - **Files:** `packages/server/src/index.ts`, `packages/server/src/fs/routes-files.ts`, `packages/db/src/entity-db.ts`, `packages/server/src/config/runtime.ts`
  - **Verify:** `timeout 5 curl -sS "http://127.0.0.1:3000/api/fs/tree?sourceId=workspace&path="`
- [x] Step 2: Patch file routes to avoid a repository created before bootstrap DB path selection.
  - **Files:** `packages/server/src/fs/routes-files.ts`, possibly `packages/server/src/fs/index.ts`
  - **Verify:** `npm --prefix packages/server run build`
- [x] Step 3: Add/adjust colocated coverage for DB path switching or route dependency injection.
  - **Files:** `packages/server/src/fs/routes-files.test.ts`
  - **Verify:** `cd packages/server && npx vitest run src/fs/routes-files.test.ts`
- [x] Step 4: Verify provided repro and healthy document state endpoint on the local server.
  - **Files:** none
  - **Verify:** `timeout 10 curl -sS "http://127.0.0.1:3000/api/fs/tree?sourceId=workspace&path="` and document state curl

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 22:35 | Step 1 | ✅ | Found module-level `sourceRepo` constructed before bootstrap env can run. |
| 22:40 | Step 2 | ✅ | Moved file-route repository creation to registration time and passed the FS router repo. |
| 22:41 | Step 3 | ✅ | Added route regression coverage for DB path switching and missing-source response. |
| 22:43 | Step 4 | ✅ | Restarted tmux server; fs tree and document state endpoints returned HTTP 200. |

## Files Touched
- `docs/plans/2026-06-30-file-source-closed-db-plan.md` — created — completed resumable plan.
- `docs/plans/ACTIVE_PLAN.md` — updated — current active plan.
- `packages/server/src/fs/routes-files.ts` — modified — register-time repository creation with injectable dependency.
- `packages/server/src/fs/index.ts` — modified — passes the post-bootstrap source repository to file routes.
- `packages/server/src/fs/routes-files.test.ts` — created — regression coverage for DB path switching and missing source errors.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections.
5. Continue from there — do NOT redo completed steps.

## Done
- [x] All steps complete
- [x] Tests pass (if applicable)
- [ ] MC task moved to review
- [x] ACTIVE_PLAN.md cleared or updated for next task
