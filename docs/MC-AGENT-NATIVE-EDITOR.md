# Entity Agent-Native Editor PRD

> Bring Proof-inspired agent-native editing to Entity, powered by Enterprise agents

## Problem Statement

Entity has a markdown editor (CodeMirrorEditor) and file browser, but lacks agent-native collaboration features. When Ada, Spock, or Scotty edit documents, there's no:
- Visual indication of who wrote what (human vs AI)
- Way to watch agents work in real-time (follow mode)
- Collaborative editing features (comments, track changes)
- Agent presence indicators
- Review system for quality checks

Proof (by Every) demonstrated these features in their demo. Entity should adopt them with a key advantage: our agents (Ada, Spock, Scotty) are native to the platform, not external connections.

## Vision

Entity becomes the agent-native workspace where Enterprise agents collaborate with Henry in real-time. You open a document, see Ada's purple text, follow Spock's research cursor, review Scotty's code suggestions - all in one place.

**Key differentiator from Proof:** Enterprise agents ARE the agents. No external protocol. No terminal bridge. Ada, Spock, Scotty live inside Entity.

---

## P0 Features - Must Have

### 1. Authorship Tracking

**What:** Every text section tracks who wrote it - human or which agent.

**Visual:**
- Human text: normal white/default
- Ada text: purple highlight
- Spock text: blue highlight  
- Scotty text: green highlight
- Authorship sidebar: "Written by: Human 40% | Ada 35% | Spock 25%"

**Data Model:**
```typescript
interface AuthoredSection {
  id: string;
  content: string;
  author: 'human' | 'ada' | 'spock' | 'scotty';
  authorLabel: string;
  timestamp: number;
  reviewed: boolean;
  editHistory: Array<{
    author: string;
    timestamp: number;
    diff: string;
  }>;
}

interface DocumentAuthorship {
  sections: AuthoredSection[];
  stats: {
    human: number;    // percentage
    ada: number;
    spock: number;
    scotty: number;
  };
  reviewedPercent: number;
}
```

**Implementation:**
- Store authorship metadata per paragraph/block in document model
- CodeMirror decorations for color-coded highlighting
- Sidebar widget showing authorship breakdown
- Mark sections as "reviewed" when human clicks/edits them
- Manual toggle: Cmd+Shift+A to flip authorship attribution

### 2. Follow Mode

**What:** Auto-scroll to agent's active edit position. "Watch Ada work."

**Visual:**
- Toggle button per agent: "Follow Ada" / "Following Ada..."
- Editor auto-scrolls to agent's cursor position
- Smooth scrolling animation
- Click anywhere to detach

**Data Model:**
```typescript
interface AgentCursor {
  agentId: string;
  documentId: string;
  position: { line: number; ch: number };
  selection?: { from: Position; to: Position };
  action: 'typing' | 'selecting' | 'idle';
  timestamp: number;
}
```

**Implementation:**
- WebSocket broadcasts agent cursor positions (useWebSocket.ts exists)
- `useFollowMode` hook tracks which agent you're following
- CodeMirror scrollIntoView on cursor updates
- Debounce scroll updates (100ms)
- ESC or click to unfollow

### 3. Follow Glow

**What:** Visual border glow when attached to an agent.

**Visual:**
- Purple glow for Ada, blue for Spock, green for Scotty
- Pulsing animation when agent is actively typing
- Solid glow when idle but still connected

**Implementation:**
```css
.following-ada {
  box-shadow: 0 0 20px rgba(168, 85, 247, 0.6);
  border: 1px solid rgba(168, 85, 247, 0.4);
  transition: box-shadow 0.3s ease;
}
.following-ada.agent-typing {
  animation: pulse-purple 1.5s ease-in-out infinite;
}
.following-spock {
  box-shadow: 0 0 20px rgba(59, 130, 246, 0.6);
  border: 1px solid rgba(59, 130, 246, 0.4);
}
.following-scotty {
  box-shadow: 0 0 20px rgba(34, 197, 94, 0.6);
  border: 1px solid rgba(34, 197, 94, 0.4);
}
```

---

## P1 Features - Should Have

### 4. Track Changes

**What:** Suggest-edit mode like Google Docs. Agents propose changes, human accepts/rejects.

**Visual:**
- Strikethrough for deletions, underline for additions
- Accept/Reject buttons inline
- "Accept All" / "Reject All" bulk actions
- Each suggestion attributed to an agent

**Data Model:**
```typescript
interface Suggestion {
  id: string;
  author: string;
  type: 'insert' | 'delete' | 'replace';
  position: { from: Position; to: Position };
  originalText: string;
  suggestedText: string;
  status: 'pending' | 'accepted' | 'rejected';
  timestamp: number;
  reason?: string;
}
```

### 5. Comments System

**What:** Inline threaded comments. @mention agents to ask questions.

**Visual:**
- Highlight text, click "Comment" (or Cmd+Shift+C)
- Comment bubble in right margin
- Thread replies
- @ada, @spock, @scotty mentions trigger agent response

