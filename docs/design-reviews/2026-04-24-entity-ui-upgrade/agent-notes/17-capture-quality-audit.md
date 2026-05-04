# Capture Quality Audit

## Scope

- Reviewed `metadata/01-files.json` through `metadata/09-task-detail.json`, `metadata/actual-capture-summary.json`, `metadata/visual-validation-actual.json`, `metadata/visual-validation-all.json`, and `metadata/set-1-*-image2.json`.
- Spot-checked the corresponding actual PNGs in `actual/`.
- No new image generation was performed.

## High-Level Findings

- All 9 actual screenshots are present and decode as valid `1440x1000` PNGs. `metadata/visual-validation-actual.json` reports no file-level failures.
- The validation is too shallow for capture quality: it only checks dimensions, basic luminance/color variation, and transparency. It misses semantically bad captures such as loading screens, zero-data states, stale rows, and incomplete detail loads.
- All actual first-level tab captures use the same root URL, `http://127.0.0.1:5173/`, and rely on in-app tab state rather than route-specific URLs. That is acceptable only if the design review intentionally treats tabs as stateful root views; otherwise route accuracy is weak for Files, Agents, Tasks, Services, Chat, and Admin.
- The generated artifact inventory is incomplete. `set-1/01-files.png` through `set-1/05-chat.png` exist, but `set-1/06-admin.png` through `set-1/09-task-detail.png` and all `set-2/*.png` are missing. `metadata/visual-validation-all.json` records these missing generated files.
- The `set-1-*-image2.json` files show prior OpenAI image edit calls for the first 5 first-level views. This audit did not call those APIs; it only inspected their metadata.

## Per-View Capture Quality

| View | Expected level | Metadata route | Captured correctly? | Quality issues |
| --- | --- | --- | --- | --- |
| `01-files` | First-level Files | spec `/`, actual `/` | Partially | Correct Files tab is selected. Capture includes `No file selected`, old file rows from `2026-04-14`, and long raw excerpts. This is useful for dense data styling but stale as an April 24 baseline and not a clean empty-state or selected-file capture. |
| `02-agents` | First-level Agents | spec `/`, actual `/` | No | Correct Agents tab is selected, but it is stuck in loading: `Agents online: 0/0`, `Loading agents...`, and `Loading agent dashboard...`. Not usable for final design judgment. |
| `03-tasks` | First-level Tasks | spec `/`, actual `/` | Yes, with stale data | Correct Tasks tab and Kanban view captured. Data is stale/noisy: task ages such as `8d 15h`, old stuck/idling activity, and many backlog items. Useful for layout stress, weak for fresh operating-state review. |
| `04-services` | First-level Services | spec `/`, actual `/` | Partially | Correct Services tab captured, but registry is loading/empty: all counts are `0`, table headers are present with no rows, and a `Loading...` control is visible. This is an empty/loading state, not a healthy services registry. |
| `05-chat` | First-level Chat | spec `/`, actual `/` | No | Correct Chat tab captured, but the body is only `Loading chat...`. The PNG passes visual validation despite being semantically blank. |
| `06-admin` | First-level Admin | spec `/`, actual `/` | Yes | Correct Admin tab and General settings panel captured. It intentionally shows `No active login session` and configured sources. This is a usable first-level admin baseline. |
| `07-docs-view` | Second-level Docs view | spec `/docs/memory/entity-mc-context.md`, actual `/docs/memory/entity-mc-context.md` | Yes | Route is accurate and content is rendered. Content includes dated sections such as `v20 changes (2026-03-23)` and rollout-state headings, so the document data may be stale, but the capture itself is route-correct. |
| `08-agent-detail` | Second-level Agent detail | spec `/`, actual `/` | Partially / likely wrong target | Metadata labels this as Agent Detail View, but URL remains `/` and the screenshot shows the Agents tab with an Ada card selected plus dashboard skeletons. It does not show a stable detail route or a fully loaded detail panel. |
| `09-task-detail` | Second-level Task detail | spec `/`, actual `/task/462` | Yes, but stale test data | Actual URL is route-correct for a task detail overlay. The selected task is `Task #462` / `test ripple task`, created and updated `Apr 11 2026, 12:45 PM`, with `No output yet`, no projects, no dependencies, and no attachments. Good for form/overlay layout, poor as representative task data. |

## Stale Data Notes

- Files view prominently starts with `2026-04-14` and other April 13-14 artifacts. For an April 24 design pass, this reads stale unless intentionally reviewing archived memory/file data.
- Tasks view shows several idling or stale operational rows with ages around `8d 15h`, plus old sprint/task names. This is useful for stress-testing dense cards but not a clean current-state capture.
- Task detail uses a test item created/updated on April 11, 2026. The title and body are placeholders (`test ripple task`, `test body`).
- Docs view content references rollout history including March 23, 2026. This may be valid documentation, but it should not be mistaken for a current operational status capture.
- Chat did not load actual messages in the screenshot, so any stale chat content in metadata text is not visible in the final PNG.

## Empty And Loading States

- Bad loading captures: `02-agents`, `05-chat`.
- Partial empty/loading captures: `04-services`, `08-agent-detail`.
- Intentional/acceptable empty sections: `09-task-detail` has no output/projects/dependencies/attachments, but that is tied to placeholder task data rather than a system failure.
- `visual-validation-actual.json` should not be used alone as quality proof; it reports all actual PNGs as visually OK even when the screen is mostly blank or loading.

## Route Accuracy

- Accurate second-level routes:
  - `07-docs-view`: `/docs/memory/entity-mc-context.md`
  - `09-task-detail`: `/task/462`
- Weak or state-only route captures:
  - `01-files` through `06-admin` all capture `/`. The active tab is visible, but the URL does not identify the tab.
  - `08-agent-detail` is also `/`; it does not prove an agent detail route and appears to be an agent selection state inside the Agents tab.
- Metadata `spec.url` for `09-task-detail` remains `/` while the actual captured URL is `/task/462`; the spec metadata should be corrected to match the actual route if this artifact is reused.

## Recommendations

- Re-capture `02-agents`, `04-services`, `05-chat`, and `08-agent-detail` after the relevant data has finished loading.
- Re-capture `09-task-detail` with a non-placeholder task if the design review needs realistic detail content.
- Add metadata assertions for forbidden capture text such as `Loading chat...`, `Loading agents...`, `Loading agent dashboard...`, and all-zero service counts when the target is a populated registry.
- Add route assertions so second-level views must use a route that proves the intended view, especially agent detail.
- Update the generated-artifact validation manifest or complete the missing `set-1` and `set-2` files before treating the generated comparison set as complete.
