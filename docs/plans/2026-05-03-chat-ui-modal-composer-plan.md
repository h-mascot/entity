# Chat UI Modal Composer Plan

## Task
Update Entity chat to match the compact Discord-style reference: icon-only thread actions and a single composer settings modal for agent/model controls.

**MC Task:** n/a  
**Created:** 2026-05-03  
**Agent:** Codex  
**Status:** COMPLETE

## Context
The current chat composer shows separate Agent and Model dropdowns above the textarea, and message bubbles show visible "Start thread" text. The requested UI keeps the main chat surface cleaner: a compact composer footer with a single routing pill that opens a modal for Agent, Model, Mode, Routing, Tools, and Memory controls.

## Dependencies
- [x] Step 1 has no dependencies
- [x] Step 2 depends on locating current chat controls
- [x] Step 3 depends on component edits compiling
- [x] Step 4 depends on local dev server and Browser Use
- [x] Step 5 depends on UI verification

## Plan

- [x] Step 1: Map current chat UI ownership
  - **Files:** `packages/app/src/components/Chat`
  - **Verify:** `rg -n "Start thread|Select chat agent|Select chat model|Message channel" packages/app/src/components/Chat`
- [x] Step 2: Replace visible thread text with an icon-only outline control
  - **Files:** `packages/app/src/components/Chat/MessageBubble.tsx`
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 3: Merge agent/model dropdowns into one composer settings modal
  - **Files:** `packages/app/src/components/Chat/MessageInput.tsx`
  - **Verify:** Browser Use opens modal and changes agent/model through UI
- [x] Step 4: Tighten channel/thread surfaces around the new composer
  - **Files:** `packages/app/src/components/Chat/ChannelView.tsx`, `packages/app/src/components/Chat/ThreadPanel.tsx`
  - **Verify:** Browser Use sends channel and thread messages after changes
- [x] Step 5: Run final gates and screenshot proof
  - **Files:** n/a
  - **Verify:** `npm run ctrl:full`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 13:58 | Step 1 | ✅ | `MessageBubble`, `MessageInput`, `ChannelView`, and `ThreadPanel` own the requested UI surfaces |
| 14:08 | Step 2 | ✅ | Removed visible "Start thread" label and replaced it with an outline reply icon |
| 14:15 | Step 3 | ✅ | Moved agent/model/mode controls into one composer settings modal |
| 14:19 | Step 4 | ✅ | Browser Use verified channel send, thread open, and thread reply button recovery |
| 14:23 | Step 5 | ✅ | `npm --prefix packages/app run build`, Browser Use proof, and `npm run ctrl:full` passed |

## Files Touched
- `docs/plans/ACTIVE_PLAN.md` — updated — resume pointer for this task
- `docs/plans/2026-05-03-chat-ui-modal-composer-plan.md` — created — durable execution plan
- `packages/app/src/components/Chat/MessageBubble.tsx` — modified — icon-only thread action
- `packages/app/src/components/Chat/MessageInput.tsx` — modified — compact composer and routing settings modal
- `packages/app/src/components/Chat/ThreadPanel.tsx` — modified — thread composer uses Reply label

## Resume Instructions
1. Re-read this file fully
2. Run `git status` and `git diff` to see current state
3. Find the first unchecked step above
4. If a step is partially done, check the "Files Touched" and "Checkpoints" sections
5. Continue from there — do NOT redo completed steps

## Done
- [x] All steps complete
- [x] Tests pass
- [x] Browser UI proof captured
