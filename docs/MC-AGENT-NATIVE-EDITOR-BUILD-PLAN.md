# MC Agent-Native Editor Implementation Plan

## Summary
Build a full agent-native editing system in Entity in one delivery stream (P0 + P1), using SQLite as canonical metadata storage, real OpenClaw integration, and dual auth modes (per-agent bearer tokens + service token with strict actor mapping). Text edits are supported for all sources that expose write capability; for read-only sources, collaboration overlays (presence, comments, suggestions, authorship view) are supported but source text mutation is blocked.

This plan is decision-complete and aligned with current code structure:
- Frontend: `packages/app/src/App.tsx`, `packages/app/src/components/CodeMirrorEditor.tsx`, `packages/app/src/hooks/useWebSocket.ts`
- Server: `packages/server/src/index.ts`, `packages/server/src/fs/*`
- DB: `packages/db/src/index.ts`

## Product Scope and Defaults

### Delivery Scope
- Single delivery program containing both P0 and P1 features from `docs/MC-AGENT-NATIVE-EDITOR.md`.

### Source Write Policy
- Writable sources: allow edits, suggestions apply/reject, authorship mutation, review apply actions.
- Read-only sources (`docsify`, `http-markdown` in current adapters):
  - Allow presence, follow mode, cursor streaming, comments, suggestions, and review overlays.
  - Block source text mutation endpoints with `403` and explicit capability error.
  - UI surfaces read-only status and disables apply/accept actions that would mutate text.

### Authentication and Attribution
- Support both auth forms for agent-native APIs:
  - Per-agent bearer token (recommended path).
  - Service token (machine-to-machine integration path).
- Service token requests must include `X-Entity-Actor` header and map to configured known actor IDs (`ada`, `spock`, `scotty`, optional `henry`, `system-reviewer` if enabled).
- Unknown or unmapped actor with service token is rejected (`401/403`).
- Actor identity is server-derived only (never trusted from request body).

## Public Interfaces and API Additions

### New REST API Surface
Mounted in server with explicit feature flag: `ENTITY_AGENT_NATIVE_EDITOR=true`

- `GET /api/documents/:docId/state`
  - Returns canonical document collaboration state snapshot:
  - `{ contentRef, sourceId, path, capabilities, authorshipStats, presence, commentsSummary, suggestionsSummary, reviewSummary, version }`

- `POST /api/documents/:docId/edit`
  - Body: `{ from, to, insert, attribution?, clientVersion }`
  - Applies edit when source is writable and optimistic concurrency passes.
  - Emits websocket events for patch + authorship updates.

- `POST /api/documents/:docId/authorship`
  - Body: `{ from, to, author }`
  - Manual attribution toggle (Cmd/Ctrl+Shift+A binding in UI).

- `POST /api/documents/:docId/cursor`
  - Body: `{ position, selection?, action }`
  - Upserts cursor/presence heartbeat.

- `POST /api/documents/:docId/comments`
  - Body: `{ from, to, text, selectedText? }`

- `POST /api/documents/:docId/comments/:commentId/replies`
  - Body: `{ text }`

- `PATCH /api/documents/:docId/comments/:commentId`
  - Body: `{ resolved }`

- `POST /api/documents/:docId/suggestions`
  - Body: `{ from, to, type, originalText, suggestedText, reason? }`

- `PATCH /api/documents/:docId/suggestions/:suggestionId`
  - Body: `{ status: 'accepted'|'rejected' }`
  - Accept mutates text only if source supports write.

- `POST /api/documents/:docId/review`
  - Body: `{ mode: 'style'|'grammar'|'technical'|'security' }`
  - Triggers OpenClaw review job and returns run ID.

- `GET /api/documents/:docId/review/:runId`
  - Returns structured review findings and suggested fixes.

### WebSocket Event Contract Additions
Extend existing ws message union:
- `document:cursor`
- `document:presence`
- `document:edited`
- `document:authorship`
- `document:comment:created`
- `document:comment:replied`
- `document:comment:resolved`
- `document:suggestion:created`
- `document:suggestion:updated`
- `document:review:completed`
- `document:follow:detached`

All events include `docId`, `sourceId`, `path`, `actor`, `timestamp`, and minimal payload for incremental UI updates.

## Type and Schema Additions

### Frontend Types
Add `packages/app/src/types/editor-collab.ts`:
- `AgentId = 'human'|'ada'|'spock'|'scotty'|'system'`
- `AuthoredRange`
- `DocumentAuthorshipStats`
- `DocumentComment`, `DocumentCommentReply`
- `DocumentSuggestion`
- `AgentPresence`, `AgentCursor`
- `DocumentReviewRun`, `DocumentReviewFinding`

### Server Types
Add `packages/server/src/editor/types.ts` with strict runtime-validated payload contracts.

