# PRD: DocHub Agent Collaboration - Feature Parity with Proof Editor

## Overview

**Project:** DocHub Agent Collaboration Features  
**Goal:** Add agent collaboration capabilities to Entity's DocHub feature to match or exceed Proof Editor (proofeditor.ai) functionality  
**Priority:** P1 - Enables external agent collaboration and multi-agent workflows  
**Estimated Effort:** 3-5 sprints (may vary)  
**Owner:** Ada / Geordi  

---

## Problem Statement

DocHub currently provides a unified file dashboard and document viewing, but lacks the agent collaboration primitives that Proof Editor excels at:

1. **No external agent API** — External agents (Claude Code, Codex, Cursor, Windsurf) cannot collaborate with DocHub documents programmatically
2. **No shareable document links** — Documents are workspace-locked, no instant sharing with token-based access
3. **No provenance tracking at character level** — We have authorship stats but not per-character attribution in the editor gutter
4. **No structured edit operations API** — Agents must use the UI or hack around the frontend
5. **No event polling for async agent workflows** — Real-time only, no async/queue-based workflows for agents
6. **No multi-agent skill distribution** — No self-documenting skill for external agents to discover our API

---

## Goals

### Primary Goals

1. **Enable external agent collaboration** — Any agent can read/write DocHub documents via HTTP API
2. **Match Proof's agent collaboration features** — Feature parity on: presence, comments, suggestions, provenance
3. **Add shareable document links** — Token-based document sharing without workspace membership
4. **Support async agent workflows** — Event polling + ack for queue-based agent collaboration

### Secondary Goals

5. **Self-documenting API** — Agent discovery endpoint (`.well-known/agent.json`)
6. **Publish DocHub skill** — SKILL.md for Claude Code, Codex, Cursor, Windsurf
7. **Block-based editing with revision locking** — More robust than string-matching

---

## Feature Specification

### 1. Agent HTTP API

#### 1.1 Document Creation

**Endpoint:** `POST /api/documents`

```bash
curl -X POST https://entity.example.com/api/documents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "title": "My Document",
    "content": "# Hello\n\nFirst draft.",
    "visibility": "private" | "shared"
  }'
```

**Response:**
```json
{
  "id": "doc_abc123",
  "slug": "abc123xyz",
  "title": "My Document",
  "shareUrl": "https://entity.example.com/d/abc123xyz?token=tk_xyz789",
  "accessToken": "tk_xyz789",
  "createdAt": "2026-02-21T12:00:00Z",
  "_links": {
    "self": "/api/documents/abc123xyz",
    "state": "/api/documents/abc123xyz/state",
    "ops": "/api/documents/abc123xyz/ops",
    "edit": "/api/documents/abc123xyz/edit",
    "snapshot": "/api/documents/abc123xyz/snapshot",
    "events": "/api/documents/abc123xyz/events/pending"
  }
}
```

#### 1.2 Document Reading

**Endpoints:**

| Method | URL | Description |
|--------|-----|-------------|
| GET | `/api/documents/<slug>` | Read document (JSON or markdown via content negotiation) |
| GET | `/api/documents/<slug>/state` | Full state including metadata, links, authors |
| GET | `/api/documents/<slug>/snapshot` | Block-based snapshot with revision numbers |

**Content Negotiation:**
```bash
# JSON response
curl -H "Accept: application/json" "https://entity.example.com/api/documents/abc123xyz?token=tk_xyz789"

# Raw markdown
curl -H "Accept: text/markdown" "https://entity.example.com/api/documents/abc123xyz?token=tk_xyz789"
```

**JSON Response Format:**
```json
{
  "id": "doc_abc123",
  "slug": "abc123xyz",
  "title": "My Document",
  "content": "# Hello\n\nFirst draft.",
  "authors": [
    { "name": "human", "type": "human", "percent": 62 },
    { "name": "geordi", "type": "ai", "percent": 38 }
  ],
  "revision": 42,
  "updatedAt": "2026-02-21T12:00:00Z",
  "_links": {
    "ops": "/api/documents/abc123xyz/ops",
    "edit": "/api/documents/abc123xyz/edit",
    "editV2": "/api/documents/abc123xyz/edit/v2",
    "snapshot": "/api/documents/abc123xyz/snapshot",
    "events": "/api/documents/abc123xyz/events/pending",
    "presence": "/api/documents/abc123xyz/presence"
  }
}
```

#### 1.3 Authentication Methods

Support multiple auth patterns to match Proof:

