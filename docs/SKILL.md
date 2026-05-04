# Entity - Agent Skill Guide

**Any agent working on Entity MUST read this file first.**

Entity is the AI-native workspace for the Enterprise Crew. It includes Mission Control (task management), file editing, agent monitoring, and activity streams.

---

## Quick Reference

| Item | Value |
|------|-------|
| **Repo** | `~/Code/entity/` (Mac: 100.86.150.96) |
| **Dev server** | http://100.86.150.96:5173 |
| **MC API** | http://100.106.69.9:3000 (ada-gateway) |
| **GitHub** | git@github.com:henrino3/entity.git |
| **Tech** | React 19, Vite, CodeMirror 6, Tailwind, Zustand, SQLite, Electron 34, Expo 52 |
| **Context** | `~/clawd/memory/projects/entity/context.md` |

---

## Before Starting Work

1. **Read project context:** `cat ~/clawd/memory/projects/entity/context.md`
2. **Read current TODO:** `cat ~/clawd/memory/projects/entity/todo.md`
3. **Check MC for assigned tasks:** `curl -s http://100.106.69.9:3000/api/tasks | jq '[.[] | select(.assignee == "YOUR_NAME")]'`
4. **Pull latest code:** `cd ~/Code/entity && git pull`

---

## Mission Control (MC) Protocol

MC is integrated INTO Entity. The task board in Entity IS Mission Control.

### MC API (http://100.106.69.9:3000)

```bash
# List all tasks
curl -s http://100.106.69.9:3000/api/tasks

# Create task (REQUIRED for any work >5 min)
curl -X POST http://100.106.69.9:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{"name": "Task name", "description": "Details", "created_by": "AgentName", "assignee": "AgentName", "column": "doing"}'

# Move task
curl -X PUT http://100.106.69.9:3000/api/tasks/{id}/move \
  -H "Content-Type: application/json" \
  -d '{"column": "review"}'

# Log activity
curl -X POST http://100.106.69.9:3000/api/tasks/{id}/activity \
  -H "Content-Type: application/json" \
  -d '{"action": "built", "user": "AgentName", "details": "What you did", "type": "human"}'

# Mark blocked
curl -X PATCH http://100.106.69.9:3000/api/tasks/{id} \
  -H "Content-Type: application/json" \
  -d '{"blocked": true, "blocker_reason": "Reason here"}'

# Query blocked tasks
curl -s http://100.106.69.9:3000/api/tasks | jq '[.[] | select(.blocked == 1)]'
```

### MC Columns
`backlog` → `todo` → `doing` → `review` → `done`

### MC Rules
- **Any work >5 min → Create MC card BEFORE starting**
- **Log activities as you work** (what you did, not just notes)
- **Move to "review" when done** - never directly to "done"
- **If blocked → mark blocked immediately** with reason
- **Always include source links** in description if relevant

### Review Workflow
- **Henry → Agents:** Agent works → Review → Henry approves → Done
- **Ada → Scotty/Spock:** They work → Review → Ada tests → Done
- **Nothing goes to Done without review**

---

## Entity App Structure

```
entity/
├── packages/
│   ├── app/          # React frontend (Vite, port 5173)
│   │   └── src/
│   │       ├── components/
│   │       │   ├── TaskBoard.tsx      # Kanban board (drag-drop)
│   │       │   ├── ActivityStream.tsx  # Agent + task activity
│   │       │   ├── CodeMirrorEditor.tsx
│   │       │   ├── FileTree.tsx
│   │       │   ├── MarkdownPreview.tsx
│   │       │   ├── MobileBottomNav.tsx
│   │       │   ├── QuickSwitcher.tsx
│   │       │   └── SyncStatusBadge.tsx
│   │       └── hooks/
│   │           ├── useTaskBoard.ts
│   │           ├── useActivityStream.ts
│   │           ├── useWebSocket.ts
│   │           ├── useSyncStatus.ts
│   │           └── useIsMobile.ts
│   ├── server/       # Express + WebSocket (port 3001/3002)
│   ├── db/           # SQLite layer (local.ts, cloud.ts, task-sync.ts)
│   ├── desktop/      # Desktop-specific
│   └── mobile/       # Expo SDK 52
├── electron/         # Electron 34 wrapper
├── e2e/              # E2E tests (agent-browser)
└── scripts/ralph/    # Codex agent prompts & PRDs
```

### How to Run

```bash
# Start dev server
cd ~/Code/entity/packages/app && npx vite --host

# Start API server
cd ~/Code/entity && npx ts-node packages/server/src/index.ts

# Run E2E tests
cd ~/Code/entity && npm test

# Build Electron
cd ~/Code/entity && npm run electron:build
```

### API Endpoints (Entity Server, port 3001)

| Method | Route | Purpose |
|--------|-------|---------|
| GET | /api/files | List files in workspace |
| GET | /api/file?path=... | Read file content |
| PUT | /api/file | Write/update file |
| POST | /api/file | Create file |
| DELETE | /api/file | Delete file |
| GET | /api/search?q=... | Search files |
| POST | /api/mention | @mention webhook to agents |
| GET | /api/agents | List agents + status |
| GET | /api/activities?limit=100 | Activity stream |

### Color Scheme (MANDATORY for all UI work)
```css
:root {
  --bg-primary: #000000;
  --bg-secondary: #111111;
  --bg-tertiary: #1a1a1a;
  --border-primary: #222222;
  --border-secondary: #333333;
  --text-primary: #ffffff;
  --text-secondary: #e0e0e0;
  --text-muted: #888888;
  --accent: #00aaff;
  --accent-dim: #006699;
  --success: #00ff88;
  --error: #ff4444;
}
```

---

## Ralph (Codex Agent) Protocol

Ralph is a Codex CLI agent that implements stories from PRD JSON files.

### PRD Files
- `scripts/ralph/prd.json` - Phase 2 Watch Mode stories (9 total, 3 done)
- `scripts/ralph/integration-prd.json` - MC integration stories (10 total, all done)

### How Ralph Works
1. Reads PRD JSON → finds first story with `passes: false`
2. Implements the story
3. Verifies `npm run build` passes
4. Marks story as `passes: true` in the JSON
5. Commits and moves to next

### Running Ralph
```bash
cd ~/Code/entity
source ~/.nvm/nvm.sh
npx @openai/codex exec --full-auto "Read scripts/ralph/prd.json, find the FIRST story with passes: false, implement it, test build, mark as passes: true"
```

**Always use tmux** for long-running Codex sessions on Mac.

---

## After Each Session

1. **Commit and push:** `cd ~/Code/entity && git add -A && git commit -m 'feat: description' && git push origin main`
2. **Update project context:** `~/clawd/skills/project-context/scripts/update-context.sh entity ~/Code/entity`
3. **Update MC tasks:** Move completed tasks to "review"
4. **Log in timeline:** Add entry to `~/clawd/memory/projects/entity/timeline.md`

---

## Current Priorities

Check `~/clawd/memory/projects/entity/todo.md` for the latest TODO list.

**Phase 2 remaining (Watch Mode):**
- Auto-Follow Agent Files (story 4)
- Agent Focus Tracking (story 5)
- Notification Center (stories 6-7)
- Split Pane View (story 8)
- File Change History (story 9)

---

*Last updated: 2026-02-07. Source of truth for any agent working on Entity.*
