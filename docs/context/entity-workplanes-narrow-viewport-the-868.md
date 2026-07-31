# THE-868 / WP1-B-07 — Narrow/mobile viewport smoke for Workplane panels

**Decision:** IMPLEMENTED
**Date:** 2026-07-31
**Worktree:** `/Users/enterprise/Code/entity-the-868-wp1-b-07`
**Depends on:** THE-864 / WP1-B-03, THE-865 / WP1-B-04, THE-866 / WP1-B-05; preserves THE-867 / WP1-B-06 layout lock on branch base `420f31a`

## Purpose

Keep Workplanes Slice 1 panels usable and visually sane at phone/narrow widths. Document horizontal overflow is forbidden; THE-867 layout lock and human panel navigation must not regress.

## Modules

| Path | Role |
| --- | --- |
| `packages/app/src/lib/workplaneNarrowViewport.ts` | Breakpoints, overflow helpers, DOM/CSS class contract |
| `packages/app/src/lib/workplaneNarrowViewport.test.ts` | Focused narrow/mobile DOM + negative layout-lock tests |
| `packages/app/src/components/workplane/WorkplaneShell.tsx` | Narrow-ready attrs + CSS hook classes |
| `packages/app/src/index.css` | Compact header/nav/body rules at ≤720px / ≤390px |

## Breakpoints

| Band | Width |
| --- | --- |
| mobile | ≤ 390px |
| narrow | ≤ 720px |
| desktop | > 720px |

## DOM contract

- `data-workplane-narrow-ready="true"`
- `data-workplane-viewport-smoke="WP1-B-07"`
- `data-workplane-overflow-policy="no_document_horizontal_overflow"`
- Layout-lock attrs from THE-867 remain required

## Non-goals honored

- No ActivityEvents (WP1-C)
- No comments/review checklist behavior / review-gate enforcement
- No plugin/custom widgets / DB migrations / server changes
- No production runtime changes
