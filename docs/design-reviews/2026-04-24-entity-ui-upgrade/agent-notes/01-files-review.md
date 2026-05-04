# Files Review

## What Improved in Set 1

- Stronger app chrome: icon + label nav makes the active Files section clearer than the current text-only pills.
- Better file scan pattern: row layout, left file-type icons, source tabs, right-side dates, and overflow actions make the dashboard feel more operational than the current stacked cards.
- Improved hierarchy: title, metadata, snippet, status chip, and row actions have clearer roles; the actual screenshot reads as several similar dark cards with dense text.
- More useful source switching: Set 1 adds Zora/Vault/Spock/Ada/Entity tabs above results, reducing dependence on the left source tree for every source filter.
- Better action placement: Add to Dock is still available but less visually isolated, and row-level chevrons/menus imply direct file actions.

## Still Needs Improvement

- Set 1 is slightly over-controlled: top nav, document mode controls, source tree, search, four filters, source tabs, tune button, row actions, bottom terminal, and Add to Dock all compete in one viewport.
- The top document controls still feel inherited from an editor, not tailored to file browsing. Files likely needs browsing, preview, open, history, share, and dock actions, not Editing/Suggesting/Viewing as the dominant mode set.
- Result rows are cleaner but may be too tall for power use. Keep Set 1's structure, then test a compact density option or reduce vertical padding by 10-15%.
- Status chips still overuse `UNKNOWN`. Either improve classification labels or de-emphasize unknown states so they do not become visual noise.
- The left source panel duplicates the new horizontal source tabs. Pick clear ownership: sidebar for source hierarchy/folders, tabs for quick scope, not both performing the same job.
- The actual view's truncation is safer than Set 1's denser row text in some places; Set 1 must preserve readable snippets without letting long paths dominate.

## Controls

- Add or keep: global search, source filter, type filter, origin filter, agent filter, compact row menu, file open/preview action, Add to Dock.
- Reduce: persistent Editing/Suggesting/Viewing controls in Files; keep them only when a file is opened or selected.
- Reorganize: move advanced filters behind the tune button when not active; keep search + source visible by default.
- Reorganize: keep source tabs directly above results, but make the left sidebar focus on expandable folders and source health/status.
- Reorganize: bottom Terminal should be collapsed by default unless the selected file/action has command output.
- Fewer visible controls on first load: aim for one primary search bar, one primary source selector, one filter affordance, and row-level actions.

## Acceptance Checks

### Actual Files Baseline

- Current screenshot remains the functional baseline: user can search, filter by source/type/origin/agent, browse source folders, select a result, add to dock, and access terminal.
- No file title, path, snippet, or status chip overlaps adjacent controls at desktop width.
- Disabled or inactive document actions are visually distinct from available file actions.
- Long snippets and paths truncate consistently without pushing card width or hiding filter controls.
- Left source tree remains navigable with keyboard focus and visible selected/expanded states.

### Set 1 Pilot

- Files dashboard shows at least 7 results above the fold at 1536px width while preserving title, source/path metadata, snippet, date, tags, and row actions.
- Search + primary source scope are visible without opening a menu; advanced filters can be reached in one click.
- Source tabs and left sidebar do not conflict: changing a tab updates results, while sidebar folder selection narrows within that source.
- Row icon color/type meaning is documented in UI state and does not rely on color alone.
- Top editor controls are hidden or demoted until a file is selected/opened.
- Bottom terminal and Add to Dock never cover the final result row or row action menus.
- Hover, selected, focused, and empty states are specified for rows, source tabs, sidebar entries, filters, and Add to Dock.
