# THE-860 / WP1-A-05 — Preserve return-to-board/detail navigation

**Decision:** IMPLEMENTED  
**Date:** 2026-07-30  
**Worktree:** `/Users/enterprise/Code/entity-the-860-wp1-a-05`  
**Depends on:** THE-859 / WP1-A-04 (Open Workplane CTA + return context serialization)

## Purpose

When a user opens a Workplane from task detail or board/list context, preserve enough return context for an obvious back/return action that restores the prior task detail or board path. Browser history/back and the explicit return control must not strand the user on the Workplane shell.

## Modules

| Path | Role |
| --- | --- |
| `packages/app/src/lib/workplaneReturnNavigation.ts` | Resolve destination + history.back vs navigate |
| `packages/app/src/lib/workplaneShellModel.ts` | Return view always exposes app-routable href/label |
| `packages/app/src/components/workplane/WorkplaneShell.tsx` | Always-visible return control |
| `packages/app/src/lib/openWorkplaneFromTaskDetail.ts` | Stash `returnHref` on workplane history state |
| `packages/app/src/App.tsx` | Restore tasks workspace + board tab from return history state |
| `TaskDetailPanel` / `TaskBoard` / `MCOpsView` / mobile | Pass `returnBoard` (mc board tab) into Open Workplane href |

## Behavior

- Detail launch → return href `/task/:id` (label: Return to task detail)
- Board/list launch (`/tasks` or `/` + returnBoard) → return href `/?tab=tasks` with board tab in history state
- Stored THE-857 `returnPath=/tasks` is coerced to `/?tab=tasks` at navigate time (App workspace route)
- Prefer `history.back()` when Workplane was opened via pushState (`history.state.mode === 'workplane'`)
- Else explicit navigate with `{ fromWorkplaneReturn: true, board?, taskId? }`
- Ready shell always shows a return control; absent URL return context falls back to `/task/:taskId`
- Invalid Workplane route also exposes Return to tasks

## Non-goals honored

- No THE-861 deep-link refresh beyond in-session history/navigation
- No full Workplane panel bodies
- No invented Engineering data / prod DB mutation
- No broad Mission Control redesign
