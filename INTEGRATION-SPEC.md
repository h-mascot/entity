# Entity + Mission Control Integration - UX Analysis & Spec

## Current State Audit

### Mission Control (http://100.106.69.9:3000) - 4 Views:

1. **Ops View** (Default)
   - Kanban board: Backlog, Todo, Doing, Review, Done columns
   - Right sidebar: Due today, Live activity feed, Metrics
   - Filter bar: Agent buttons (Ada/Spock/Scotty/Henry/All), Priority dropdown, Projects dropdown
   - Due today + Daily view toggles
   - Recurring tasks count badge
   - Collapsible Insights panel
   - Collapsible Kanban panel
   - Task cards: title, description preview, assignee avatar, priority badge, due date
   - Click opens 2/3 detail panel (Asana-style)

2. **Strategic View**
   - Roadmaps section: Named roadmaps (Personal Website, Clawdbot Infrastructure, Fun Todos, Curacel Enterprise AI) with items, priorities, status
   - Recurring Tasks section: 16 recurring tasks with schedules
   - Add item / Create roadmap functionality
   - Same right sidebar persists

3. **Agents View**
   - Agent Activity Dashboard with refresh button
   - Per-agent cards: emoji, name, status (Working/Idle)
   - Current task with priority
   - Recent tool calls with timestamps
   - Shows all 3 agents: Ada, Spock, Scotty

4. **Admin** (External link to :3002)
   - Separate Next.js app
   - Agent config, SOUL.md editor, skills management
   - Currently basic

### Entity (http://100.86.150.96:5173) - 3 Tabs:

1. **Files** - Vault file tree with filter, sort, create
2. **Agents** - Basic agent list
3. **Tasks** - Basic kanban from MC API

### Gap Analysis - What Entity Is Missing:

| Feature | MC Has | Entity Has |
|---------|--------|------------|
| Ops Kanban | ✅ Full | ✅ Basic (no filters, no sidebar) |
| Strategic/Roadmaps | ✅ | ❌ |
| Agent Dashboard | ✅ Live activity | ❌ Basic list only |
| Filter bar | ✅ Agent/Priority/Project | ❌ |
| Right sidebar | ✅ Due today, Activity, Metrics | ❌ |
| Task detail panel | ✅ 2/3 Asana-style | ❌ |
| Search | ✅ | ❌ |
| Settings | ✅ | ❌ |
| Admin link | ✅ External | ❌ |
| New task creation | ✅ Modal with all fields | ❌ Basic input |

## UX Design Recommendations

### 1. Navigation Architecture

**Current Entity nav:** Files | Agents | Tasks (sidebar tabs)

**Proposed:** Keep the sidebar tabs but make Tasks expand into sub-views:

```
📁 Files
🤖 Agents  
📋 Tasks
   ├─ Ops (kanban)
   ├─ Strategic (roadmaps + recurring)
   └─ Agents (activity dashboard)
🔗 Admin →
```

**Why:** Entity's strength is the unified workspace. MC's views should nest under the Tasks concept, not replace the sidebar.

### 2. Ops View (Primary Task View)

When user clicks "Tasks" in sidebar, default to Ops view.

**Layout:**
```
┌─────────────────────────────────────────────────┐
│ [Ops] [Strategic] [Agents] [Admin→]    🔍 ⚙️    │
│ ─────────────────────────────────────────────── │
│ [Ada] [Spock] [Scotty] [Henry] [All]  P:All P:All│
│ [+ New Task]  [Due today] [Daily]  Recurring: 16│
├──────────────────────────────┬──────────────────┤
│                              │ Due Today        │
│   Kanban Columns             │ ────────────     │
│   Backlog | Todo | Doing     │ • Task 1  Feb 5  │
│   Review  | Done             │ • Task 2  Feb 5  │
│                              │                  │
│                              │ Metrics          │
│                              │ ────────────     │
│                              │ Total: 173       │
│                              │ Blocked: 0       │
│                              │ Review: 21       │
│                              │                  │
│                              │ Live Activity    │
│                              │ ────────────     │
│                              │ Ada: exec...     │
│                              │ Spock: read...   │
└──────────────────────────────┴──────────────────┘
```

### 3. Strategic View

Same sub-tab area, shows roadmaps and recurring tasks.

### 4. Agents View

Enhanced from MC's agent dashboard. Show:
- Agent cards with status (Working/Idle)
- Current task
- Recent activity stream
- Quick actions (assign task, view tasks)

### 5. Admin Link

Simple external link icon that opens :3002 in new tab. Small button, not a full view.

### 6. Design Principles

1. **Dark theme** - Match Entity's existing dark aesthetic
2. **Compact cards** - Entity has less width than MC standalone, so cards need to be tighter
3. **Responsive** - Must work on mobile (bottom nav: Files | Agents | Ops | Strategic)
4. **API reuse** - All data comes from MC API at 100.106.69.9:3000/api/*
5. **Real-time** - WebSocket for live activity and task updates
6. **Transitions** - Smooth tab switching, no page reloads
7. **Detail panel** - 2/3 slide-in from right (like MC) on task click

### 7. Mobile Considerations

On mobile (< 768px):
- Bottom nav bar: Files | Tasks | Agents
- Tasks opens to Ops kanban (swipeable columns)
- Tab switcher (Ops/Strategic/Agents) becomes a horizontal scroll
- Detail panel goes full-screen on mobile
- Filter bar collapses to a single filter icon

### 8. Color Palette (Dark Theme)

- Background: #0a0a0a (Entity existing)
- Card bg: #1a1a2e
- Active tab: #00d4ff (cyan accent)
- Text: #e0e0e0
- Muted: #888
- Borders: #2a2a3e
- Priority colors: P0=#ff4444, P1=#ff8800, P2=#4488ff, P3=#888888

## Implementation Notes

- Entity is a Vite + React app
- MC API base: http://100.106.69.9:3000/api
- Endpoints needed: /tasks, /tasks/:id, /roadmaps, /agents/activity, /metrics
- WebSocket: ws://100.106.69.9:3000 for live updates
- All existing Entity features (files, basic agents) stay untouched
- This adds to the Tasks tab functionality
