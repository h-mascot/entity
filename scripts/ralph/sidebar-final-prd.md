# PRD: Editor Sidebar Final Polish - Minimalistic Google Docs Style

## Context
A previous Codex run partially implemented the sidebar redesign. The token form was moved to Admin settings, an `EditorCollaborationMode` type and state were added, and collapse toggles exist for each section. This PRD completes the remaining work.

## Current State After Previous Run
- Token form: ✅ Moved to Admin/Settings page
- `editorCollabMode` state: ✅ Added (`editing`/`suggesting`/`viewing`)
- Mode toggle `<select>`: ✅ Exists in toolbar area (line ~2170)
- Collapse states: ✅ `authorshipCollapsed`, `commentsCollapsed`, `suggestionsCollapsed`, `reviewCollapsed`
- Right sidebar: Still always visible at 280px width when `agentNativeEditorEnabled`

## Remaining Changes

### 1. Hide Empty Sections (P0 - Critical)
**File:** `packages/app/src/App.tsx`

The right sidebar sections (Comments, Suggestions, Review) currently render even when empty. Wrap each in conditional rendering:

```tsx
// Comments section: only show if comments.length > 0
{comments.length > 0 && (
  <CommentThread ... />
)}

// Suggestions section: only show if suggestions.length > 0
{suggestions.length > 0 && (
  <SuggestionPanel ... />
)}

// Review section: only show if reviewFindings.length > 0 || reviewRun
{(reviewFindings.length > 0 || reviewRun) && (
  <ReviewPanel ... />
)}
```

When ALL are empty AND authorship has 0 ranges, hide the entire right sidebar `<aside>` element. Show a small collapsed indicator instead.

### 2. Collapsible Right Sidebar with Chevron (P0)
**File:** `packages/app/src/App.tsx`

The left file tree already has a collapse pattern (look for `sidebarCollapsed` and the `«`/`»` chevron button). Mirror this for the right sidebar:

- Add state: `const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false)`
- Persist to localStorage key `entity.rightSidebar.collapsed.v1`
- When collapsed: hide the 280px aside, show a thin 32px strip with a `«` chevron button
- When expanded: show full sidebar with `»` chevron to collapse
- The chevron sits at the top of the sidebar border

### 3. Authorship Minimized to Toolbar Badge (P1)
**File:** `packages/app/src/App.tsx`

Replace the full Authorship panel in the sidebar with a compact badge in the top context bar (near the mode toggle). Show:

```tsx
<div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
  {authorshipStats.human > 0 && <span>👤 {authorshipStats.human}%</span>}
  {authorshipStats.ada > 0 && <span className="text-purple-400">Ada {authorshipStats.ada}%</span>}
  {authorshipStats.spock > 0 && <span className="text-blue-400">Spock {authorshipStats.spock}%</span>}
  {authorshipStats.scotty > 0 && <span className="text-green-400">Scotty {authorshipStats.scotty}%</span>}
</div>
```

Remove the `AuthorshipStatsPanel` from the right sidebar entirely. Keep the manual attribution shortcut (Cmd/Ctrl+Shift+A) working.

### 4. Mode Toggle Styling (P1)
**File:** `packages/app/src/App.tsx`

The mode toggle `<select>` at line ~2170 should be styled to match the Entity dark theme:

```tsx
<select
  className="rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-secondary)] focus:border-[var(--accent)] focus:outline-none"
  value={editorCollabMode}
  onChange={(e) => setEditorCollabMode(e.target.value as EditorCollaborationMode)}
>
  <option value="editing">Editing</option>
  <option value="suggesting">Suggesting</option>
  <option value="viewing">Viewing</option>
</select>
```

### 5. Clean Up Sidebar Layout (P1)
**File:** `packages/app/src/App.tsx`, `packages/app/src/index.css`

When the right sidebar IS visible (has content), it should feel clean:
- Remove section borders between empty sections
- Tighter spacing: `py-2 px-3` instead of `py-3 px-4`
- Section headers: just the title + count badge, no expand/collapse arrows for sections that have content (they're always expanded when visible)
- Remove the "Select text and press Cmd+Shift+C to comment" instruction text - it's UI clutter

## Files to Modify
1. `packages/app/src/App.tsx` - Main changes (conditional rendering, right sidebar collapse, authorship badge)
2. `packages/app/src/index.css` - Minor spacing/style tweaks
3. `packages/app/src/components/editor/AuthorshipStatsPanel.tsx` - May be removed or simplified

## Files to NOT Modify
- `packages/server/` - No backend changes
- `packages/db/` - No schema changes
- `packages/app/src/lib/http.ts` - Keep existing error-handling fix
- `packages/app/src/lib/documents-client.ts` - No API changes

## Design Reference
- **Google Docs right panel:** Only appears when there are comments/suggestions. Otherwise full-width editor.
- **VS Code minimap area:** Thin strip on the right that can be toggled.
- **Entity left sidebar:** Already has collapse pattern with `«`/`»` - reuse same approach for right side.
