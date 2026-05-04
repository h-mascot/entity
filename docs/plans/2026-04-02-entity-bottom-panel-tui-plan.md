# Task Plan — Entity Bottom-Panel TUI MVP

## Task
Replace only the bottom Activity Stream panel in Entity with a real embedded terminal/TUI backed by a server-side terminal bridge. Keep task recent activity, task detail activity, agent activity, and the mobile activity tab unchanged.

**MC Task:** #___  
**Created:** 2026-04-02  
**Agent:** Codex  
**Status:** COMPLETE

## Context
- User explicitly scoped this to the bottom panel only.
- User requested initial reads from `/home/henrymascot/clawd/docs/plans/ACTIVE_PLAN.md` and `/home/henrymascot/clawd/docs/plans/2026-04-02-entity-tui-spec.md`.
- In this environment, the Linux-style `/home/...` paths do not exist. The macOS mirror `/Users/henrymascot/clawd/docs/plans/ACTIVE_PLAN.md` exists, but contains no active plan, and the requested TUI spec file is not present there or elsewhere discoverable locally.
- Current bottom panel in `packages/app/src/App.tsx` is a placeholder that renders `TUI coming soon...`.
- Existing app/server WebSocket plumbing already exists and is the safest integration point for terminal streaming.
- `xterm.js` packages were installed locally into the app workspace during task setup.
- Repo has unrelated dirty changes. Do not revert unrelated files.

## Dependencies
- [x] Step 1 has no dependencies
- [x] Step 2 depends on Step 1 output (confirmed current integration points and constraints)
- [x] Step 3 depends on Step 2 output (server bridge contract available)
- [x] Step 4 depends on Steps 2 and 3 (feature implementation complete enough to verify)

## Plan

- [x] Step 1: Rehydrate state, inspect current bottom-panel integration, and lock task scope
  - **Files:** `packages/app/src/App.tsx`, `packages/app/src/components/ActivityStream.tsx`, `packages/server/src/index.ts`, `packages/app/src/hooks/useWebSocket.ts`
  - **Verify:** `rg -n "ActivityStream|activityPanelOpen|useWebSocket\\(" packages/app/src/App.tsx packages/app/src/components packages/app/src/hooks && sed -n '4860,4995p' packages/app/src/App.tsx`
- [x] Step 2: Implement server-side terminal bridge, routes, and tests for allowlisted targets and session lifecycle
  - **Files:** `packages/server/src/terminal.ts`, `packages/server/src/terminal.test.ts`, `packages/server/src/index.ts`
  - **Verify:** `cd packages/server && npx vitest run src/terminal.test.ts`
- [x] Step 3: Replace the bottom panel placeholder with an xterm.js terminal panel while leaving other activity surfaces untouched
  - **Files:** `packages/app/src/components/BottomTerminalPanel.tsx`, `packages/app/src/App.tsx`, `packages/app/src/index.css`, `packages/app/package.json`, `package-lock.json`
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 4: Run full requested verification for server code, update recovery files, and summarize blockers
  - **Files:** `docs/plans/ACTIVE_PLAN.md`, `docs/plans/2026-04-02-entity-bottom-panel-tui-plan.md`, `docs/plans/2026-04-02-entity-bottom-panel-tui-notes.md`
  - **Verify:** `cd packages/server && npm run build && npx vitest run && cd /Users/henrymascot/Code/entity && npm --prefix packages/app run build`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 12:16 | Step 1 | ✅ | Confirmed bottom panel is placeholder only; mobile activity tab still uses `ActivityStream`; existing WS infra can carry terminal events |
| 12:18 | Step 1 | ✅ | Requested TUI spec file was not present at the provided path or elsewhere discoverable locally; proceeding from user prompt scope |
| 12:24 | Step 1 | ✅ | Installed `@xterm/xterm` and `@xterm/addon-fit` into `packages/app` workspace successfully |
| 16:20 | Step 2 | ✅ | Added `packages/server/src/terminal.ts` bridge with allowlisted targets, HTTP routes, and WS message handling; focused terminal tests passed |
| 16:20 | Step 2 | ✅ | `cd packages/server && npm run build` passed after terminal module integration |
| 16:23 | Step 3 | ✅ | Added `BottomTerminalPanel` and replaced only the bottom placeholder in `App.tsx`; app production build passed |
| 16:23 | Step 4 | ✅ | Full server build passed; full Vitest run remains blocked by preexisting ABI mismatch, sandbox listen restrictions, and unrelated existing test drift |

## Files Touched
- `docs/plans/2026-04-02-entity-bottom-panel-tui-plan.md` — created — compaction-safe execution plan for the bottom-panel TUI task
- `docs/plans/ACTIVE_PLAN.md` — modified — points active recovery state at the current bottom-panel TUI task
- `docs/plans/2026-04-02-entity-bottom-panel-tui-notes.md` — created — implementation notes and blockers discovered during execution
- `packages/server/src/terminal.ts` — created — terminal target allowlist, session bridge, HTTP routes, and websocket event handling
- `packages/server/src/terminal.test.ts` — created — focused coverage for launch specs, websocket lifecycle, and route validation
- `packages/server/src/index.ts` — modified — registers the terminal bridge on HTTP and websocket startup
- `packages/app/src/components/BottomTerminalPanel.tsx` — created — bottom-panel xterm.js UI with target picker and session lifecycle
- `packages/app/src/App.tsx` — modified — replaces only the bottom placeholder panel with the new terminal panel
- `packages/app/src/index.css` — modified — xterm container styling aligned to Entity shell colors
- `packages/app/package.json` — modified — adds `@xterm/xterm` and `@xterm/addon-fit`
- `package-lock.json` — modified — lockfile update for xterm dependencies

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to inspect current repo state
3. Confirm the requested spec file is still absent before assuming missing context
4. Find the first unchecked step above
5. Continue from there without reworking already-completed checkpoints

## Done
- [x] All steps complete
- [ ] Tests pass (full `packages/server` Vitest suite still has preexisting environment and unrelated failures)
- [ ] MC task moved to review
- [x] ACTIVE_PLAN.md cleared or updated for next task
