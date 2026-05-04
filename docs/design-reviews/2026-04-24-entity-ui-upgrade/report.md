# Entity UI Upgrade Design Review

## Summary

This artifact pack captures the current Entity desktop UI and two `gpt-image-2` redesign concept sets for the requested views:

- First level: Files, Agents, Tasks, Services, Chat, Admin
- Second level: Docs View, Agent Detail View, Task Detail View

Entity should stay a dense operational command surface. The winning direction is not a prettier dashboard; it is a more disciplined shell with clearer view ownership, stronger operational state, and less repeated chrome.

## Artifact Coverage

| Group | Count | Status |
| --- | ---: | --- |
| Actual screenshots | 9 | Complete, `1440x1000` |
| Set 1, Polished Evolution | 9 | Complete, `1536x1024`, `gpt-image-2` |
| Set 2, Alternate IA Direction | 9 | Complete, `1536x1024`, `gpt-image-2` |
| Review agent notes | 20 | Complete |
| Visual validation | 27 PNGs | Passed, 0 failures |

Primary paths:

- Actual: `actual/*.png`
- Set 1: `set-1/*.png`
- Set 2: `set-2/*.png`
- Prompts: `prompts/*.txt`
- API metadata: `metadata/set-*-*-image2.json`
- Validation: `metadata/visual-validation-all.json`
- Manifest: `manifest.json`

## Model And API Evidence

All generated images were requested through `https://api.openai.com/v1/images/edits` with `model: "gpt-image-2"`. No older image model fallback was used. API key handling used `OPENAI_API_KEY` from the local environment and did not persist the secret.

Each generated image has matching metadata with HTTP `200`, `ok: true`, model `gpt-image-2`, endpoint, request id, set, view, and output path.

## Recommendation

Use Set 1 as the primary visual direction and borrow from Set 2 selectively for information architecture. Set 1 generally preserves the current shell and workflows while improving hierarchy. Set 2 is more useful as a pressure test for navigation, context bars, and detail layouts, but should not be implemented wholesale without a component/state spec.

The first implementation pass should focus on the shared shell rather than isolated page styling:

- Define one global bar, one route context bar, one optional left rail, one work area, one detail surface, and one utility drawer model.
- Keep the top-level tabs stable across every first-level route and make Docs/Detail routes feel like Entity, not separate products.
- Move route filters/actions into context bars; keep left rails for scope/navigation rather than duplicate controls.
- Hide disabled editor/document controls until a file or document is selected.
- Make Terminal/Add to Dock contextual and collapsible so they do not cover or compete with core content.

## View Notes

### Files

Set 1 is strongest here. It improves scan hierarchy with row-based results, source tabs, clearer metadata, and better row actions. Keep search and source scope visible. Move advanced filters behind a tuning control when inactive. Demote Editing/Suggesting/Viewing until a file is selected.

### Agents

The actual capture is mostly loading state. The redesign should prove a loaded agent workspace: crew rail, selected-agent header, runtime/host, health, output, activity, queue, focus, and watch. Do not let file/document metadata bleed into the Agents surface unless it is explicitly agent output.

### Tasks

Preserve kanban density and visible counts. Improve the search/filter hierarchy, make active filters obvious, and keep output/evidence links visible on cards. Task detail needs a cleaner state bar, no clipped title, and local Activity/Comments/Evidence instead of relying on the background rail.

### Services

The page needs stronger operational state. Counters should map to row statuses, show last checked/discovery source, and distinguish loading, empty, failed, degraded, unknown, and operational. Make Plugin admin and Crew Admin actions secondary and clearly marked as internal/external.

### Chat

The actual capture is loading-only, so implementation needs loaded-state fixtures before coding. The target Chat view should show channel/category/thread hierarchy, transport/model route, local/cloud/offline states, message history, typing/queued/failed states, and a pinned composer.

### Admin

Admin should have one navigation model, not duplicated top tabs plus left nav at the same level. Split settings into Access, Appearance, Integrations, Plugins, and runtime/audit concerns. Login/security states need explicit risk labels, current session, and apply/refresh behavior.

### Docs View

Keep readable markdown as the core. Add clearer breadcrumbs, sticky/collapsible outline for long docs, compact Listen/Share controls, heading anchors, and safe Add to Dock placement. Docs should retain enough Entity shell context to avoid feeling like a separate app.

### Agent Detail

The actual capture is a skeleton/loading state. A useful detail view must center the selected agent, with Health, Output, Activity, and Queue. The crew rail should remain for switching, but diagnostics belong in the main pane.

### Task Detail

Make the task state scannable before form controls: task id/title, column/status, assignee, priority, blocked, due date, updated time. Separate Output from Docs/Evidence links. Add task-local Activity and Comments. Keep Continue work and Follow-up primary; group destructive/secondary actions.

## Acceptance Bar For Future Implementation

- Capture the same 9 canonical views before/after at `1440x1000`.
- Check at least one compact desktop width and one mobile/narrow width.
- Run `npm --prefix packages/app run build` for frontend changes.
- If server code changes, run `cd packages/server && npm run build && npx vitest run`.
- Verify route navigation, object selection, detail opening, docs links, chat send, filters, drawers, disabled/pending states, and keyboard focus.
- Do not accept a pass that improves one screenshot while making another route less consistent, less dense, or less accessible.

## Caveats

- Some agent notes were written while image generation was still in progress and mention missing images. `manifest.json` and `metadata/visual-validation-all.json` reflect the final state.
- Several actual screenshots show loading or sparse states. They are real current-state captures, but not sufficient as loaded-state specs for Agents, Chat, Services, and Agent Detail.
- Generated images are concept references. Before implementation, convert the chosen direction into component specs, state matrices, and data-field mappings.
