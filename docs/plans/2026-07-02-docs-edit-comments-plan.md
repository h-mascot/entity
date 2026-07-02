## Task
Enable local-dev document editing and comments for source-backed workspace docs.

**MC Task:** #1879
**Created:** 2026-07-02
**Agent:** GPT-5.5
**Status:** COMPLETE

## Context
Workspace local sources are allowlisted at registration time but their local adapter still reports `write:false`, making Files-tab docs read-only. Comments need a Documents API bearer token; local dev should auto-provision a scoped fixed token only when API auth is open and the server is loopback-bound.

## Dependencies
- [x] Step 1 has no dependencies.
- [x] Step 2 depends on understanding editor auth token requirements.
- [x] Step 3 depends on Steps 1 and 2.
- [x] Step 4 depends on implementation and test updates.

## Plan

- [x] Step 1: Restore derived write capability for allowlisted local source roots.
  - **Files:** `packages/server/src/fs/source-root-guard.ts`, `packages/server/src/fs/adapters/local.ts`, `packages/server/src/fs/routes-sources.ts`
  - **Verify:** `cd packages/server && npx vitest run src/fs/adapters/local.test.ts src/fs/routes-sources.test.ts src/fs/routes-files.test.ts`
- [x] Step 2: Add local-dev Documents token provisioning and runtime exposure.
  - **Files:** `packages/server/src/editor/dev-token.ts`, `packages/server/src/editor/auth.ts`, `packages/server/src/routes/runtime.ts`, `packages/server/src/index.ts`
  - **Verify:** `cd packages/server && npx vitest run src/editor/dev-token.test.ts src/routes/runtime.test.ts`
- [x] Step 3: Auto-store dev Documents auth in the client when no token exists.
  - **Files:** `packages/app/src/config/runtime.ts`, `packages/app/src/App.tsx`
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 4: Run requested full gates.
  - **Files:** all touched files
  - **Verify:** `cd packages/server && npm run build && npx vitest run`; `npm --prefix packages/app run build`; `npm --prefix packages/app run test`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 20:16 | Step 1 | ⏳ | Reading capability and auth paths |
| 20:21 | Steps 1-3 | ✅ | Focused Vitest suite passed, 21/21 |
| 20:22 | Step 4 | ✅ | Requested server/app gates passed |

## Files Touched
- `docs/plans/2026-07-02-docs-edit-comments-plan.md` — created — compaction recovery plan.
- `docs/plans/ACTIVE_PLAN.md` — modified — active compaction recovery plan.

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and `git diff` to see current state.
3. Find the first unchecked step above.
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections.
5. Continue from there — do NOT redo completed steps.

## Done
- [x] All steps complete.
- [x] Tests pass.
- [x] User-requested no commit/push honored.
