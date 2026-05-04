# PRD: Editor Sidebar Redesign - Google Docs-style Collaboration

## Goal
Transform the editor right sidebar from a cluttered debug-style panel into a minimalistic, Google Docs-inspired collaboration experience that fits the existing Entity dark theme.

## Current State (Problems)
The right sidebar currently shows ALL of these stacked vertically:
- Authorship panel (color indicators, manual attribution buttons)
- Documents Token (bearer token input + save)
- Comments section (count + add button + instruction text)
- Suggestions section (count + add button)
- Review section (grammar dropdown + run button + findings)

**Issues:**
1. Too much UI clutter - everything visible at once
2. Token config belongs in Settings, not the editor sidebar
3. Comments/suggestions show even when empty (wastes space)
4. Doesn't match Google Docs mental model users expect
5. Authorship panel takes too much space

## Design: Google Docs-style

### 1. Move Token to Settings Page
- Remove "Documents Token" section from sidebar entirely
- Add it to the existing Admin/Settings page
- Token is a one-time setup, not an editing concern

### 2. Editor Mode Toggle (Top Bar)
Replace the sidebar panels with a mode toggle in the top toolbar, like Google Docs:

```
[Editing v]  -->  dropdown with:
  - Editing (default)
  - Suggesting (track changes mode)
  - Viewing (read-only)
```

When in "Suggesting" mode:
- Edits create suggestions instead of direct changes
- Yellow highlight on suggested changes (Google Docs style)

### 3. Inline Comments (Google Docs style)
- Comments appear as **margin markers** on the right side of the editor
- Clicking a marker expands the comment thread inline (popover or side panel)
- To add a comment: select text -> Cmd+Shift+C (already supported) or right-click menu
- **Only show comment markers if comments exist on the document**
- Empty state: no UI clutter at all

### 4. Inline Suggestions (Track Changes)
- Suggestions render as **inline decorations** in the editor:
  - Deletions: red strikethrough
  - Insertions: green underline
  - Each has accept/reject buttons on hover
- **Only visible when suggestions exist**
- Suggestion count badge in toolbar (if > 0)

### 5. Review Panel (Collapsed by Default)
- Review button moves to toolbar: `[Review v]` dropdown
  - Grammar check
  - Style check
  - Full review
- Findings appear as inline annotations (like ESLint errors in VS Code)
- Panel only opens when there are findings to show

### 6. Authorship (Minimal)
- Remove the full authorship panel from sidebar
- Keep the color-coded gutter indicators in the editor (already exists via CodeMirror decorations)
- Show authorship stats in a small toolbar badge/tooltip: "Ada 45% | Human 55%"
- Manual attribution shortcut stays: Cmd/Ctrl+Shift+A

### 7. Right Sidebar: Only When Needed
The right sidebar should ONLY appear when:
- User clicks a comment marker (shows comment thread)
- User clicks Review findings (shows finding details)
- Otherwise: **no sidebar visible** - full-width editor

## Technical Changes

### Files to Modify
1. `packages/app/src/App.tsx` - Remove sidebar sections, add toolbar controls
2. `packages/app/src/components/CodeMirrorEditor.tsx` - Inline decorations for suggestions/comments
3. `packages/app/src/components/CommentThread.tsx` - Refactor for popover/margin display
4. `packages/app/src/components/SuggestionPanel.tsx` - Convert to inline track-changes
5. `packages/app/src/components/ReviewPanel.tsx` - Convert to toolbar dropdown + inline findings
6. `packages/app/src/components/editor/AuthorshipStatsPanel.tsx` - Minimize to toolbar badge
7. NEW: `packages/app/src/components/EditorToolbar.tsx` - Mode toggle + review + badges
8. `packages/app/src/index.css` - Styles for inline annotations

### Files to NOT Modify
- `packages/server/` - No backend changes needed
- `packages/db/` - No schema changes
- `packages/app/src/lib/documents-client.ts` - API client unchanged
- `packages/app/src/lib/http.ts` - Keep the error-handling fix

## Design Tokens (Match Existing Theme)
```css
/* Use existing Entity dark theme variables */
--comment-marker: #fbbf24;     /* amber for comment indicators */
--suggestion-insert: #22c55e;   /* green for insertions */
--suggestion-delete: #ef4444;   /* red for deletions */
--review-error: #ef4444;
--review-warning: #f59e0b;
--review-info: #3b82f6;
```

## Priority Order
1. **P0:** Move token to Settings page (quick win, declutter)
2. **P0:** Remove empty-state sections (comments/suggestions/review hidden when 0)
3. **P1:** Editor mode toggle (Editing/Suggesting/Viewing) in toolbar
4. **P1:** Inline comment markers in margin
5. **P2:** Track-changes inline decorations for suggestions
6. **P2:** Review findings as inline annotations
7. **P3:** Authorship stats badge in toolbar

## Acceptance Criteria
- [ ] Token section removed from sidebar, accessible only in Settings/Admin
- [ ] Sidebar hidden by default when no comments/suggestions/findings exist
- [ ] Comments appear as margin markers, expand on click
- [ ] Suggestions appear as inline track-changes (red strikethrough / green underline)
- [ ] Mode toggle in toolbar: Editing / Suggesting / Viewing
- [ ] Review runs from toolbar dropdown, findings shown inline
- [ ] Authorship reduced to toolbar badge
- [ ] Matches Entity dark theme, no jarring new colors
- [ ] Mobile-friendly (touch targets, responsive)
