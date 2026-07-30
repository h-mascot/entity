# THE-859 / WP1-A-04 — Open Workplane action from task detail

**Decision:** IMPLEMENTED  
**Date:** 2026-07-30  
**Worktree:** `/Users/enterprise/Code/entity-the-859-wp1-a-04`  
**Depends on:** THE-858 / WP1-A-03 (Workplane route + shell)

## Purpose

Expose a clear **Open Workplane** action on Mission Control task detail that navigates to `/workplane/:taskId` using THE-857 URL-state helpers, serializing return context from the current task-detail surface.

## Modules

| Path | Role |
| --- | --- |
| `packages/app/src/lib/openWorkplaneFromTaskDetail.ts` | Href + return-context + navigate helpers |
| `packages/app/src/components/mission-control/TaskDetailPanel.tsx` | Header CTA (`data-testid="open-workplane-action"`) |
| `packages/app/src/App.tsx` | `workplaneRouteActive` so pushState remounts shell |

## Behavior

- CTA always visible in task detail header (not gated on task load failure).
- Default href: `/workplane/:taskId?return=detail&returnTask=:taskId&returnPath=/task/:taskId`
- Click uses history pushState + popstate (modifier-key clicks keep native anchor behavior).
- Existing Continue / follow-up / close / review / done flows unchanged.

## Non-goals honored

- No full return-to-board restoration (THE-860)
- No Workplane panel body implementations (WP1-B/C)
- No invented Engineering board data / prod DB mutation