**Data Model:**
```typescript
interface Comment {
  id: string;
  author: string;
  text: string;
  position: { from: Position; to: Position };
  selectedText: string;
  replies: CommentReply[];
  resolved: boolean;
  timestamp: number;
}

interface CommentReply {
  id: string;
  author: string;
  text: string;
  timestamp: number;
}
```

**Agent Integration:**
- @mention triggers OpenClaw webhook
- Agent reads document + comment context
- Agent replies in the thread
- Human resolves when satisfied

### 6. Agent Presence

**What:** See which agents are "in" the document.

**Visual:**
- Agent avatars in top-right corner (Ada 🔮, Spock 🖖, Scotty 🔧)
- Colored dot: green = active, yellow = idle, gray = disconnected
- Toast notification: "Ada joined" / "Scotty finished editing"
- Cursor labels in document gutter

**Data Model:**
```typescript
interface AgentPresence {
  agentId: string;
  name: string;
  emoji: string;
  color: string;
  status: 'active' | 'idle' | 'disconnected';
  lastActivity: number;
  currentDocument?: string;
}
```

### 7. Review System

**What:** Agents run quality/style checks on documents.

**Visual:**
- "Review" dropdown menu in toolbar
- Options: "Style Guide", "Grammar", "Technical Review", "Security Review"
- Results show inline with highlights and "Apply" buttons
- Review summary panel

**Implementation:**
- Review configs stored as markdown skill files
- Trigger sends document + review config to agent
- Agent returns structured suggestions
- UI renders inline with accept/reject

---

## P1 Features - Agent-Native Capabilities

### 8. Parity Principle

**What:** Anything a human can do via UI, an agent can do via API.

Every UI action has a corresponding API endpoint:
```
POST /api/documents/:id/edit     - Edit text
POST /api/documents/:id/comment  - Add comment
POST /api/documents/:id/suggest  - Suggest change
POST /api/documents/:id/review   - Run review
GET  /api/documents/:id/cursor   - Get/set cursor
DELETE /api/documents/:id/comments - Clear comments
```

### 9. Granular Agent Tools

Agents get modular document tools they can combine:
- `read_section(doc, range)` - Read specific section
- `replace_section(doc, range, text)` - Replace text
- `add_comment(doc, range, text)` - Add comment
- `suggest_edit(doc, range, newText, reason)` - Propose change
- `move_cursor(doc, position)` - Move cursor (triggers follow mode)
- `set_authorship(doc, range, author)` - Set authorship

---

## How Enterprise Agents Connect

**No external protocol needed.** Agents connect via existing OpenClaw infrastructure:

1. **Agent receives task** (via OpenClaw session or @mention)
2. **Agent calls Entity API** (authenticated via agent token)
3. **Entity broadcasts via WebSocket** (cursor, edits, presence)
4. **Human sees agent working in real-time** (follow mode, authorship, glow)

```
Henry (Entity UI) ←→ WebSocket ←→ Entity Server ←→ OpenClaw API ←→ Ada/Spock/Scotty
```

Each agent gets:
- Unique color (Ada=purple, Spock=blue, Scotty=green)
- Unique emoji avatar (🔮, 🖖, 🔧)
- Own cursor in the document
- Attributed authorship on all edits

---

## Implementation Phases

### Phase 1: Authorship + Follow (Week 1)
- Document model with authorship metadata
- CodeMirror decorations for color-coded text
- Authorship sidebar widget
- WebSocket cursor broadcasting
- Follow mode hook + UI toggle
- Follow glow CSS

### Phase 2: Presence + Comments (Week 2)
- Agent presence indicators (avatars, status dots)
- Toast notifications for agent events
- Comments system (add, reply, resolve)
- @mention agent trigger

### Phase 3: Track Changes + Review (Week 3)
- Suggest-edit mode toggle
- Inline suggestion UI (accept/reject)
- Review system with configurable checks
- Review results rendering

### Phase 4: Agent API + Parity (Week 4)
- Document manipulation API endpoints
- Agent tool definitions
- Real-time bidirectional editing
- End-to-end test: Ada edits doc, Henry watches and reviews

---

## Existing Codebase References

| What | Where |
|------|-------|
| Editor | `packages/app/src/components/CodeMirrorEditor.tsx` |
| Preview | `packages/app/src/components/MarkdownPreview.tsx` |
| File tree | `packages/app/src/components/FileTree.tsx` |
| WebSocket | `packages/app/src/hooks/useWebSocket.ts` |
| HTTP client | `packages/app/src/lib/http.ts` |
| Server | `packages/server/src/index.ts` |
| MC components | `packages/app/src/components/mission-control/` |

---

## Success Metrics

1. **Authorship clarity:** Henry can identify AI vs human text at a glance
2. **Follow mode usage:** Used in 50%+ of agent editing sessions
3. **Review adoption:** Style guide checks run on every document before sharing
4. **Agent presence:** All 3 agents show real-time presence when active
5. **Trust:** Henry reviews 100% of agent-written content before shipping

---

*PRD created 2026-02-08. Based on Proof demo analysis + Entity codebase.*
*Source: https://www.youtube.com/watch?v=5YBjll9XJlw (10:00-28:00)*
