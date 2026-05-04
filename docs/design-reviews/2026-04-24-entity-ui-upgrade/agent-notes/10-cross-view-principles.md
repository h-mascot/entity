# 10 Cross-View Principles

## Product Posture

Entity should look like a local operational command surface, not a SaaS marketing dashboard and not a developer toy. The UI should feel dense, dark, fast, and accountable: every pane should answer what is running, what changed, what needs attention, what can be opened, and what action is safe to take next.

The visual language should stay restrained: high contrast, compact type, clear row rhythm, severity colors used sparingly, and no decorative backgrounds. The product context is local execution across files, agents, tasks, services, chat, admin, plugins, docs, and notifications, so the interface should prioritize evidence, state, source, and recoverability over visual novelty.

## Shell And Navigation

- Keep one persistent Entity shell across all views: app identity, primary nav, notification entry, global status, and any global dock/add affordance should stay in the same place.
- The shell should not compete with view content. Top nav can be compact and stable; view-specific controls should sit inside the view header or toolbar, not in the global chrome.
- Active navigation must be unmistakable. Files, Agents, Tasks, Services, Chat, and Admin should use the same selected-state treatment.
- Use icons to support recognition, but never let emoji-style icons become the main state language. Status and actions need text labels or tooltips where ambiguity matters.
- `Add to Dock` is a global shell action. It should not float over document content, table rows, boards, chat, or detail panels.

## View Ownership

Each view should own a distinct operational job:

- Files: browse, filter, preview, edit, deep-link, share, and recover documents.
- Agents: monitor crew state, focus, queue, health, activity, and output.
- Tasks: execute work through backlog, todo, doing, review, done, dependencies, output, and evidence.
- Services: inspect runtime services, plugin status, health checks, hosts, links, and diagnostics.
- Chat: communicate with agents through channels, threads, delivery route, model choice, and offline/queued state.
- Admin: configure access, appearance, integrations, plugins, sources, and operational trust boundaries.
- Docs: read, navigate, share, listen to, and deep-link long markdown documents.

Controls that do not serve the current view should be hidden, moved to a secondary drawer, or demoted. File filters should not leak into Agents or Services. Terminal controls should not appear as primary content unless the view is explicitly about runtime execution. Plugin admin links belong in Services/Admin, not every operational pane.

## More UI Where It Adds Accountability

Entity should add UI when the user needs state, provenance, or recovery:

- More status language: online, offline, degraded, unknown, local, cloud, queued, failed, stale, blocked, validating, and applied-after-refresh should have consistent labels.
- More source context: host, agent, path, origin, task link, plugin source, service URL, checked time, and route should be visible where they change trust or action.
- More audit affordance: task details, accepted evidence, validation logs, agent output, service diagnostics, plugin failures, and admin changes should be reachable from the object they explain.
- More empty/loading/error states: loading, empty, failed to load, no discovered services, no active session, no channels, and offline fallback are different states and need different treatments.
- More compare-and-scan structure: dense tables, kanban columns, activity timelines, outline navigation, status chips, badges, breadcrumbs, and compact metadata rows are appropriate for Entity.
- More visible primary actions when they unblock work: refresh/discover services, open file, open task detail, start agent, test source, send message, retry queued item, copy/share link.

## Less UI Where It Adds Noise

Entity should remove or demote UI that repeats state or creates false importance:

- Fewer duplicated controls across top bars, sidebars, and content panes. One canonical placement per action.
- Fewer repeated row buttons. Prefer one visible primary action plus a compact overflow menu for secondary actions.
- Fewer large cards for data that wants to be compared. Services, files, agent events, configured sources, and tasks often need row density.
- Fewer decorative containers. Do not place cards inside cards or use floating panels as page sections.
- Fewer oversized headings and empty-state posters. Entity is an operator console; first viewports should stay usable.
- Fewer ambiguous pills like `Off`, `Loading...`, or status dots without labels. These look compact but hide operational meaning.
- Fewer global filters on views where they are not central. File taxonomy filters belong in Files, not as residual clutter in Agents or Services.

## Information Hierarchy

- Each screen should have one clear view title, one compact subtitle that explains the operational scope, and one primary action cluster.
- Summary counters should be useful only when tied to visible rows or objects. Counts with no rows should explain empty state and last refresh/source.
- Severity hierarchy should be consistent: failed/offline/blocked outranks degraded/stale, which outranks unknown, which outranks healthy/operational.
- Metadata should be compact but readable. Use stable positions for agent, host, path, timestamp, status, and source.
- Detail views should not feel like separate products. Agent detail and task detail should reuse shell, toolbar, status chips, evidence/output sections, and navigation rhythm from their parent views.

## Interaction Patterns

- Rows, cards, kanban items, channel entries, outline links, and nav items need stable hover, selected, focused, loading, empty, and disabled states.
- Primary actions should be visible; destructive or high-risk actions should be confirmed or show consequences before execution.
- Filters need a clear reset path and should show active state without consuming the entire toolbar.
- Breadcrumbs and deep links matter because Entity spans local files, generated docs, tasks, and runtime output.
- Keyboard reachability should be treated as core functionality, especially for dense operational tables, source rows, task cards, chat composer, and docs outline.

## Visual System

- Keep the palette dark, neutral, and operational with restrained accents. Avoid beige, purple-heavy, blue-slate monotony, gradients, or decorative orbs.
- Use severity colors consistently and sparingly: red for failed/offline/blocking, amber for degraded/stale/warning, blue or cyan for informational/routing, green for healthy/applied.
- Use compact typography with strong contrast. Reserve larger type for page titles and document headings; dense panels need smaller, tighter labels.
- Use a shared component vocabulary: status chip, route badge, source badge, host label, path token, segmented control, icon button, overflow menu, row action, side drawer, detail panel.
- Preserve alignment discipline. Tables, boards, sidebars, chat lanes, and document outlines should share grid logic so the app feels like one system.

## Cross-View Acceptance Bar

- A user should know what view they are in, what object is selected, what is healthy or broken, and what the next safe action is within five seconds.
- No view should show unrelated controls from another view unless clearly labeled as linked output or cross-reference.
- Empty and loading captures should still reveal intended layout and recovery path.
- Every operational object should expose enough provenance to answer: where did this come from, who/what produced it, when was it last checked, and where can I inspect the evidence?
- The redesign should improve scan speed while preserving Entity's local-first, agent-aware, execution-oriented mental model.
