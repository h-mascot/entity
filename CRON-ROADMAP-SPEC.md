# Entity: Cron Dashboard + Roadmap Enhancement Spec

## Overview
Two features for the Strategic Board in MC-SOURCE.html:
1. **Recurring Tasks = Cron Dashboard** - Connect OpenClaw crons to the recurring tasks panel
2. **Roadmaps Enhancement** - Rich card detail, "Start" to promote items, import existing items

---

## Feature 1: Cron Dashboard (Recurring Tasks Panel)

### Problem
The "Recurring Tasks" panel in the strategic view is empty. It currently shows tasks with `recurring=true` flag, but none exist. Meanwhile, OpenClaw runs 70+ cron jobs that should be visible here.

### Architecture

#### Server-Side (packages/server/src/index.ts)

**New API endpoint: `GET /api/crons`**
- Reads cron data from OpenClaw gateway at `http://localhost:18789` (or configured OPENCLAW_GATEWAY_URL)
- The gateway exposes cron list via its internal API. For now, use the openclaw CLI:
  ```bash
  openclaw cron list --json
  ```
- Alternatively, read from the cron state file directly: `~/.openclaw/agents/main/crons.json`
- Cache response for 60 seconds (don't hit every request)
- Return array of cron objects with all fields

**New API endpoint: `GET /api/crons/:id/runs`**
- Returns run history for a specific cron (from gateway)
- For now, the cron state only has `lastRunAtMs`, `lastStatus`, `lastDurationMs`, `lastError`, `consecutiveErrors`
- Future: accumulate run history in a local SQLite table

**New DB table: `cron_run_history`**
```sql
CREATE TABLE IF NOT EXISTS cron_run_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cron_id TEXT NOT NULL,
  run_at INTEGER NOT NULL,
  status TEXT NOT NULL, -- 'ok' | 'error'
  duration_ms INTEGER,
  error TEXT,
  model TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cron_runs_cron_id ON cron_run_history(cron_id);
```

**Cron Snapshot Collector** (runs on server startup + every 5 min):
- Reads all crons from gateway
- For each cron with a `lastRunAtMs` newer than the last snapshot, insert a row into `cron_run_history`
- Store the last snapshot timestamp in a simple file or DB setting

#### Frontend (MC-SOURCE.html)

**Replace the Recurring Tasks panel content:**

Instead of showing tasks with `recurring=true`, fetch from `/api/crons` and render cron cards.

**Cron Card Layout:**
```
┌─────────────────────────────────────┐
│ ● meeting-backlog-sync        ❌    │
│ Daily at 8:00 AM UTC                │
│ Model: minimax/MiniMax-M2.1        │
│ → Discord #mail-room               │
│ Last: 2h ago (2.0s)                │
│ ⚠ thread not found                 │
└─────────────────────────────────────┘
```

- Status dot: 🟢 ok / 🔴 error / 🟡 slow (>5min) / ⚫ disabled / 🔵 running
- Show: name, human-readable schedule, model, delivery channel, last run relative time, duration
- If error: show truncated error message (1 line)
- Disabled crons shown with opacity 0.5

**Cron Detail View (on click):**
Opens in a modal/slide-over panel with:
- Full cron name and description
- Schedule (cron expression + human readable)
- Model name
- Session target (main/isolated)
- Delivery channel and target
- Enabled/disabled toggle (calls `PATCH /api/crons/:id` → proxies to gateway)
- **Activity Log**: Table of recent runs from `cron_run_history`:
  | Time | Status | Duration | Error |
  Shows last 50 runs with expandable error details
- **Run Now** button (calls `POST /api/crons/:id/run` → proxies to gateway)

**Filter Bar for Crons:**
- Time filter: All | Minutely | Hourly | Daily | Weekly | Monthly
- Status filter: All | Healthy | Failing | Disabled
- Category filter: Extract from name prefix before first space or "cluster:" prefix
- Search box
- Sort: by name, last run, status

**Key Rule: Crons NEVER appear in the normal kanban board.** They only show in the strategic view's Recurring Tasks panel.

### Cron Schedule → Human Readable
Implement a `cronToHuman(schedule)` function:
- `kind: "cron"` → parse cron expression (e.g., `"0 * * * *"` → "Every hour")
- `kind: "every"` → format everyMs (e.g., `120000` → "Every 2 minutes")
- `kind: "at"` → format date (e.g., "One-time: Feb 10, 2026 1:10 AM")

### Delivery Channel → Human Readable
- `channel: "discord"`, `to: "channel:123"` → "Discord #channel-name" (resolve via Discord API or hardcode known channels)
- `channel: "telegram"`, `to: "-5139542662"` → "Telegram group"
- `mode: "none"` → "Silent"
- `mode: "announce"` → show channel

---

## Feature 2: Roadmaps Enhancement

### Current State
- Roadmaps table exists in DB with basic fields (name, theme, color)
- Roadmap items table exists (title, description, priority, status, promoted_task_id)
- UI can create roadmaps and add items, but it's barebones

### Enhancements

#### Roadmap Card (in list)
```
┌─────────────────────────────────────┐
│ 🗺️ Entity v2 Roadmap               │
│ 3/12 items complete                 │
│ ████████░░░░░░░░ 25%               │
│ 2 in progress, 7 planned           │
└─────────────────────────────────────┘
```

- Show progress bar (items promoted to tasks that are done / total items)
- Show counts by status

#### Roadmap Item Detail (on click)
Modal with:
- Title (editable)
- Description (rich text / markdown, editable)
- Priority dropdown (P0-P3)
- Status: Planned → In Progress → Done
- Notes field (free text)
- Linked task (if promoted)
- **"Start" button**: When clicked:
  1. Creates a new task in "backlog" column with the roadmap item title
  2. Sets `roadmap_id` on the task linking back
  3. Updates the roadmap item status to "in_progress" and sets `promoted_task_id`
  4. If the item has a detailed description, break it into sub-tasks (future: AI breakdown)

#### Import Existing Roadmap Items
Server endpoint: `POST /api/roadmaps/:id/import`
Accepts array of `{title, description, priority}` items and bulk-inserts them.

### Seed Data
The self-healing ideas from the previous message should be seeded as a roadmap:

**Roadmap: "Entity Self-Healing & Cron Intelligence"**
Items:
1. Retry with fallback model (P1)
2. Checkpoint + resume for long tasks (P2)
3. Self-monitoring cron supervisor (P1)
4. Exec fallback for subagents (P2)
5. Pre-flight health check before spawn (P1)
6. Run locally when spawn fails 2x (P2)

---

## Implementation Notes

### Files to Modify
1. **`MC-SOURCE.html`** — Main UI changes (cron cards, filters, detail modals, roadmap enhancements)
2. **`packages/server/src/index.ts`** — New API endpoints (`/api/crons`, `/api/crons/:id/runs`, `/api/crons/:id/run`)
3. **`packages/db/src/index.ts`** — New `cron_run_history` table, schema migration

### Environment
- OpenClaw gateway runs on the same machine
- Cron state file: `~/.openclaw/cron/jobs.json` (read directly for speed — this is the real path)
- Alternatively, shell out to `openclaw cron list --json` for the most accurate data
- Gateway port: 18789 (internal API)

### Don't Break
- Existing task board (kanban) must continue working
- Existing roadmap CRUD must continue working
- The `recurring` field on tasks should still work (for manual recurring tasks)
- DB migrations must be additive only (never drop columns)
- NEVER overwrite or delete entity-tasks.db

### Testing
After implementation:
1. `npm run dev` should start without errors
2. Strategic view should show cron cards
3. Clicking a cron card should open detail with activity
4. Roadmap items should be creatable and "Start" should promote to backlog
5. Filters should work (time, status, category)
