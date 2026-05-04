# Ralph Loop: ANE-019 + ANE-020 ONLY

## Context
ANE-016 (Comments), ANE-017 (Track Changes), ANE-018 (Keyboard Shortcuts) are ALREADY COMPLETE. Do NOT touch them.

Read `docs/MC-AGENT-NATIVE-EDITOR-BUILD-PLAN.md` for the full architecture.

The backend is COMPLETE. The frontend client `packages/app/src/lib/documents-client.ts` has all typed API methods.

**Only implement ANE-019 and ANE-020. Do not modify any code related to ANE-016/017/018.**

## ANE-019: Real-time Presence
**File:** `packages/app/src/components/CodeMirrorEditor.tsx`, `packages/app/src/components/CursorAvatars.tsx`, `packages/app/src/components/PresenceChips.tsx`

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

## ANE-020: AI Review Integration
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
- **Frontend only** — Do NOT modify `packages/server/`, `packages/db/`, or `packages/app/src/lib/documents-client.ts`
- **Do NOT modify `packages/app/src/lib/http.ts`**
- Use existing `documentsClient` API methods
- Use existing CSS classes in `packages/app/src/index.css`
- Existing components to build on: `CursorAvatars.tsx`, `PresenceChips.tsx`, `ReviewPanel.tsx`, `InlineFindingHighlight.tsx`
- Read `packages/app/src/types/collaboration.ts` for all TypeScript types

## Testing
After each story, verify `npx tsc --noEmit` passes in `packages/app/`.
