# Agent/User Profile Registry Plan

## Task
Harmonize agent avatars across Entity and move the hardcoded human name/avatar into user settings.

**MC Task:** n/a  
**Created:** 2026-05-03  
**Agent:** Codex  
**Status:** COMPLETE

## Context
Chat currently has a manual agent avatar map and hardcoded `Henry` labels. The app also derives agent avatars in several places from mixed API and fallback data. The desired behavior is one registry-backed source for agent avatars, plus user-controlled profile data for the human actor.

## Dependencies
- [x] Step 1 has no dependencies
- [x] Step 2 depends on locating current hardcoded avatar/name usage
- [x] Step 3 depends on central registry/profile helpers
- [x] Step 4 depends on UI edits compiling
- [x] Step 5 depends on local dev server and Browser Use

## Plan

- [x] Step 1: Map current avatar/name usage
  - **Files:** `packages/app/src`
  - **Verify:** `rg -n "avatar|Henry|AGENT_AVATARS" packages/app/src`
- [x] Step 2: Add shared registry/profile helpers
  - **Files:** `packages/app/src/lib/agentRegistry.ts`, `packages/app/src/lib/userProfile.ts`
  - **Verify:** `npm --prefix packages/app run build`
- [x] Step 3: Replace manual avatar/name usage in chat and agent surfaces
  - **Files:** `packages/app/src/components/Chat/MessageBubble.tsx`, `packages/app/src/App.tsx`, agent UI components as needed
  - **Verify:** Browser Use chat and agents UI checks
- [x] Step 4: Add user profile settings under Admin/General
  - **Files:** `packages/app/src/App.tsx`
  - **Verify:** Browser Use update profile name/avatar and confirm chat reflects it
- [x] Step 5: Run final gates and screenshot proof
  - **Files:** n/a
  - **Verify:** `npm run ctrl:full`

## Checkpoints
| Time | Step | Status | Notes |
|------|------|--------|-------|
| 13:05 | Step 1 | ✅ | Found manual chat avatar map and hardcoded Henry fallbacks |
| 13:22 | Step 2 | ✅ | Added registry avatar/name helpers and shared local user profile store |
| 13:34 | Step 3 | ✅ | Chat and agent surfaces now resolve agent avatars from the registry |
| 13:40 | Step 4 | ✅ | Admin User Profile page saves display name, handle, email, and avatar URL |
| 13:51 | Step 5 | ✅ | Browser Use UI path passed; `npm --prefix packages/app run build` and `npm run ctrl:full` passed |

## Files Touched
- `docs/plans/2026-05-03-agent-user-profile-registry-plan.md` — created — durable execution plan
- `docs/plans/ACTIVE_PLAN.md` — updated — resume pointer for this task
- `packages/app/src/lib/agentRegistry.ts` — updated — registry lookup and avatar/display helpers
- `packages/app/src/lib/userProfile.ts` — created — local user profile defaults, persistence, and hook
- `packages/app/src/components/Chat/MessageBubble.tsx` — updated — user profile avatar/name and registry-backed agent avatar/name
- `packages/app/src/App.tsx` — updated — Admin User Profile page and registry-first agent mapping
- `packages/app/src/components/AgentDashboardV2.tsx` — updated — registry-first agent avatar mapping
- `packages/app/src/hooks/useTaskBoard.ts` — updated — task action author uses user profile
- `packages/app/src/components/mission-control/MCCreateTaskModal.tsx` — updated — assignee label uses user profile
- `packages/app/src/components/mission-control/TaskDetailPanel.tsx` — updated — assignee/action author uses user profile
- `packages/app/src/components/mission-control/MCHeader.tsx` — updated — review filter label uses user profile
- `packages/app/src/components/UnifiedFileDashboard.tsx` — updated — file dashboard user label uses user profile

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
