# PRD: Entity Tier 1 — Embedded TaskAgent

**Author:** Ada | **Date:** 2026-02-16
**Status:** Ready for Build | **Builder:** Geordi (Codex on Mac)

## Problem

Entity is a Tier 0 task board — dumb CRUD that relies on Ada's external cron (every 6 hours) to enforce quality gates, check stale tasks, and fill missing outputs. This is embarrassing for a product called "Entity" and contradicts Henry's "4 Tiers of Software Intelligence" framework.

## Vision

Entity becomes Tier 1: it has its own embedded agent that watches, enforces, and acts autonomously on task events — no external cron needed.

## Solution: Vercel AI SDK + Event Hooks

Entity already runs Node.js. We embed a lightweight `TaskAgent` class using Vercel AI SDK with Gemini Flash (cheap, fast).

### Architecture

```
Entity Server
├── /api/tasks (existing CRUD)
├── /api/agent (NEW - manual trigger endpoint)
├── TaskAgent (NEW)
│   ├── LLM: Gemini Flash via Vercel AI SDK
│   ├── Tools:
│   │   ├── searchTasks(query) — search Entity's own DB
│   │   ├── updateTask(id, fields) — update task fields
│   │   ├── addNote(id, note) — add activity note
│   │   ├── moveTask(id, column) — move between columns
│   │   └── notifyAgent(agent, message) — ping assigned agent
│   ├── Event Hooks:
│   │   ├── onTaskMovedToReview(task) — check for output
│   │   ├── onTaskStale(task, hours) — nudge assignee
│   │   └── onOutputMissing(task) — search for deliverable
│   └── Scheduler:
│       └── Every 30min: scan for stale/stuck tasks
```

### Event Hooks (Detail)

#### 1. onTaskMovedToReview(task)
**Trigger:** Task column changes to "review"
**Action:**
- Check if task has concrete output (URL, file path, PR link, summary)
- If no output: search Entity DB for related notes/deliverables
- If still nothing: add note "⚠️ Moved to review without output" and nudge assignee
- If output exists: validate it's accessible (URL returns 200, file exists)

#### 2. onTaskStale(task, hoursInColumn)
**Trigger:** Scheduled scan finds task in same column for >24h (doing) or >48h (review)
**Action:**
- Check if task has recent notes (activity in last 12h)
- If no activity: add note "🕐 Stale for {hours}h — no recent activity"
- If blocked: check blocker_reason, try to resolve or escalate
- Ping assigned agent via notifyAgent()

#### 3. onOutputMissing(task)
**Trigger:** Task in review with no output field
**Action:**
- Search Entity DB for tasks with similar names/descriptions that have outputs
- Search notes for URLs, file paths, PR links
- If found: auto-fill output field, add note "📎 Auto-attached output: {url}"
- If not found: request output from assignee

### API Endpoints

```
POST /api/agent/trigger
  Body: { event: "review_check" | "stale_scan" | "manual", taskId?: number }
  Response: { actions: [...], summary: string }

GET /api/agent/status
  Response: { lastRun: ISO, totalActions: number, model: string }

GET /api/agent/log
  Response: { entries: [{ timestamp, event, taskId, action, result }] }
```

### Database Changes

```sql
-- New table for agent activity log
CREATE TABLE agent_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  event TEXT NOT NULL,
  task_id INTEGER,
  action TEXT NOT NULL,
  result TEXT,
  model TEXT DEFAULT 'gemini-flash',
  tokens_used INTEGER DEFAULT 0
);

-- Add output field to tasks if not exists
-- (may already exist — check schema first)
```

### Configuration

```typescript
// packages/server/src/agent/config.ts
export const AGENT_CONFIG = {
  model: 'gemini-2.0-flash',  // Cheap, fast
  provider: 'google',
  scanIntervalMs: 30 * 60 * 1000,  // 30 minutes
  staleThresholdHours: {
    doing: 24,
    review: 48,
  },
  maxActionsPerScan: 10,
  enabled: process.env.ENTITY_AGENT_ENABLED === 'true',
};
```

### Dependencies

```bash
npm install ai @ai-sdk/google
```

### Implementation Files

```
packages/server/src/agent/
├── index.ts          # TaskAgent class (main loop)
├── config.ts         # Configuration
├── tools.ts          # Tool definitions (searchTasks, updateTask, etc.)
├── events.ts         # Event hook handlers
├── scheduler.ts      # Periodic scan scheduler
└── log.ts            # Agent activity logging
```

## Environment Variables

```
ENTITY_AGENT_ENABLED=true
GOOGLE_GENERATIVE_AI_API_KEY=<gemini-key>  # or reuse existing
```

## Success Criteria

1. Entity detects tasks moved to review without output within 5 minutes
2. Entity auto-fills output when discoverable from notes/related tasks
3. Entity nudges stale tasks (>24h doing, >48h review) without external cron
4. Agent log shows all actions taken with token usage
5. `/api/agent/status` returns health info
6. Total cost < $1/month on Gemini Flash

## Out of Scope (v1)

- Direct LLM chat interface in Entity UI
- Agent creating new tasks autonomously
- Cross-Entity communication (multiple Entity instances)
- Tier 2+ features (natural language task creation, predictive scheduling)

## Rollout

1. Build behind `ENTITY_AGENT_ENABLED` flag (default: false)
2. Test on ada-gateway with real task data
3. Monitor agent_log for 48h
4. Enable in production once stable