| Method | Example |
|--------|---------|
| Bearer token | `Authorization: Bearer <token>` |
| X-Share-Token header | `X-Share-Token: <token>` |
| Query param | `?token=<token>` |

---

### 2. Edit Operations

#### 2.1 Edit V1 - String-Based Operations

**Endpoint:** `POST /api/documents/<slug>/edit`

**Operations:**

| Op | Parameters | Description |
|----|------------|-------------|
| `append` | `section`, `content` | Append content to section (matched by heading) |
| `replace` | `search`, `content` | Find and replace text |
| `insert` | `after`, `content` | Insert after anchor text |

**Request:**
```bash
curl -X POST "https://entity.example.com/api/documents/abc123xyz/edit" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "by": "ai:geordi",
    "operations": [
      { "op": "append", "section": "Notes", "content": "\n\nNew note." },
      { "op": "replace", "search": "old text", "content": "new text" }
    ]
  }'
```

**Response:**
```json
{
  "success": true,
  "slug": "abc123xyz",
  "revision": 43,
  "updatedAt": "2026-02-21T12:05:00Z",
  "collabApplied": true
}
```

**Optimistic Locking (Optional):**
```json
{
  "by": "ai:geordi",
  "baseUpdatedAt": "2026-02-21T12:00:00Z",
  "operations": [...]
}
```

If document changed since `baseUpdatedAt`, returns `409 STALE_BASE` with retry info.

#### 2.2 Edit V2 - Block-Based with Revision Locking

**Endpoint:** `POST /api/documents/<slug>/edit/v2`

**Get Snapshot First:**
```bash
curl -H "Authorization: Bearer <token>" \
  "https://entity.example.com/api/documents/abc123xyz/snapshot"
```

**Response:**
```json
{
  "revision": 42,
  "blocks": [
    { "id": "b1", "markdown": "# Hello" },
    { "id": "b2", "markdown": "\n\nFirst draft." }
  ],
  "updatedAt": "2026-02-21T12:00:00Z"
}
```

**Apply Block Operations:**
```bash
curl -X POST "https://entity.example.com/api/documents/abc123xyz/edit/v2" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -H "Idempotency-Key: <uuid>" \
  -d '{
    "by": "ai:geordi",
    "baseRevision": 42,
    "operations": [
      { "op": "replace_block", "ref": "b2", "block": { "markdown": "Updated paragraph." } },
      { "op": "insert_after", "ref": "b2", "blocks": [{ "markdown": "## New Section" }] }
    ]
  }'
```

**Supported Operations:**

| Op | Parameters | Description |
|----|------------|-------------|
| `replace_block` | `ref`, `block` | Replace a block by ID |
| `insert_before` | `ref`, `blocks` | Insert blocks before a ref |
| `insert_after` | `ref`, `blocks` | Insert blocks after a ref |
| `delete_block` | `ref` | Delete a block |
| `replace_range` | `startRef`, `endRef`, `blocks` | Replace range of blocks |
| `find_replace_in_block` | `ref`, `search`, `content` | Find/replace within block |

**Conflict Resolution:**
- If `baseRevision` is stale: `409 STALE_REVISION` with fresh snapshot
- Retry with latest revision

---

### 3. Ops API (Comments, Suggestions, Rewrite)

#### 3.1 Comments

**Endpoint:** `POST /api/documents/<slug>/ops`

```bash
curl -X POST "https://entity.example.com/api/documents/abc123xyz/ops" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "type": "comment.add",
    "by": "ai:geordi",
    "quote": "text to anchor comment to",
    "text": "Comment body - suggestion or question"
  }'
```

#### 3.2 Suggestions (Track Changes)

```bash
curl -X POST "https://entity.example.com/api/documents/abc123xyz/ops" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "type": "suggestion.add",
    "by": "ai:geordi",
    "kind": "replace",
    "quote": "old text",
    "content": "new text"
  }'
```

**Suggestion Kinds:** `replace`, `insert`, `delete`

#### 3.3 Full Document Rewrite

```bash
curl -X POST "https://entity.example.com/api/documents/abc123xyz/ops" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "type": "rewrite.apply",
    "by": "ai:geordi",
    "content": "# Completely new document\n\nAll new content."
  }'
```

---

### 4. Provenance Tracking

#### 4.1 Author Attribution

Every write operation must include a `by` field:

| Author Type | Format | Example |
|-------------|--------|---------|
| Human | `human:<name>` | `human:henry` |
| AI Agent | `ai:<agent-name>` | `ai:geordi`, `ai:claude-code`, `ai:codex` |

