# THE-873 / WP1-C-05 — Workplane comments/review checklist panel

**Decision:** IMPLEMENTED  
**Date:** 2026-07-31  
**Worktree:** `/Users/enterprise/Code/entity-the-873-wp1-c-05`  
**Depends on:** THE-866 / WP1-B-05 (missing-proof warnings); reviewActions + task comments API

## Purpose

Render task comments and a review checklist in the Workplane `comments_review_checklist` panel using existing task truth and `reviewActions` semantics — no new task store.

## Module

| Path | Role |
| --- | --- |
| `packages/app/src/lib/workplaneCommentsReview.ts` | Normalize task + comments → checklist bundle + load envelope |
| `packages/app/src/components/workplane/CommentsReviewChecklistPanel.tsx` | Presentational panel |
| `packages/app/src/components/workplane/WorkplaneShell.tsx` | Loads and wires `comments_review_checklist` |

## Reused seams

- `normalizeReviewDecision` / `REVIEW_DECISION_LABELS` / `reviewActionToDecision` from `reviewActions.ts`
- `hasReviewMetadata` from `taskDetailWorkplaneSeams.ts`
- `buildReviewPacketSummary` (extracted packet summary)
- `GET /tasks/:id` + `GET /tasks/:id/comments`

## States

- **loading** / **empty** / **error** / **ready** load envelope
- Ready with empty comments is explicit (`No comments yet`)
- Comments unavailable → degraded warning; checklist still from task metadata
- `reviewReady` defaults `false` from the builder; THE-874 / WP1-C-06 stamps the real gate result

## Non-goals

- No review write/human-gate mutation from Workplane (stays on TaskDetailPanel)
- Missing-proof → review-ready gate lands in THE-874 / WP1-C-06
- No new task truth store / invented Engineering board rows
- No production promotion
