# 04 Services Review

Source reviewed: `actual/04-services.png` plus `metadata/visual-validation-all.json`.

## Current State

- Actual screenshot passes visual metadata checks: 1440x1000, luminance range 183, 33 color buckets, no validation failures for `actual/04-services.png`.
- Generated Services comps are not present in either set: metadata reports `set-1/04-services.png` and `set-2/04-services.png` as missing.
- The page has a solid operational shell, but the empty state reads like an unpopulated data table rather than a service registry with health accountability.

## Recommendations

### Service Health

- Keep the four summary counters, but make their hierarchy clearer: Operational, Degraded, Offline, Unknown should use distinct severity color accents, not identical black cards with only labels.
- Add an explicit empty-state message below the table header when all counts are zero, e.g. no discovered services, last discovery source, and next refresh attempt.
- Show last checked time and discovery source near the summary header, not only as a table column that is invisible when empty.
- Preserve the table view for dense service lists, but include a list/card mode that surfaces health, host, URL, and details without requiring horizontal scanning.

### Plugin Registry

- The left sidebar and top-right buttons both expose plugin/admin actions; reduce duplication by making the sidebar the persistent registry entry point and the top bar a compact action cluster.
- Label plugin registry state directly: count installed plugins, count active plugins, and any sync/error state.
- When registry data is unavailable, distinguish "loading", "empty", and "failed to load" states. The current `Loading...` button is ambiguous because it appears beside a disabled refresh action while counters show zero.

### Status Hierarchy

- Use severity ordering consistently: Offline and Degraded should visually outrank Unknown, while Operational should be reassuring but quieter.
- Add status chips in table rows with icon + label + color. Avoid relying on numeric counters alone.
- Make the table header less dominant in the empty state; current header band competes with the summary cards despite no rows.

### Links And Actions

- Primary action should be `Refresh` or `Discover services`; admin links should be secondary unless the page is in an admin workflow.
- External/admin actions need consistent affordances: Plugin admin and Crew Admin appear both as sidebar buttons and top-right pills, but neither indicates whether they open a new route, modal, or external surface.
- URLs in populated rows should be clickable with copy/open affordances. Health/details cells should link to diagnostics or logs when available.
- Keep `Add to Dock` out of the Services content hierarchy unless it is a global shell action; it currently draws more attention than the empty registry.

## Acceptance Checks For Both Sets

- Set 1 and Set 2 must include a Services screen artifact at `set-1/04-services.png` and `set-2/04-services.png`; current metadata marks both missing.
- Both sets should show at least one populated-state example and one empty/error-state treatment for Services, or document which state the image represents.
- Counters must map clearly to row statuses: Operational, Degraded, Offline, Unknown totals should equal visible service rows in populated examples.
- Plugin registry actions must have one canonical placement and clear labels for Plugin admin and Enterprise Crew Admin.
- Loading, empty, and failed refresh states must be visually distinct.
- Links/actions must be keyboard reachable, have visible hover/focus states, and indicate whether they open internal routes, external admin pages, or diagnostics panels.
- Responsive check: at mobile/tablet widths, service rows should remain scannable without hiding status, host, health, checked time, or primary action.