#### 4.2 Authorship Stats

The document state includes authorship breakdown:

```json
{
  "authors": [
    { "name": "human:henry", "type": "human", "percent": 62 },
    { "name": "ai:geordi", "type": "ai", "percent": 38 }
  ]
}
```

#### 4.3 Gutter Visualization (UI)

**Component:** Add to `CodeMirrorEditor` or create `ProvenanceGutter`

**Display:**
- Left gutter shows author for each block/paragraph
- Color-coded by author (configurable colors per author)
- Summary bar at top: "Human 62% · AI 38%"
- Tooltip on hover shows exact author + timestamp

**Implementation:**
- Reuse existing `AuthorshipStatsPanel` but make it inline in editor
- Store authorship data per-block in the document model
- Render authorship indicators in CodeMirror gutter

---

### 5. Presence System

#### 5.1 Agent Presence API

**Endpoint:** `POST /api/documents/<slug>/presence`

```bash
curl -X POST "https://entity.example.com/api/documents/abc123xyz/presence" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "status": "thinking",
    "summary": "Reviewing section 2"
  }'
```

**Status Values:**

| Status | Meaning |
|--------|---------|
| `reading` | Agent is reading the document |
| `thinking` | Agent is analyzing/forming response |
| `acting` | Agent is making edits |
| `waiting` | Agent is waiting for human input |
| `completed` | Agent finished its task |
| `error` | Agent encountered an error |

#### 5.2 Presence Display (UI)

**Component:** Extend `PresenceChips` component

**Display:**
- Avatar + agent name + status text
- Color-coded status indicator (green=active, yellow=thinking, gray=waiting, red=error)
- Click to see full summary

---

### 6. Event Polling

#### 6.1 Poll for Events

**Endpoint:** `GET /api/documents/<slug>/events/pending?after=<cursor>&limit=100`

```bash
curl "https://entity.example.com/api/documents/abc123xyz/events/pending?after=0&limit=50" \
  -H "Authorization: Bearer <token>"
```

**Response:**
```json
{
  "events": [
    {
      "id": 1,
      "type": "comment.added",
      "by": "human:henry",
      "quote": "old text",
      "text": "Great point!",
      "timestamp": "2026-02-21T12:00:00Z"
    },
    {
      "id": 2,
      "type": "suggestion.added",
      "by": "ai:geordi",
      "quote": "old",
      "content": "new",
      "kind": "replace",
      "timestamp": "2026-02-21T12:01:00Z"
    },
    {
      "id": 3,
      "type": "presence.updated",
      "by": "ai:claude-code",
      "status": "thinking",
      "summary": "Analyzing the proposal",
      "timestamp": "2026-02-21T12:02:00Z"
    }
  ],
  "nextCursor": 3
}
```

#### 6.2 Acknowledge Events

**Endpoint:** `POST /api/documents/<slug>/events/ack`

```bash
curl -X POST "https://entity.example.com/api/documents/abc123xyz/events/ack" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "upToId": 3,
    "by": "ai:geordi"
  }'
```

---

### 7. Shareable Document Links

#### 7.1 Create Shared Document

**Option A:** Create with `visibility: shared`
```bash
curl -X POST "/api/documents" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "title": "Collab Doc",
    "content": "# Hello",
    "visibility": "shared"
  }'
```

**Option B:** Make existing document shared
```bash
curl -X PATCH "/api/documents/abc123xyz" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "visibility": "shared" }'
```

**Response includes:**
```json
{
  "slug": "abc123xyz",
  "shareUrl": "https://entity.example.com/d/abc123xyz?token=tk_xyz789",
  "accessToken": "tk_xyz789"
}
```

#### 7.2 Access Shared Document

Shared documents can be accessed by anyone with the token:

```bash
# Via query param
curl "https://entity.example.com/api/documents/abc123xyz?token=tk_xyz789"

# Via header
curl "https://entity.example.com/api/documents/abc123xyz" \
  -H "X-Share-Token: tk_xyz789"

# Via Bearer
curl "https://entity.example.com/api/documents/abc123xyz" \
  -H "Authorization: Bearer tk_xyz789"
```

#### 7.3 Revoke Access

```bash
curl -X PATCH "/api/documents/abc123xyz" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{ "visibility": "private" }'
```

---

### 8. Agent Discovery

#### 8.1 Well-Known Discovery Endpoint

**Endpoint:** `GET /.well-known/agent.json`

