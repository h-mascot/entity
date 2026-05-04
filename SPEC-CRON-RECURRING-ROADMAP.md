# Entity: Cron-Connected Recurring Tasks + Enhanced Roadmaps

## Overview
Two features for the Strategic View in Entity Mission Control:

1. **Recurring Tasks → Cron Integration**: Replace the empty "Recurring Tasks" section with live OpenClaw cron job cards
2. **Roadmaps Enhancement**: Import previous roadmap items, add detail view, "Start" action to promote items

---

## Feature 1: Cron-Connected Recurring Tasks

### Problem
The "Recurring Tasks" panel on the Strategic View is empty. Meanwhile, OpenClaw has 70+ cron jobs running at `http://localhost:18789/cron/list` (the gateway API). These should be surfaced as recurring task cards.

### Data Source
**OpenClaw Gateway Cron API** (runs on same machine):
- `GET http://localhost:18789/cron/list` → returns `{ jobs: [...] }`
- Each job has: `id`, `name`, `enabled`, `schedule` (kind/expr/everyMs), `payload` (kind/message/model), `delivery` (mode/channel/to), `state` (lastRunAtMs, lastStatus, lastDurationMs, lastError, consecutiveErrors, nextRunAtMs, runningAtMs)

### Requirements

#### 1. Server: New API endpoint
Create `GET /api/crons` in the Entity server that proxies to the OpenClaw gateway:
- Fetch from `http://localhost:18789/cron/list` (configurable via env `OPENCLAW_GATEWAY_URL`)
- Return the jobs array with computed fields:
  - `nextRunFormatted`: human-readable next run time
  - `lastRunFormatted`: human-readable last run time
  - `scheduleFormatted`: human-readable schedule (e.g. "Every hour", "Daily at 8am", "Every 30m")
  - `category`: auto-categorize based on name/payload (ops, social, intelligence, maintenance, business, health, custom)

Also create `GET /api/crons/:id/runs` to fetch run history (proxy to gateway if available, otherwise derive from state).

#### 2. Frontend: Recurring Tasks Panel (Strategic View)

Replace the empty `#strategicRecurring` div with a rich cron dashboard:

**Card Layout** — Each cron job renders as a card showing:
- **Name** (bold)
- **Status indicator**: 🟢 healthy (enabled + lastStatus=ok), 🟡 warning (enabled + slow/consecutive errors < 3), 🔴 failing (lastStatus=error), ⚫ disabled
- **Schedule**: e.g. "Every hour" / "Daily 8am UTC" / "*/15 * * * *"  
- **Model**: which AI model runs it (from payload.model)
- **Delivery channel**: where results go (Discord #channel / Telegram group / none)
- **Last run**: relative time + duration (e.g. "2h ago, took 45s")
- **Next run**: relative time
- **Error info**: If lastStatus=error, show lastError in a red expandable section
- **Consecutive errors badge**: if > 0

**Card Click → Detail Drawer/Modal:**
- Full cron configuration
- Payload message (the prompt)
- Run history timeline (with status dots: green=ok, red=error)
- Last error details with full stack
- Duration chart (last 10 runs if available)
- Enable/disable toggle (calls gateway API)
- "Run Now" button (calls `POST /cron/run` on gateway)

**Filtering:**
- By status: All / Enabled / Disabled / Failing / Healthy
- By category: ops, social, intelligence, maintenance, business, health
- By schedule frequency: hourly, daily, weekly, custom
- By model: group by model name
- Time-based: runs in last hour / day / week
- Search by name

**Sorting:**
- By next run (default)
- By last run
- By name
- By status (failing first)

**Summary stats bar at top:**
- Total enabled / disabled
- Currently failing count
- Next upcoming run
- Average run duration

#### 3. Never show cron jobs as normal Kanban tasks
Cron jobs should ONLY appear in the Recurring Tasks panel, never in the Ops kanban columns. The existing `recurring` filter in Ops view should continue to hide them.

---

## Feature 2: Enhanced Roadmaps

### Problem
Roadmaps section exists but is bare — just a create input. Need to:
1. Import previous roadmap items from memory
2. Add rich detail views for roadmap items
3. Add "Start" action that decomposes roadmap items into backlog/todo tasks

### Requirements

#### 1. Roadmap Item Detail (click to expand)
When clicking a roadmap item, show a detail panel with:
- **Title** (editable)
- **Description** (rich text/markdown, editable)
- **Priority** (P0-P3)
- **Status**: idea → planned → in-progress → done
- **Notes** field (freeform)
- **Tags** (for categorization)
- **Created date**
- **Child tasks** (tasks that were promoted from this item)

#### 2. "Start" Action
When user clicks "Start" on a roadmap item:
1. Opens a prompt/modal asking for:
   - How to break this down (or auto-suggest breakdown)
   - Target column (backlog or todo)
   - Assignee(s)
2. Creates task(s) in the kanban board from the roadmap item
3. Links back: the roadmap item shows its promoted tasks
4. Updates roadmap item status to "in-progress"

#### 3. Import from Memory
Create a server endpoint `POST /api/roadmaps/import` that:
- Reads from a configurable memory path (default: look for `memory/projects/*/context.md`, `memory/proactive-work.md`)
- Extracts items that look like roadmap/feature items (headers, bullet lists with status markers)
- Returns them as candidates for the user to select and import
- On the frontend: "Import from Memory" button → shows candidates → user picks → creates roadmap items

#### 4. Roadmap Card Improvements
Each roadmap card should show:
- Item count + completion percentage
- Color-coded priority breakdown
- Expandable item list with inline status badges

---

## Technical Notes

- **Cron API proxy**: The server should cache cron list for 30s to avoid hammering the gateway
- **MC-SOURCE.html**: Both features need updates to the Strategic View section
- **DB**: Roadmap tables already exist (`roadmaps`, `roadmap_items`). May need to add columns for `description`, `notes`, `tags`, `status` to `roadmap_items`
- **No new dependencies**: Use existing CSS patterns (dark theme, `.meta-input`, `.filter-btn`)
- **The existing recurring task filtering** (`t.recurring` flag on tasks) should remain for backward compat, but the Cron panel is the new primary recurring view

## File Locations
- `MC-SOURCE.html` — main UI (HTML/CSS/JS, strategic view section around line 1610-1640)
- `packages/server/src/index.ts` — server routes (add cron proxy + roadmap import)
- `packages/db/src/index.ts` — DB schema + operations (roadmap item schema changes)
- `packages/app/src/components/mission-control/MCStrategicView.tsx` — React wrapper

## Priority
1. Cron → Recurring Tasks integration (highest value, most visible)
2. Roadmap detail + Start action
3. Import from memory (nice to have)
