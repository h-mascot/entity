# Chat Full QA And CTRL Plan

## Task
Make the Entity chat page pass full verification: `ctrl:full` must pass, every chat-page function must be browser-tested, and final evidence must include screenshots.

**MC Task:** not assigned
**Created:** 2026-05-03
**Agent:** Codex
**Status:** COMPLETE

## Context
The user requires every build to run `ctrl:full`, use Browser Use for UI testing, and show a screenshot of completed work. The chat page should behave like Discord-style channels and threads. The previous `ctrl:full` failure was caused by sandbox-blocked Tailscale/live checks; running outside the sandbox passed.

## Dependencies
- [x] `ctrl:full` can run outside the sandbox for live Tailscale HTTP/SSH checks
- [x] Local app is available at `http://localhost:5173/`
- [x] Local chat model API is reachable through the Vite proxy
- [x] Browser Use QA must cover sidebar, channels, model picker, sending, threads, and screenshots
- [x] Any found defects must be fixed before final verification

## Plan

- [x] Step 1: Run `ctrl:full` successfully
  - **Files:** none
  - **Verify:** `npm run ctrl:full`
- [x] Step 2: Test chat navigation and sidebar controls
  - **Files:** `packages/app/src/components/Chat/*` if fixes are needed
  - **Verify:** Browser Use screenshot and DOM evidence
- [x] Step 3: Test channel/category create, edit, delete, and collapse flows
  - **Files:** `packages/app/src/components/Chat/*`, `packages/app/src/lib/chat-store.ts` if fixes are needed
  - **Verify:** Browser Use interaction evidence
- [x] Step 4: Test agent/model picker, send messages, thread open/reply/close flows
  - **Files:** chat components/hooks/routes if fixes are needed
  - **Verify:** Browser Use interaction evidence
- [x] Step 5: Rerun verification and capture final screenshot
  - **Files:** any changed files
  - **Verify:** `npm run ctrl:full`, final Browser Use screenshot

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 09:58 | Step 1 | done | `ctrl:full` passed outside sandbox: live API 500 tasks, DB 526 tasks |
| 09:58 | Plan | in progress | Plan created before browser QA |
| 10:05 | Step 2/3 | done | Browser Use verified chat navigation, sidebar open/collapse, category collapse, channel create/edit/agents/delete dialogs |
| 10:13 | Step 4 | done | Browser Use verified OpenClaw + Hermes model lists, Book send, thread reply, reload, persisted thread reopen |
| 10:15 | Step 5 | done | Full server tests/build and `ctrl:full` passed; final screenshot captured at `/private/tmp/entity-chat-final.png` |

## Files Touched
- `docs/plans/2026-05-03-chat-full-qa-ctrl-plan.md` — created — QA/resume plan
- `docs/plans/ACTIVE_PLAN.md` — updated — active copy of this plan
- `packages/app/src/components/Chat/ChatSidebar.tsx` — updated — in-app channel/category dialogs and visible channel actions
- `packages/app/src/components/Chat/MessageBubble.tsx` — updated — visible thread entry/action for all parent messages
- `packages/app/src/components/Chat/ChatOfflineProvider.tsx` — updated — preserve server-persisted assistant message IDs
- `packages/server/src/routes/chat.ts` — updated — return persisted assistant message records from `/api/chat/send`
- `packages/server/src/routes/chat.test.ts` — created — regression coverage for persisted assistant reply IDs and thread count refresh

## Resume Instructions
1. Re-read this file fully.
2. Run `git status` and inspect chat diffs.
3. Continue from the first unchecked step.
4. Use Browser Use for UI evidence.
5. Do not report done unless `ctrl:full` passes and a screenshot is shown.

## Done
- [x] `ctrl:full` passed
- [x] Browser QA completed
- [x] Final screenshot shown