### DB Schema (SQLite, canonical metadata)
Extend `packages/db/src/index.ts` bootstrap with additive tables/indexes:

- `document_sessions`
  - `id`, `doc_id`, `source_id`, `path`, `content_hash`, `version`, `updated_at`

- `document_authorship_ranges`
  - `id`, `doc_id`, `start_offset`, `end_offset`, `author`, `reviewed`, `created_at`, `updated_at`

- `document_authorship_history`
  - `id`, `doc_id`, `range_id`, `author`, `diff_json`, `timestamp`

- `document_presence`
  - `id`, `doc_id`, `agent_id`, `status`, `cursor_json`, `last_activity_at`

- `document_comments`
  - `id`, `doc_id`, `author`, `start_offset`, `end_offset`, `selected_text`, `text`, `resolved`, `created_at`, `updated_at`

- `document_comment_replies`
  - `id`, `comment_id`, `author`, `text`, `created_at`

- `document_suggestions`
  - `id`, `doc_id`, `author`, `type`, `start_offset`, `end_offset`, `original_text`, `suggested_text`, `reason`, `status`, `created_at`, `updated_at`

- `document_review_runs`
  - `id`, `doc_id`, `requested_by`, `mode`, `status`, `result_json`, `created_at`, `updated_at`

- `agent_tokens`
  - `id`, `token_hash`, `token_type` (`agent`|`service`), `actor`, `scopes_json`, `enabled`, `created_at`, `updated_at`

Indexes:
- `doc_id` and `updated_at` indexes on every document metadata table.
- Unique index on `(token_hash)` and `(token_type, actor)` where appropriate.

## Backend Implementation Plan

### 1) Add editor module boundaries
Create module root:
- `packages/server/src/editor/index.ts`
- `packages/server/src/editor/routes.ts`
- `packages/server/src/editor/ws.ts`
- `packages/server/src/editor/auth.ts`
- `packages/server/src/editor/service.ts`

Server wiring:
- Register `/api/documents/*` routes from `packages/server/src/index.ts`.
- Reuse existing ws server, add event broadcaster wrappers for document channels.

### 2) Build auth middleware with dual-token support
- Middleware extracts bearer token.
- Hash and compare token against `agent_tokens` table.
- For service tokens, require `X-Entity-Actor`, validate actor allowlist, attach resolved actor identity to request context.
- Enforce scope checks per endpoint (`documents:edit`, `documents:comment`, `documents:review`, etc.).

### 3) Implement repository layer in DB package
Add files:
- `packages/db/src/document-collab.ts`
- `packages/db/src/agent-tokens.ts`

Responsibilities:
- CRUD and list operations for authorship/presence/comments/suggestions/review runs.
- Offset normalization and lightweight validation helpers.
- Upsert semantics for presence/heartbeat.

### 4) Integrate source capability checks
- For mutation endpoints, resolve source capability via existing FS adapter registry when `sourceId` is present.
- If `write=false`, return typed `403` with `code: SOURCE_READ_ONLY`.
- Preserve overlay-only actions for comments/suggestions/presence on read-only sources.

### 5) OpenClaw integration for review and mention replies
- Add review dispatcher that posts review jobs to OpenClaw with document context and mode.
- Receive callback (or polling completion) and persist structured findings in `document_review_runs.result_json`.
- Extend mention workflow to support thread replies in comment context.

## Frontend Implementation Plan

### 1) CodeMirror extension architecture
Refactor `packages/app/src/components/CodeMirrorEditor.tsx` to accept collaboration props:
- `authorshipRanges`
- `remoteCursors`
- `suggestions`
- `comments`
- `onCursorChange`
- `onCommentCreate`
- `onSuggestionAction`

Implement new CodeMirror extensions:
- Authorship decorations with per-agent color mapping.
- Cursor markers with labels.
- Suggestion markups (insert/delete/replace styling).
- Comment anchor decorations.

### 2) New state hooks
Add hooks:
- `packages/app/src/hooks/useDocumentCollab.ts`
  - REST + websocket sync for document state.
- `packages/app/src/hooks/useFollowMode.ts`
  - Followed agent, detach behavior, smooth scroll orchestration.
- `packages/app/src/hooks/useAgentPresence.ts`
  - Presence heartbeat + status aging (active/idle/disconnected).

### 3) App shell integration
Update `packages/app/src/App.tsx`:
- Replace coarse `watchMode/followingAgent` behavior with document-aware follow mode.
- Add authorship sidebar stats and review percentage.
- Add agent presence chips in editor header.
- Add comments/suggestions/review toolbar actions.
- Keep current mobile/desktop split; on mobile, collapse side panels into drawers.