```json
{
  "name": "Entity DocHub",
  "description": "Agent-native document collaboration with provenance tracking",
  "apiBase": "https://entity.example.com/api",
  "version": "1.0.0",
  "endpoints": {
    "create": "/documents",
    "read": "/documents/{slug}",
    "state": "/documents/{slug}/state",
    "edit": "/documents/{slug}/edit",
    "editV2": "/documents/{slug}/edit/v2",
    "ops": "/documents/{slug}/ops",
    "snapshot": "/documents/{slug}/snapshot",
    "events": "/documents/{slug}/events/pending",
    "presence": "/documents/{slug}/presence"
  },
  "auth": {
    "bearer": true,
    "header": "X-Share-Token",
    "query": "token"
  },
  "features": [
    "provenance",
    "comments",
    "suggestions",
    "rewrite",
    "presence",
    "events",
    "block_editing",
    "revision_locking"
  ]
}
```

---

### 9. Agent Skills

#### 9.1 Publish SKILL.md

Create `skills/docup-agent/SKILL.md` for external agents:

```markdown
---
name: docup
description: Agent collaboration with Entity DocHub documents. Create, read, edit, comment, suggest, and track provenance in shared documents.
---

# Entity DocHub

Agent-native document collaboration with provenance tracking.

## Core Concepts

- `by`: author identity — use `ai:<agent-name>` for AI, `human:<name>` for humans
- `slug + token`: shared documents addressed by slug, authenticated by token
- `marks`: comments and suggestions (track-changes style)
- `revision`: monotonic revision number for optimistic concurrency

## Authentication

Shared URL format: `https://entity.example.com/d/<slug>?token=<token>`

Use:
- `Authorization: Bearer <token>`
- `X-Share-Token: <token>`
- `?token=<token>`

## API Examples

### 1. Create Document

```bash
curl -X POST https://entity.example.com/api/documents \
  -H "Content-Type: application/json" \
  -d '{"title":"My Doc","content":"# Hello\n\nFirst draft."}'
```

### 2. Read Document

```bash
curl -H "Accept: application/json" \
  "https://entity.example.com/api/documents/<slug>?token=<token>"
```

### 3. Edit (Block-Based)

```bash
# Get snapshot first
curl "https://entity.example.com/api/documents/<slug>/snapshot" \
  -H "Authorization: Bearer <token>"

# Apply edits
curl -X POST "https://entity.example.com/api/documents/<slug>/edit/v2" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "by": "ai:your-agent",
    "baseRevision": 42,
    "operations": [
      {"op": "replace_block", "ref": "b2", "block": {"markdown": "Updated."}}
    ]
  }'
```

### 4. Add Comment

```bash
curl -X POST "https://entity.example.com/api/documents/<slug>/ops" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"type":"comment.add","by":"ai:your-agent","quote":"text","text":"comment"}'
```

### 5. Suggest Edit

```bash
curl -X POST "https://entity.example.com/api/documents/<slug>/ops" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"type":"suggestion.add","by":"ai:your-agent","kind":"replace","quote":"old","content":"new"}'
```

### 6. Set Presence

```bash
curl -X POST "https://entity.example.com/api/documents/<slug>/presence" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"status": "thinking", "summary": "Reviewing section 2"}'
```

### 7. Poll Events

```bash
curl "https://entity.example.com/api/documents/<slug>/events/pending?after=0" \
  -H "Authorization: Bearer <token>"
```

## Status Values

- `reading` — agent is reading
- `thinking` — agent is analyzing
- `acting` — agent is editing
- `waiting` — waiting for human
- `completed` — task done
- `error` — something went wrong

## Full Docs

https://entity.example.com/docs/agent-api
```

---

## Technical Implementation

### Database Schema Changes

```sql
-- Documents table (extend)
ALTER TABLE documents ADD COLUMN slug VARCHAR(12) UNIQUE;
ALTER TABLE documents ADD COLUMN visibility VARCHAR(20) DEFAULT 'private';
ALTER TABLE documents ADD COLUMN access_token VARCHAR(64);
ALTER TABLE documents ADD COLUMN revision INTEGER DEFAULT 0;

-- Authorship tracking
CREATE TABLE document_authors (
  id SERIAL PRIMARY KEY,
  document_id UUID REFERENCES documents(id),
  author_name VARCHAR(100),
  author_type VARCHAR(20), -- 'human' or 'ai'
  character_count INTEGER DEFAULT 0,
  last_updated TIMESTAMP
);

