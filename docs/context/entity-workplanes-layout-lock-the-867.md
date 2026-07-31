# THE-867 / WP1-B-06 — Lock Workplane layout (humans only)

**Decision:** IMPLEMENTED
**Date:** 2026-07-31
**Worktree:** `/Users/enterprise/Code/entity-the-867-wp1-b-06`
**Depends on:** THE-862 / WP1-B-01 Done; preserves WP1-B-03..05 panels already on branch base `f2fb604`

## Purpose

Enforce Q34: Workplanes v1 uses a canonical structured panel layout. Humans own panel navigation (active panel). Agents may later write content/proof/status into trusted panels, but must not reorder, hide, add custom layout panels, or override human-selected panel state.

## Modules

| Path | Role |
| --- | --- |
| `packages/app/src/lib/workplaneLayoutLock.ts` | Fail-closed layout lock contract |
| `packages/app/src/lib/workplaneLayoutLock.test.ts` | Positive human nav + negative agent mutation tests |
| `packages/app/src/lib/workplaneShellModel.ts` | Shell model always exposes locked canonical panels |
| `packages/app/src/components/workplane/WorkplaneShell.tsx` | DOM attrs + rejects `agentLayoutPayload` |

## Behavior

| Actor / attempt | Result |
| --- | --- |
| Human `set_active_panel` to canonical id | Accepted (navigation) |
| Human reorder / hide / add custom | Rejected — v1 layout is canonical |
| Agent reorder / hide / custom / set_active / replace | Rejected (`agent_layout_mutation_forbidden`) |
| Unknown actor | Rejected (fail-closed) |
| Agent payload smuggling `workplane_layout` / `panel_order` / `hidden_panels` / `custom_panels` / `active_panel` | Extracted + rejected; URL/human active panel preserved |

Canonical panel order (Q33):
`task_summary,proof_bundle,files_docs,activity_progress,comments_review_checklist,missing_proof_warnings`

## DOM contract

- `data-workplane-layout-locked="true"`
- `data-workplane-layout-version="v1"`
- `data-workplane-layout-owner="human"`
- `data-workplane-panel-order="<canonical>"`
- `data-workplane-layout-intact="true"`
- `data-workplane-agent-layout-rejected="true|false"`

## Non-goals honored

- No mobile viewport smoke (WP1-B-07 / THE-868)
- No ActivityEvents (WP1-C)
- No comments/review checklist / review-gate enforcement
- No plugin/custom widgets
- No DB migrations / production runtime changes
