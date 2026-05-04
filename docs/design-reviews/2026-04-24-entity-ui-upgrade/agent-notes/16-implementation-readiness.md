# 16 Implementation Readiness

## Verdict

The artifact set is not implementation-ready yet. It is useful as a direction-setting review pack, especially for shell/navigation principles and per-view acceptance criteria, but another engineer should not start a broad UI implementation from the generated images alone.

The strongest implementation inputs are the written reviews in `agent-notes/01-*` through `13-*`, the actual screenshots in `actual/`, and the cross-view principles in `10-cross-view-principles.md` and `13-navigation-shell-review.md`. The generated concepts are incomplete and uneven: Set 1 currently has only `01-files` through `05-chat`, Set 2 has no PNGs, and the current validation JSON is stale relative to the filesystem.

## What An Engineer Would Need To Implement

- A route-by-route implementation brief that turns the review notes into backlog tickets: Files, Agents, Tasks, Services, Chat, Admin, Docs View, Agent Detail, and Task Detail.
- A shell contract before screen work starts: global bar, context bar, left rail, work area, detail surface, and bottom utility drawer, including exact ownership rules for each route.
- A shared component inventory: status chip, source badge, host label, path token, route badge, segmented control, icon button, overflow menu, dense table row, kanban card, activity row, detail drawer, docs outline, empty/loading/error state, and terminal/dock utility.
- State matrices for every view: loading, empty, populated, filtered, error, offline/degraded, selected, disabled, hover, focus, active, and narrow-width states.
- Data mapping from current React/server objects to visible UI fields. This is especially important for agent health/output/activity, task output/docs links, service registry health, plugin runtime status, chat delivery route, and admin source/plugin states.
- Responsive behavior specs for at least desktop `1440x1000`, generated desktop `1536x1024`, laptop width, and mobile/tablet collapse behavior.
- Accessibility requirements: keyboard order, focus rings, icon-only labels/tooltips, semantic headings, table/list semantics, drawer/modal focus behavior, and color-independent status labels.
- QA fixtures or seed data for populated states. Several actual captures are loading or empty states, so implementation needs reliable data examples for loaded Agents, loaded Chat, populated Services, populated Task Detail output/docs/comments, and long Docs View documents.

## Missing Artifacts

- Set 1 is incomplete. Present PNGs: `01-files`, `02-agents`, `03-tasks`, `04-services`, `05-chat`. Missing PNGs: `06-admin`, `07-docs-view`, `08-agent-detail`, `09-task-detail`.
- Set 2 is not present. `set-2/` currently has no generated PNGs, prompts, or metadata.
- Full generated validation has not been refreshed. `metadata/visual-validation-all.json` still reports most generated images as missing even though Set 1 now contains five PNGs.
- `metadata/visual-validation-actual.json` is not reliable as a baseline proof because it contains only `set-1/01-files.png` from a targeted run, not the nine actual screenshots.
- Prompts exist only for Set 1 `01-files` through `06-admin`; Set 1 Admin has a prompt but no matching image/metadata. There are no Set 2 prompts.
- Metadata is polluted by off-screen or inactive DOM text. Files, Agents, Services, and Chat prompts include unrelated document/file content, which makes generated images unsuitable as exact product specs.
- The current generated `set-1/05-chat.png` appears to render a file/document browsing surface, not a chat workspace. It should not be used as a chat implementation reference.
- Loaded-state references are missing for key views. Actual Agents, Chat, Services, and Agent Detail are mostly loading/empty; implementation needs populated examples or explicit wireframes.
- Component-level design tokens are missing: spacing scale, typography scale, icon set, color roles, severity colors, border/radius rules, row heights, rail widths, drawer widths, and z-index/overlay rules.
- Interaction specs are missing for destructive actions, save behavior, autosave/dirty states, retry flows, source testing, service refresh/discovery, dock behavior, terminal drawer behavior, and docs audio/listen states.

## Choices That Are Settled

- Product posture is settled: Entity should remain a dense, dark, local operational command surface, not a marketing dashboard or sparse hero-style app.
- The top-level app areas are settled: Files, Agents, Tasks, Services, Chat, Admin, Docs View, Agent Detail, and Task Detail.
- The global shell should persist across normal app routes, with stable primary navigation, notification/status affordances, and consistent active states.
- The UI should use a three-layer model: global bar, route context bar, and work area with optional left rail/detail drawer/utility drawer.
- Left rails should be scope/navigation surfaces, not duplicate filter/action panels. Filters and primary route actions belong in the context bar.
- `Add to Dock` and Terminal are global utility behaviors, but they should be contextual/collapsible and must not cover content.
- Files should prioritize search, source scope, type/origin/agent filters, preview/open/share/dock actions, readable paths, and compact result rows.
- Agents should prioritize crew health, selected-agent focus, focus/watch controls, runtime/host, current work, queue, health, output, and activity.
- Tasks should preserve dense kanban execution, board counts, recent activity, filters/search, output evidence, and task detail context.
- Services should use consistent health severity language: operational, degraded, offline, unknown, with last checked/source and refresh/discovery semantics.
- Chat must be a real channel/thread/composer workspace with route/model/delivery state, not a document list or generic loading screen.
- Admin should separate access, appearance, integrations, plugins, source management, and audit/runtime concerns with one clear navigation model.
- Docs View should preserve readable markdown and add long-document navigation, breadcrumbs, share/listen controls, and safe Add to Dock placement.
- Task Detail and Agent Detail should be auditable object workspaces, with local activity/output/evidence rather than relying on background rails.

## Recommended Next Step Before Implementation

Create a short implementation spec from the settled choices, then produce missing low-fidelity or high-fidelity references for the incomplete states before writing production UI. Minimum blocker list:

- Regenerate or replace the missing Set 1 and all Set 2 artifacts, or explicitly drop Set 2 from scope.
- Rerun visual validation after the artifact set is complete.
- Fix prompt/context capture so future generated artifacts use visible active-view content only.
- Write a shell/component spec that implementation engineers can map directly to React components.
- Add per-view state tables and data-field mappings before cutting UI tickets.

Until those blockers are closed, the notes are implementation-guiding but not implementation-ready.
