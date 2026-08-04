# THE-874 / WP1-C-06 — Enforce review gate: missing proof cannot present as review-ready

**Decision:** IMPLEMENTED  
**Date:** 2026-07-31  
**Worktree:** `/Users/enterprise/Code/entity-the-874-wp1-c-06`  
**Depends on:** THE-873 / WP1-C-05 (comments/review checklist); THE-866 / WP1-B-05 (missing-proof warnings)

## Purpose

Combine missing-proof warnings with the comments/review checklist so a Workplane cannot present as review-ready when proof/evidence is missing, degraded, or unavailable — even if the review decision is already `accepted`.

## Modules

| Path | Role |
| --- | --- |
| `packages/app/src/lib/workplaneReviewGate.ts` | Fail-closed `evaluateWorkplaneReviewGate` + stamp helper |
| `packages/app/src/lib/workplaneReviewGate.test.ts` | Negative gate + positive clear path + shell wiring |
| `packages/app/src/components/workplane/CommentsReviewChecklistPanel.tsx` | Renders gate banner; `data-review-ready` from gate |
| `packages/app/src/components/workplane/WorkplaneShell.tsx` | Evaluates gate; shell attrs + stamped panel load state |

## Gate rules

`reviewReady === true` only when all hold:

1. Missing-proof view status is `clear` with usable proof present
2. Comments/review load is `ready` with a bundle
3. Review decision is `accepted`
4. Comments/review stream is not degraded
5. Required human gate (if any) is approved/cleared

Any missing/degraded/unavailable/loading proof → `missingProofBlocks=true` and `reviewReady=false`.

## Non-goals

- No WP1-C-07 end-to-end proof pack
- No review write / human-gate mutation from Workplane
- No production promotion / secrets / Doc Hub rebuild
