# Ralph Loop: ANE-016 through ANE-020

## Context
Read `docs/MC-AGENT-NATIVE-EDITOR-BUILD-PLAN.md` for the full architecture, API contracts, type system, and implementation sequence.

The backend is COMPLETE - all REST routes and WebSocket events are implemented in `packages/server/src/editor/`. The DB layer is complete in `packages/db/src/document-collab.ts` and `packages/db/src/agent-tokens.ts`. Auth middleware is complete in `packages/server/src/editor/auth.ts`.

The frontend client is COMPLETE - `packages/app/src/lib/documents-client.ts` has typed API methods for all endpoints.

**What remains is wiring the frontend UI to the backend.**

## Sprint C + D Stories (ANE-016 through ANE-020)

### ANE-016: Inline Comment Annotations
**File:** `packages/app/src/components/CodeMirrorEditor.tsx`, `packages/app/src/components/InlineCommentAnchor.tsx`, `packages/app/src/components/CommentThread.tsx`

1. Create a CodeMirror extension that reads comment positions from the collaboration state and renders **margin markers** (amber dots) on lines that have comments.
2. Clicking a margin marker opens the `CommentThread` component as a floating panel anchored to that line.
3. The `CommentThread` must support: view thread, reply, resolve/unresolve.
4. Creating a new comment: user selects text, presses Cmd+Shift+C → opens a `NewCommentPopover` anchored to the selection. On submit, calls `documentsClient.postComment()`.
5. WebSocket `document:comment:created`, `document:comment:replied`, `document:comment:resolved` events update comment state in real-time.
6. Use existing CSS classes: `.cm-comment-marker`, `.cm-comment-marker-resolved`

### ANE-017: Track Changes (Suggesting Mode)
**File:** `packages/app/src/components/CodeMirrorEditor.tsx`, `packages/app/src/components/TrackChangesDecoration.tsx`, `packages/app/src/components/SuggestionPanel.tsx`

1. When `editorCollabMode === 'suggesting'`, intercept CodeMirror transactions. Instead of applying edits directly, call `documentsClient.postSuggestion()` with the original and suggested text.
2. Render suggestions as inline CodeMirror decorations:
   - Deletions: red strikethrough (`.cm-suggestion-delete`)
   - Insertions: green underline (`.cm-suggestion-widget.cm-suggestion-insert`)
   - Replacements: red strikethrough + green text (`.cm-suggestion-widget.cm-suggestion-replace`)
3. Each suggestion decoration has hover controls: Accept / Reject buttons.
   - Accept calls `documentsClient.acceptSuggestion()` (only if source is writable)
   - Reject calls `documentsClient.rejectSuggestion()`
4. WebSocket `document:suggestion:created`, `document:suggestion:updated` events update suggestions in real-time.
5. Use existing CSS classes in `index.css` (`.cm-suggestion-mark`, `.cm-suggestion-delete`, `.cm-suggestion-widget`, `.cm-suggestion-btn`, etc.)

### ANE-018: Keyboard Shortcuts
**File:** `packages/app/src/components/CodeMirrorEditor.tsx`

1. Add CodeMirror keymap extension:
   - `Mod-Shift-a`: Toggle authorship attribution for selected range. Calls `documentsClient.postAuthorship()` with the current `manualAuthorshipAuthor`.
   - `Mod-Shift-c`: Create comment from selection. Opens `NewCommentPopover` positioned at the selection.
   - `Escape`: Detach follow mode (call `onDetachFollow`).
2. These keymaps should only be active when the editor is in edit mode and `agentNativeEditorEnabled` is true.
3. Maintain existing Cmd+S save behavior.

### ANE-019: Real-time Presence
**File:** `packages/app/src/components/CursorAvatars.tsx`, `packages/app/src/components/PresenceChips.tsx`, `packages/app/src/hooks/useWebSocket.ts`, `packages/app/src/components/CodeMirrorEditor.tsx`

1. Send cursor position heartbeats via `documentsClient.postCursor()` on selection change (debounced, ~500ms).
2. Receive `document:cursor` and `document:presence` WebSocket events. Update presence state.
3. Render remote cursors as colored line markers in CodeMirror with agent name labels:
   - Ada: purple (#a855f7)
   - Spock: blue (#3b82f6)
   - Scotty: green (#22c55e)
   - Human: white (#ffffff)
4. `PresenceChips` component shows who's currently in the document (top of editor area).
5. Presence states: active (solid), idle (dimmed after 60s), disconnected (removed after 5min).
6. Follow mode: clicking a presence chip scrolls to that agent's cursor position and enables follow glow.

### ANE-020: AI Review Integration
**File:** `packages/app/src/components/ReviewPanel.tsx`, `packages/app/src/components/InlineFindingHighlight.tsx`, `packages/app/src/components/CodeMirrorEditor.tsx`

1. "Run" button in the review toolbar dropdown calls `documentsClient.postReview({ mode })`.
2. Poll `documentsClient.getReview(docId, runId)` until status changes from `running` to `completed`.
3. Render findings as inline CodeMirror decorations:
   - Error: red wavy underline (`.cm-finding-error`)
   - Warning: amber wavy underline (`.cm-finding-warning`)
   - Info: blue wavy underline (`.cm-finding`)
4. Clicking a finding decoration shows a tooltip with the message and a "Fix" button.
5. "Fix" button calls `documentsClient.applyReviewFinding()` to apply the suggested replacement.
6. "Ignore" button calls `documentsClient.ignoreReviewFinding()`.
7. WebSocket `document:review:completed` event triggers automatic findings load.

## Key Constraints
- **Frontend only** - Do NOT modify `packages/server/`, `packages/db/`, or `packages/app/src/lib/documents-client.ts`
- **Do NOT modify `packages/app/src/lib/http.ts`** - Keep existing error-handling fix
- Use the existing `documentsClient` API methods - they're already typed and tested
- Use existing CSS classes in `packages/app/src/index.css` - they're already styled for the dark theme
- The `documents-client.ts` already has all needed methods: `postComment`, `postCommentReply`, `postCommentResolve`, `postSuggestion`, `acceptSuggestion`, `rejectSuggestion`, `postReview`, `getReview`, `applyReviewFinding`, `ignoreReviewFinding`, `postEdit`, `postAuthorship`, `postCursor`
- Existing components to build on: `CommentThread.tsx`, `InlineCommentAnchor.tsx`, `NewCommentPopover.tsx`, `SuggestionPanel.tsx`, `ReviewPanel.tsx`, `TrackChangesDecoration.tsx`, `CursorAvatars.tsx`, `PresenceChips.tsx`, `InlineFindingHighlight.tsx`
- Read `packages/app/src/types/collaboration.ts` for all TypeScript types

## Testing
After each ANE story, verify:
1. `npx tsc --noEmit` passes in `packages/app/`
2. The feature works visually in the browser at `http://localhost:5176`
3. WebSocket events update UI in real-time

## 50% Checkpoint (after ANE-017)
Pause and verify:
- Comments create/reply/resolve work
- Track changes render inline with accept/reject
- No TypeScript errors