### 4) UI components
Add components:
- `packages/app/src/components/editor/AuthorshipStatsPanel.tsx`
- `packages/app/src/components/editor/PresenceChips.tsx`
- `packages/app/src/components/editor/CommentsPanel.tsx`
- `packages/app/src/components/editor/SuggestionsPanel.tsx`
- `packages/app/src/components/editor/ReviewPanel.tsx`
- `packages/app/src/components/editor/FollowControls.tsx`

### 5) Keyboard shortcuts
- `Cmd/Ctrl+Shift+A`: toggle authorship for selected range.
- `Cmd/Ctrl+Shift+C`: create comment from selection.
- `Esc`: detach follow mode.
- Maintain existing save shortcut behavior.

## Operational and Rollout Plan

### Feature Flags
- `ENTITY_AGENT_NATIVE_EDITOR` (server)
- `VITE_ENTITY_AGENT_NATIVE_EDITOR` (client)
- `ENTITY_AGENT_NATIVE_EDITOR_OVERLAYS_ONLY_ON_READONLY=true` (default)

### Rollout Steps
1. Deploy backend module dark (flag off).
2. Enable in local dev with seeded tokens and smoke checks.
3. Enable for internal operator environment.
4. Monitor metrics/events/errors for 48h.
5. Expand to wider workflows and remove legacy watch-only paths.

### Rollback
- Disable both flags.
- Existing file editing and MC flows remain unchanged.
- Document metadata remains in DB; no destructive migration required.

## Security and Abuse Controls
- Token hashes only, never raw token persistence.
- Strict actor resolution for service tokens.
- Source capability check before any mutation.
- Request size limits for comment/suggestion/review payloads.
- Audit log records for each mutation and review action.

## Tests and Acceptance Scenarios

### Build/Typecheck Gates
- `npm --prefix packages/db run build`
- `npm --prefix packages/server run build`
- `npm --prefix packages/app run build`

### API Scenarios
1. Agent token can edit writable local doc and emits websocket updates.
2. Service token without `X-Entity-Actor` is rejected.
3. Service token with unknown actor is rejected.
4. Service token with known actor succeeds and attribution is correct.
5. Read-only source rejects edit apply with `SOURCE_READ_ONLY`.
6. Read-only source accepts comment/suggestion creation.
7. Suggestion accept mutates text only for writable sources.
8. Review run transitions from `running` to `completed` and returns findings.

### UI Scenarios
1. Authorship colors render correctly and stats update live.
2. Follow mode scrolls to selected agent cursor and detaches on click/Esc.
3. Follow glow color and typing pulse match active agent.
4. Presence chips reflect active/idle/disconnected states.
5. Comments thread create/reply/resolve works.
6. Track changes accept/reject works on writable source.
7. Read-only source shows overlays and disabled apply controls.
8. Mobile layout keeps editor functional with collapsible collaboration panels.

### End-to-End Scenario
- Ada (agent token) edits writable doc; Henry follows cursor; Henry adds comment; Spock replies; Scotty submits suggestion; Henry accepts suggestion; review run completes and applies selected finding.

## Implementation Sequence (Dependency-Ordered)

### Sprint A - Foundations
- Add DB schema and repositories.
- Add auth middleware and token model.
- Add document routes skeleton and ws events.

### Sprint B - P0 Core
- Authorship tracking + UI stats.
- Cursor presence + follow mode + follow glow.
- Capability-aware mutation guardrails.

### Sprint C - P1 Collaboration
- Suggestions (track changes) with accept/reject.
- Comments threads + mentions.
- Presence chips and join/leave toasts.

### Sprint D - P1 Review + Parity
- Review run pipeline and panel.
- Finalize parity endpoints/tool semantics.
- End-to-end scenario validation and rollout docs.

## Ralph Loop Execution Plan

### Ralph Artifacts
- PRD JSON: `scripts/ralph/mc-agent-native-editor-prd.json`
- Prompt file: `scripts/ralph/mc-agent-native-editor-prompt.md`
- Runner: `scripts/ralph/run-mc-agent-native-editor.sh`
- Progress log: `scripts/ralph/mc-agent-native-editor-progress.txt`

### 50% Frontend Checkpoint
- Runner pauses automatically at 50% completed stories and prints a checkpoint alert.
- At checkpoint, frontend test checklist:
  - Load editor in desktop + mobile breakpoints.
  - Verify follow mode detach and glow behavior.
  - Verify authorship color map and sidebar stats.
  - Verify comments/suggestions panels render and basic actions work.

### Definition of Done
- All Ralph stories marked `passes: true`.
- Build gates pass for app/server/db.
- Critical manual checkpoint verified at 50% and at final pass.
- Session/timeline docs updated with outcomes and residual risks.

## Assumptions
- Existing OpenClaw endpoints remain reachable and can accept review/comment context payloads.
- CodeMirror extensions can be incrementally added without replacing editor foundation.
- Current websocket transport can handle new event volume without immediate channel partitioning.
- Read-only source behavior is acceptable as overlays-only for v1 text mutation flows.