-- Block-based content (for V2 editing)
CREATE TABLE document_blocks (
  id SERIAL PRIMARY KEY,
  document_id UUID REFERENCES documents(id),
  block_id VARCHAR(20), -- 'b1', 'b2', etc.
  content TEXT,
  author_name VARCHAR(100),
  position INTEGER,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(document_id, block_id)
);

-- Presence
CREATE TABLE document_presence (
  id SERIAL PRIMARY KEY,
  document_id UUID REFERENCES documents(id),
  author_name VARCHAR(100),
  status VARCHAR(20),
  summary TEXT,
  last_seen TIMESTAMP
);

-- Events
CREATE TABLE document_events (
  id SERIAL PRIMARY KEY,
  document_id UUID REFERENCES documents(id),
  event_type VARCHAR(50),
  author_name VARCHAR(100),
  payload JSONB,
  created_at TIMESTAMP
);
```

### API Routes to Create

| Method | Route | Handler |
|--------|-------|---------|
| POST | `/api/documents` | `createDocument` |
| GET | `/api/documents/:slug` | `getDocument` |
| GET | `/api/documents/:slug/state` | `getDocumentState` |
| GET | `/api/documents/:slug/snapshot` | `getDocumentSnapshot` |
| PATCH | `/api/documents/:slug` | `updateDocument` |
| DELETE | `/api/documents/:slug` | `deleteDocument` |
| POST | `/api/documents/:slug/edit` | `editDocument` |
| POST | `/api/documents/:slug/edit/v2` | `editDocumentV2` |
| POST | `/api/documents/:slug/ops` | `addOperation` |
| POST | `/api/documents/:slug/presence` | `setPresence` |
| GET | `/api/documents/:slug/events/pending` | `getPendingEvents` |
| POST | `/api/documents/:slug/events/ack` | `ackEvents` |

### Components to Create/Modify

| Component | Action | Description |
|-----------|--------|-------------|
| `ProvenanceGutter` | Create | Inline authorship indicators in editor |
| `PresenceChips` | Extend | Add agent presence with status + summary |
| `SharedDocumentViewer` | Create | Read-only viewer for shared links |
| `DocumentShareModal` | Create | UI for generating share links |

---

## Phasing

### Phase 1: Core API (Week 1-2)
- [ ] Document CRUD with slugs
- [ ] Token-based share access
- [ ] Edit V1 (append/replace/insert)
- [ ] Auth middleware for all endpoints

### Phase 2: Block Editing (Week 2-3)
- [ ] Edit V2 with block IDs
- [ ] Revision locking
- [ ] Snapshot endpoint

### Phase 3: Collaboration (Week 3-4)
- [ ] Ops API (comments, suggestions, rewrite)
- [ ] Presence system
- [ ] Event polling

### Phase 4: Provenance (Week 4-5)
- [ ] Per-block authorship tracking
- [ ] Authorship stats API
- [ ] Gutter visualization

### Phase 5: Developer Experience (Week 5-6)
- [ ] Agent discovery endpoint
- [ ] SKILL.md files for agents
- [ ] Documentation

---

## Success Metrics

| Metric | Target |
|--------|--------|
| External agent API calls | >100/day within 30 days |
| Share link usage | >50 active shared docs |
| Event poll requests | >500/day |
| Agent presence updates | >200/day |
| Comments/suggestions via API | >50/day |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Token security | High | Use secure random tokens, expiration options, audit logs |
| Conflict resolution complexity | Medium | Thorough testing of concurrent edits |
| Performance with large docs | Medium | Pagination, caching, optimize block queries |
| Breaking existing docs | High | Backward-compatible API, gradual rollout |

---

## Dependencies

- CodeMirror editor (existing)
- Entity auth system (existing)
- Document storage (existing)
- Frontend components (existing)

---

## Open Questions

1. **Token expiration?** — Should share tokens expire? Default TTL?
2. **Rate limiting?** — Need to prevent abuse of API endpoints
3. **Max document size?** — Block-based editing may have limits
4. **Real-time via websockets?** — Event polling is async; consider websockets for future
5. **Billing for shared docs?** — May need to track usage for pricing

---

## Appendix: API Reference

Full OpenAPI spec to be generated after implementation.

### Error Codes

| Code | Meaning |
|------|---------|
| 401 | Invalid/missing token |
| 403 | Token valid but no access |
| 404 | Document not found |
| 409 STALE_REVISION | Base revision is stale (v2) |
| 409 ANCHOR_NOT_FOUND | Search anchor not found (v1) |
| 422 | Invalid payload |
| 429 | Rate limited |

---

*PRD Version: 1.0*  
*Created: 2026-02-21*  
*Owner: Ada*
