# Entity Agent-Native Editor: Comments, Suggestions, Presence UI

Complete ANE-013 through ANE-017 with polished, professional UI. Build components that feel integrated, not tacked on.

## ANE-013: Comments Threaded UI

**Backend (already exists - verify):**
- GET/POST /api/documents/:docId/comments
- Comment shape: { id, range: {from, to}, text, author, createdAt, replies[], resolved }

**Frontend to build:**

1. **CommentThread.tsx** - Right sidebar panel (NOT floating overlay)
   - Position: Collapsible panel in right sidebar, below authorship stats
   - Layout: 
     - Header: "Comments (3)" with + button to add new
     - List: Thread cards with author avatar, timestamp, text
     - Each card: Reply button, Resolve checkbox
   - Empty state: "Select text and press Cmd+Shift+C to comment"
   - Width: 280px fixed, collapsible

2. **InlineCommentAnchor.tsx** - CodeMirror decoration
   - Shows small comment icon in gutter when text has comment
   - Click icon = scroll comment into view in sidebar
   - Hover = tooltip preview of comment

3. **NewCommentPopover.tsx** - Triggered by Cmd+Shift+C on selection
   - Appears near selected text (floating but temporary)
   - Text input + Submit/Cancel
   - Auto-dismiss on click outside

4. **Wire in App.tsx:**
   - Add Comments panel to right sidebar layout
   - Register Cmd+Shift+C shortcut

## ANE-014: Suggestions/Track-Changes UI

**Backend:** Add if missing:
- GET/POST /api/documents/:docId/suggestions
- Shape: { id, range, originalText, suggestedText, author, status: 'pending'|'accepted'|'rejected' }

**Frontend:**

1. **SuggestionPanel.tsx** - Right sidebar panel (below Comments)
   - Header: "Suggestions (2)" 
   - List items show:
     - Author avatar + name
     - Diff preview: "original → suggested" (inline, color-coded)
     - Accept ✓ / Reject ✗ buttons
   - Click suggestion = scroll to it in editor + highlight

2. **TrackChangesDecoration.tsx** - CodeMirror inline styles
   - Insertions: Green underline + background (#dcfce7)
   - Deletions: Red strikethrough + background (#fee2e2)
   - Hover = tooltip: "Suggested by Ada - Accept/Reject"
   - Click = open suggestion in panel

3. **Wire accept/reject:**
   - PATCH /api/documents/:docId/suggestions/:id/accept
   - On accept: Apply edit, remove decoration, update doc
   - On reject: Remove decoration, mark rejected

## ANE-015: Presence Chips (Header Integration)

**Already have:** Presence API (/api/documents/:docId/cursor, websocket)

**Build:**

1. **PresenceChips.tsx** - Horizontal row in editor header (NOT floating)
   - Position: Top-right of editor header, next to filename
   - Shows: Avatar circles for active agents (Human, Ada, Spock, Scotty)
   - States:
     - Active (green dot): Cursor moved <30s ago
     - Idle (yellow dot): No activity 30s-5min
     - Away (gray): No activity >5min
   - Hover chip = show "Ada - typing at line 42" tooltip
   - Click chip = toggle follow mode for that agent

2. **CursorAvatars.tsx** - Floating cursors in editor
   - Small avatar + name label floating at agent's cursor position
   - Color-coded by agent (purple Ada, blue Spock, green Scotty)
   - Typing = subtle bounce animation
   - Follow mode active = highlight border on that avatar

3. **Join/Leave Toast.tsx** - Bottom-right notifications
   - "Ada joined the document" / "Spock left"
   - Auto-dismiss 3 seconds
   - Use existing toast system or create simple div

## ANE-016: OpenClaw Review Pipeline (Backend-heavy)

**Build:**

1. **Server routes:**
   - POST /api/documents/:docId/reviews - Create review run
   - GET /api/documents/:docId/reviews/:id - Get status/findings
   
2. **OpenClaw integration:**
   - POST to OpenClaw webhook with document content
   - Async job: grammar/style/technical/security check
   - Store findings in SQLite with structure:
     - { id, reviewId, type, severity, message, range, suggestedFix }

3. **Webhook callback:**
   - POST /api/webhooks/openclaw/review-result
   - Update review run status, persist findings

## ANE-017: Review Panel UI

**Build:**

1. **ReviewPanel.tsx** - Right sidebar panel (below Suggestions)
   - Header: Dropdown (Grammar | Style | Technical | Security) + "Run Review" button
   - Status: "Running..." spinner or "Last run: 5 min ago"
   - Findings list:
     - Severity badge (Error red, Warning yellow, Info blue)
     - Message text (truncated, expandable)
     - Line number link (click = jump to position)
     - Apply Fix / Ignore buttons
   - Filter: Show All | Errors Only | Warnings Only

2. **InlineFindingHighlight.tsx** - CodeMirror
   - Squiggly underline by severity (red/yellow/blue)
   - Hover = tooltip with message + quick fix button

## Design Standards (CRITICAL)

**Layout:**
- Right sidebar = 280px fixed width
- Stack panels: Authorship Stats → Comments → Suggestions → Review
- Collapsible sections with chevron icons
- NO floating overlays except temporary popovers

**Colors:**
- Use existing Tailwind classes (don't hardcode hex)
- Ada: purple-500, Spock: blue-500, Scotty: green-500, Human: gray-400

**Typography:**
- Text-sm for panel content (14px)
- Font-medium for headers
- Truncate long text with ...

**Spacing:**
- Panels have p-4 padding
- Gap-3 between items
- Border-b between sections

## Files to Create/Modify

**Create:**
- packages/app/src/components/CommentThread.tsx
- packages/app/src/components/InlineCommentAnchor.tsx
- packages/app/src/components/NewCommentPopover.tsx
- packages/app/src/components/SuggestionPanel.tsx
- packages/app/src/components/TrackChangesDecoration.tsx
- packages/app/src/components/PresenceChips.tsx
- packages/app/src/components/CursorAvatars.tsx
- packages/app/src/components/Toast.tsx
- packages/app/src/components/ReviewPanel.tsx
- packages/app/src/components/InlineFindingHighlight.tsx
- packages/server/src/editor/reviews.ts (routes)

**Modify:**
- packages/app/src/App.tsx (wire panels into sidebar layout)
- packages/app/src/components/CodeMirrorEditor.tsx (add decorations)
- packages/app/src/index.css (add animations)
- packages/server/src/editor/routes.ts (add review endpoints)
- packages/db/src/index.ts (add review runs table)

## Acceptance Criteria

- [ ] Comments panel shows threads, supports reply/resolve
- [ ] Cmd+Shift+C creates comment from selection
- [ ] Suggestions panel shows diffs with accept/reject
- [ ] Track-changes render inline with colors
- [ ] Presence chips show in header with active/idle states
- [ ] Cursor avatars float at agent positions
- [ ] Review panel runs checks, displays findings
- [ ] All panels fit in 280px sidebar without overflow
- [ ] No floating overlays (except temporary popovers)
- [ ] All builds pass (db, server, app)

## Before You Start

1. Read existing files:
   - packages/app/src/components/CodeMirrorEditor.tsx (see authorship decorations)
   - packages/app/src/App.tsx (see sidebar layout)
   - packages/server/src/editor/routes.ts (see existing API patterns)

2. Check types:
   - packages/app/src/types/collaboration.ts

3. Run builds after each major component:
   npm --prefix packages/db run build
   npm --prefix packages/server run build  
   npm --prefix packages/app run build

Build polished, professional UI. No "works but ugly." Everything should feel integrated into Entity's design.
