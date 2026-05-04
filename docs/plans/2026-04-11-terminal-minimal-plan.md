# Task Plan — Minimal Terminal Panel

## Task
Restore the missing bottom terminal panel source and restyle it to look more minimal, compact, and task-focused in the Mission Control surface.

**MC Task:** #___  
**Created:** 2026-04-11  
**Agent:** Codex  
**Status:** IN PROGRESS

## Context
- The user asked to load Entity context and simplify the terminal section shown in the workflow/tasks view.
- The current checked-in source does not contain the terminal panel, but git history and the live bundle confirm a `BottomTerminalPanel` component previously existed.
- The current `docs/plans/ACTIVE_PLAN.md` is already occupied by another task, so this task is tracked in this dated plan file to avoid clobbering that shared recovery pointer.
- This work touches both frontend and backend because the terminal UI depends on server terminal routes and WebSocket handling that are also absent from the current tree.

## Dependencies
- [x] Step 1 has no dependencies
- [ ] Step 2 depends on Step 1 output (terminal source files recovered from history)
- [ ] Step 3 depends on Step 2 output (minimal UI restyle implemented)
- [ ] Step 4 depends on Step 3 output (app/server verification passes)

## Plan

- [x] Step 1: Audit current source, live bundle, and git history to locate the missing terminal implementation
  - **Files:** `docs/context/entity-context.md`, `packages/app/src/App.tsx`, `packages/server/src/index.ts`, `docs/plans/2026-04-11-terminal-minimal-plan.md`
  - **Verify:** `git log --oneline --all -S'/api/terminal/sessions' -- packages/app/src packages/server/src`
- [x] Step 2: Restore the terminal component, app mount point, backend bridge/routes, and test coverage from git history into the current tree
  - **Files:** `packages/app/src/App.tsx`, `packages/app/src/components/BottomTerminalPanel.tsx`, `packages/app/src/index.css`, `packages/app/package.json`, `packages/server/src/index.ts`, `packages/server/src/terminal.ts`, `packages/server/src/terminal.test.ts`
  - **Verify:** `rg -n "BottomTerminalPanel|registerTerminalRoutes|createTerminalBridge" packages/app/src packages/server/src`
- [x] Step 3: Reduce terminal chrome and spacing for a more minimal presentation while keeping the essential controls visible
  - **Files:** `packages/app/src/components/BottomTerminalPanel.tsx`, `packages/app/src/index.css`
  - **Verify:** `git diff -- packages/app/src/App.tsx packages/app/src/components/BottomTerminalPanel.tsx packages/app/src/index.css packages/app/package.json packages/server/src/index.ts packages/server/src/terminal.ts packages/server/src/terminal.test.ts`
- [x] Step 4: Install any missing deps and run relevant verification for both app and server
  - **Files:** `package-lock.json`
  - **Verify:** `npm --prefix packages/app run build && cd packages/server && npm run build && npx vitest run src/terminal.test.ts`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 23:57 | Step 1 | ✅ | Confirmed the terminal source exists in git history (`7ea0c3b`, `9db4b80`) and is missing from the current tree |
| 00:00 | Step 2 | ✅ | Restored the app terminal component, backend bridge/routes, and terminal server tests from git history into the current source tree |
| 00:02 | Step 3 | ✅ | Reduced control-bar chrome, removed extra banner spacing, tightened xterm line density, and simplified the terminal shell styling |
| 00:03 | Step 4 | ✅ | `npm install`, `npm --prefix packages/app run build`, `npm --prefix packages/server run build`, and `cd packages/server && npx vitest run` all passed |

## Files Touched
- `docs/plans/2026-04-11-terminal-minimal-plan.md` — created — durable plan for restoring and restyling the terminal panel
- `package-lock.json` — modified — added xterm dependencies to the workspace lockfile
- `packages/app/package.json` — modified — added xterm dependencies for the terminal UI
- `packages/app/src/App.tsx` — modified — mounted the bottom terminal panel in place of the placeholder activity strip
- `packages/app/src/components/BottomTerminalPanel.tsx` — created — restored and restyled the terminal UI with a more compact shell
- `packages/app/src/index.css` — modified — added compact terminal shell and xterm styling
- `packages/server/src/index.ts` — modified — registered terminal routes and terminal WebSocket handling
- `packages/server/src/terminal.ts` — created — restored terminal bridge/session management and API routes
- `packages/server/src/terminal.test.ts` — created — restored test coverage for terminal launch, bridge, and route behavior

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps

## Done
- [x] All steps complete
- [x] App build passes
- [x] Server build passes
- [x] Targeted tests pass
